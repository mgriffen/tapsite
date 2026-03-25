/**
 * Markdown generator — converts HTML to clean Markdown.
 *
 * Modes:
 *   raw       — full page conversion preserving all structure
 *   fit       — noise-filtered (strips nav, footer, aside, header, cookie/consent/popup elements)
 *   citations — links converted to numbered references at the bottom
 *
 * NOTE: Known limitation with hand-rolled parser — the simple tokenizer breaks on
 * multi-word attribute values like class="foo bar" because it uses a naive attribute
 * regex that splits on whitespace inside tags. For production-grade parsing, upgrade to
 * `htmlparser2` which handles the full HTML5 spec including quoted attribute values,
 * malformed markup, and edge cases. For the initial implementation the simple parser is
 * acceptable — most real-world usage will be through `page.content()` which produces
 * well-formed HTML that the simple parser handles adequately when attribute values are
 * single tokens or joined with hyphens.
 */

'use strict';

// Tags that are noise in fit mode
const NOISE_TAGS = new Set(['nav', 'footer', 'aside', 'header']);

// Class/id fragments that indicate noise elements in fit mode
const NOISE_CLASS_PATTERNS = [
  'cookie', 'consent', 'popup', 'modal', 'sidebar', 'ad', 'newsletter',
  'banner', 'overlay', 'gdpr', 'tracking', 'promo',
];

// Tags whose entire subtree should always be skipped
const SKIP_ALWAYS = new Set([
  'script', 'style', 'noscript', 'svg', 'iframe',
  'head', 'meta', 'link', 'button', 'select', 'option',
]);

/**
 * Tokenize an HTML string into an array of tokens.
 * Each token is one of:
 *   { type: 'text',    value }
 *   { type: 'open',   tag, attrs }
 *   { type: 'close',  tag }
 *   { type: 'self',   tag, attrs }
 *   { type: 'comment' }
 */
function tokenize(html) {
  const tokens = [];
  const tagRe = /(<[^>]*>|<!--[\s\S]*?-->)/g;
  let lastIndex = 0;
  let match;

  while ((match = tagRe.exec(html)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: html.slice(lastIndex, match.index) });
    }

    const raw = match[1];

    if (raw.startsWith('<!--')) {
      tokens.push({ type: 'comment' });
    } else if (raw.startsWith('</')) {
      const tag = raw.slice(2, -1).trim().toLowerCase().split(/\s+/)[0];
      tokens.push({ type: 'close', tag });
    } else {
      const inner = raw.slice(1, raw.endsWith('/>') ? -2 : -1).trim();
      const selfClosing = raw.endsWith('/>') || /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(inner.split(/\s+/)[0]);
      const parts = inner.split(/\s+/);
      const tag = parts[0].toLowerCase();
      const attrs = parseAttrs(inner.slice(parts[0].length));
      tokens.push({ type: selfClosing ? 'self' : 'open', tag, attrs });
    }

    lastIndex = match.index + raw.length;
  }

  if (lastIndex < html.length) {
    tokens.push({ type: 'text', value: html.slice(lastIndex) });
  }

  return tokens;
}

/**
 * Parse attributes from the portion of a tag string after the tag name.
 * NOTE: Simple implementation — breaks on multi-word quoted attribute values.
 * See module-level comment for upgrade path.
 */
function parseAttrs(attrStr) {
  const attrs = {};
  // Match: name="value", name='value', name=value, or bare name
  const re = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    const name = m[1].toLowerCase();
    const val = m[2] !== undefined ? m[2]
              : m[3] !== undefined ? m[3]
              : m[4] !== undefined ? m[4]
              : '';
    attrs[name] = val;
  }
  return attrs;
}

/**
 * Check whether an element is a noise element for fit mode.
 */
function isNoiseElement(tag, attrs) {
  if (NOISE_TAGS.has(tag)) return true;
  const haystack = ((attrs.class || '') + ' ' + (attrs.id || '')).toLowerCase();
  return NOISE_CLASS_PATTERNS.some((p) => haystack.includes(p));
}

/**
 * Decode common HTML entities.
 */
function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&[a-z]+;/gi, '');
}

/**
 * Walk tokens and produce a Markdown string.
 *
 * @param {Array} tokens
 * @param {string} mode - 'raw' | 'fit' | 'citations'
 * @param {Array} citations - mutable array to accumulate citation entries
 * @returns {string}
 */
function walkTokens(tokens, mode, citations) {
  const out = [];

  // --- State ---
  let skipDepth = 0;         // >0 means we are inside a skipped subtree
  const listStack = [];      // { type: 'ul'|'ol', counter }
  let inTable = false;
  let inThead = false;
  let headerRowEmitted = false;
  let currentRowCells = [];
  let isHeaderRow = false;
  let inPre = false;
  let preBuffer = '';
  let blockquoteDepth = 0;

  // headings: buffer text until </hN>
  let headingLevel = 0;
  let headingBuffer = '';

  // link tracking: stack of { href, citationParts }
  // citationParts only used in citations mode to collect plain text
  const linkStack = [];

  function emit(text) {
    // When inside a blockquote, prefix lines after newlines with '> '
    if (blockquoteDepth > 0 && text.includes('\n')) {
      const prefix = '> '.repeat(blockquoteDepth);
      out.push(text.replace(/\n(?!$)/g, '\n' + prefix));
    } else {
      out.push(text);
    }
  }

  // Emit text, routing to the right place based on context
  function emitText(raw) {
    if (skipDepth > 0) return;
    if (inPre) { preBuffer += raw; return; }

    const text = decodeEntities(raw.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' '));
    if (!text.trim()) return;

    if (headingLevel > 0) { headingBuffer += text; return; }

    if (inTable) {
      if (currentRowCells.length > 0) {
        currentRowCells[currentRowCells.length - 1] += text;
      }
      return;
    }

    // In citations mode, collect plain text for the innermost open link
    if (mode === 'citations' && linkStack.length > 0) {
      linkStack[linkStack.length - 1].citationParts.push(text);
      return;
    }

    emit(text);
  }

  for (const tok of tokens) {
    // --- comments ---
    if (tok.type === 'comment') continue;

    // --- text nodes ---
    if (tok.type === 'text') {
      emitText(tok.value);
      continue;
    }

    // --- self-closing tags ---
    if (tok.type === 'self') {
      if (skipDepth > 0) continue;
      const { tag, attrs } = tok;
      if (tag === 'img') {
        const alt = attrs.alt || '';
        const src = attrs.src || '';
        // In citations mode, if inside a link, add img to citation parts too
        const imgMd = `![${alt}](${src})`;
        if (mode === 'citations' && linkStack.length > 0) {
          linkStack[linkStack.length - 1].citationParts.push(alt || src);
        } else {
          emit(imgMd);
        }
      } else if (tag === 'br') {
        emit('  \n');
      } else if (tag === 'hr') {
        emit('\n---\n');
      }
      continue;
    }

    // --- opening tags ---
    if (tok.type === 'open') {
      const { tag, attrs } = tok;

      if (skipDepth > 0) { skipDepth++; continue; }

      if (SKIP_ALWAYS.has(tag)) { skipDepth = 1; continue; }

      if (mode === 'fit' && isNoiseElement(tag, attrs)) { skipDepth = 1; continue; }

      switch (tag) {
        case 'h1': case 'h2': case 'h3':
        case 'h4': case 'h5': case 'h6':
          headingLevel = parseInt(tag[1], 10);
          headingBuffer = '';
          emit('\n');
          break;

        case 'p': case 'div': case 'section': case 'article': case 'main':
          emit('\n');
          break;

        case 'br':
          emit('  \n');
          break;

        case 'strong': case 'b':
          if (!inPre && !(mode === 'citations' && linkStack.length > 0)) emit('**');
          break;

        case 'em': case 'i':
          if (!inPre && !(mode === 'citations' && linkStack.length > 0)) emit('_');
          break;

        case 'code':
          if (!inPre) emit('`');
          break;

        case 'pre':
          inPre = true;
          preBuffer = '';
          emit('\n');
          break;

        case 'ul':
          listStack.push({ type: 'ul', counter: 0 });
          emit('\n');
          break;

        case 'ol':
          listStack.push({ type: 'ol', counter: 0 });
          emit('\n');
          break;

        case 'li': {
          const list = listStack[listStack.length - 1];
          const depth = Math.max(0, listStack.length - 1);
          const indent = '  '.repeat(depth);
          if (list && list.type === 'ul') {
            emit('\n' + indent + '- ');
          } else if (list) {
            list.counter++;
            emit('\n' + indent + list.counter + '. ');
          } else {
            emit('\n- ');
          }
          break;
        }

        case 'a': {
          const href = attrs.href || '';
          linkStack.push({ href, citationParts: [] });
          if (mode !== 'citations') emit('[');
          break;
        }

        case 'img': {
          const alt = attrs.alt || '';
          const src = attrs.src || '';
          emit(`![${alt}](${src})`);
          break;
        }

        case 'table':
          inTable = true;
          headerRowEmitted = false;
          emit('\n');
          break;

        case 'thead':
          inThead = true;
          break;

        case 'tbody':
          inThead = false;
          break;

        case 'tr':
          currentRowCells = [];
          isHeaderRow = inThead;
          break;

        case 'th': case 'td':
          currentRowCells.push('');
          break;

        case 'blockquote':
          blockquoteDepth++;
          emit('\n> ');
          break;

        case 'hr':
          emit('\n---\n');
          break;

        default:
          break;
      }
      continue;
    }

    // --- closing tags ---
    if (tok.type === 'close') {
      const tag = tok.tag;

      if (skipDepth > 0) { skipDepth--; continue; }

      switch (tag) {
        case 'h1': case 'h2': case 'h3':
        case 'h4': case 'h5': case 'h6': {
          const hashes = '#'.repeat(headingLevel);
          emit(hashes + ' ' + headingBuffer.trim() + '\n');
          headingLevel = 0;
          headingBuffer = '';
          break;
        }

        case 'p': case 'div': case 'section': case 'article': case 'main':
          emit('\n');
          break;

        case 'strong': case 'b':
          if (!inPre && !(mode === 'citations' && linkStack.length > 0)) emit('**');
          break;

        case 'em': case 'i':
          if (!inPre && !(mode === 'citations' && linkStack.length > 0)) emit('_');
          break;

        case 'code':
          if (!inPre) emit('`');
          break;

        case 'pre': {
          inPre = false;
          const codeContent = preBuffer.replace(/^\n/, '').replace(/\n$/, '');
          emit('```\n' + codeContent + '\n```\n');
          preBuffer = '';
          break;
        }

        case 'ul': case 'ol':
          listStack.pop();
          emit('\n');
          break;

        case 'li':
          break;

        case 'a': {
          const link = linkStack.pop();
          if (!link) break;
          if (mode === 'citations') {
            const linkText = link.citationParts.join('');
            if (link.href) {
              const n = citations.length + 1;
              citations.push({ n, href: link.href, text: linkText });
              const citationMd = linkText + `[${n}]`;
              // If inside a heading, route into the heading buffer
              if (headingLevel > 0) {
                headingBuffer += citationMd;
              } else {
                emit(citationMd);
              }
            } else {
              if (headingLevel > 0) {
                headingBuffer += linkText;
              } else {
                emit(linkText);
              }
            }
          } else {
            // raw or fit: we opened with '[' on open, so close with ](href)
            emit(`](${link.href})`);
          }
          break;
        }

        case 'table':
          inTable = false;
          emit('\n');
          break;

        case 'thead':
          inThead = false;
          break;

        case 'tr': {
          if (!inTable) break;
          const cells = currentRowCells.map((c) => c.trim() || ' ');
          const row = '| ' + cells.join(' | ') + ' |';
          emit(row + '\n');
          if (isHeaderRow && !headerRowEmitted) {
            const sep = '| ' + cells.map(() => '---').join(' | ') + ' |';
            emit(sep + '\n');
            headerRowEmitted = true;
          }
          currentRowCells = [];
          isHeaderRow = false;
          break;
        }

        case 'th': case 'td':
          break;

        case 'blockquote':
          blockquoteDepth = Math.max(0, blockquoteDepth - 1);
          emit('\n');
          break;

        default:
          break;
      }
    }
  }

  return out.join('');
}

/**
 * Generate Markdown from an HTML string.
 *
 * @param {string} html - The HTML to convert
 * @param {object} [opts={}]
 * @param {'raw'|'fit'|'citations'} [opts.mode='fit'] - Conversion mode
 * @returns {string} Markdown string
 */
function generateMarkdown(html, opts = {}) {
  if (!html || typeof html !== 'string') return '';

  const mode = opts.mode || 'fit';
  const citations = [];
  const tokens = tokenize(html);
  let md = walkTokens(tokens, mode, citations);

  // Append citations reference list
  if (mode === 'citations' && citations.length > 0) {
    md += '\n\n---\n\n**References**\n\n';
    for (const { n, href, text } of citations) {
      md += `[${n}]: ${href}${text ? ' "' + text + '"' : ''}\n`;
    }
  }

  // Normalize excessive blank lines and trim
  md = md.replace(/\n{3,}/g, '\n\n').trim();

  return md;
}

module.exports = { generateMarkdown };
