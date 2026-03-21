/**
 * Extract UI structure from a document (or frame's document).
 * Runs inside page.evaluate / frame.evaluate.
 */
function extractStructure() {
  const textOf = (el) => (el.textContent || '').trim();
  const unique = (arr) => [...new Set(arr.filter(Boolean))];

  // Navigation items — links inside nav elements, or common nav patterns
  const navItems = unique(
    [...document.querySelectorAll('nav a, [role="navigation"] a, .nav a, .sidebar a, .menu a')]
      .map((a) => ({ text: textOf(a), href: a.getAttribute('href') }))
      .filter((n) => n.text)
      .map((n) => JSON.stringify(n))
  ).map((s) => JSON.parse(s));

  // Also grab all links as potential nav if no semantic nav found
  const allLinks = [...document.querySelectorAll('a[href]')]
    .map((a) => ({
      text: textOf(a),
      href: a.getAttribute('href'),
    }))
    .filter((l) => l.text && l.href && !l.href.startsWith('javascript:') && !l.href.startsWith('#'));

  // Headings
  const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
    .map((h) => ({ level: parseInt(h.tagName[1]), text: textOf(h) }))
    .filter((h) => h.text);

  // Buttons
  const buttons = unique(
    [...document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]')]
      .map((b) => textOf(b) || b.getAttribute('value') || b.getAttribute('aria-label') || '')
  );

  // Form fields
  const formFields = [...document.querySelectorAll('input, select, textarea')]
    .map((f) => ({
      type: f.type || f.tagName.toLowerCase(),
      name: f.name || undefined,
      label:
        f.getAttribute('aria-label') ||
        (f.id && document.querySelector(`label[for="${f.id}"]`)?.textContent?.trim()) ||
        f.placeholder ||
        undefined,
    }))
    .filter((f) => f.type !== 'hidden');

  // Tables — headers + row data (capped at 50 rows per table)
  const tables = [...document.querySelectorAll('table')].map((table) => {
    const headers = [...table.querySelectorAll('th')].map((th) => textOf(th));
    const caption = table.querySelector('caption')?.textContent?.trim();
    const bodyRows = [...table.querySelectorAll('tbody tr, tr')].filter(
      (tr) => !tr.querySelector('th') || tr.closest('thead')
    );
    const dataRows = [...table.querySelectorAll('tbody tr')];
    const rows = dataRows.slice(0, 50).map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => textOf(td))
    );
    const rowCount = dataRows.length;
    return { caption, headers, rows, rowCount };
  });

  // Links (non-nav)
  const links = unique(
    [...document.querySelectorAll('a[href]')]
      .map((a) => a.getAttribute('href'))
      .filter((h) => h && !h.startsWith('javascript:') && !h.startsWith('#'))
  );

  // Detect frames/iframes
  const frameCount = document.querySelectorAll('frame, iframe').length;
  const frameInfo = [...document.querySelectorAll('frame, iframe')].map((f) => ({
    tag: f.tagName.toLowerCase(),
    name: f.name || undefined,
    src: f.src || undefined,
    id: f.id || undefined,
  }));

  // Body text summary (first 500 chars, stripped of excess whitespace)
  const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500);

  return { navItems, allLinks, headings, buttons, formFields, tables, links, frameCount, frameInfo, bodyText };
}

/**
 * Inspect a page and extract UI structure metadata.
 * Handles framesets and iframes by inspecting each frame separately.
 */
async function inspectPage(page) {
  const title = await page.title();
  const url = page.url();

  // First, check if page uses frames
  const topLevel = await page.evaluate(extractStructure);

  const frameResults = [];

  if (topLevel.frameCount > 0) {
    console.log(`  Detected ${topLevel.frameCount} frame(s), inspecting each...`);

    for (const frame of page.frames()) {
      // Skip the main frame (already captured in topLevel)
      if (frame === page.mainFrame()) continue;

      try {
        const frameData = await frame.evaluate(extractStructure);
        const frameName = frame.name() || frame.url();
        frameResults.push({
          frameName,
          frameUrl: frame.url(),
          ...frameData,
        });
        console.log(`    Frame "${frameName}": ${frameData.headings.length} headings, ${frameData.allLinks.length} links, ${frameData.buttons.length} buttons`);
      } catch (err) {
        console.log(`    Frame skipped (cross-origin or not loaded): ${frame.url()}`);
      }
    }
  }

  // Merge frame data into a combined view
  const combined = { ...topLevel };
  for (const fr of frameResults) {
    combined.navItems = [...combined.navItems, ...fr.navItems];
    combined.allLinks = [...combined.allLinks, ...fr.allLinks];
    combined.headings = [...combined.headings, ...fr.headings];
    combined.buttons = [...combined.buttons, ...fr.buttons];
    combined.formFields = [...combined.formFields, ...fr.formFields];
    combined.tables = [...combined.tables, ...fr.tables];
    combined.bodyText += '\n---\n' + (fr.bodyText || '');
  }

  return {
    title,
    url,
    ...combined,
    frames: frameResults.length ? frameResults : undefined,
    inspectedAt: new Date().toISOString(),
  };
}

/**
 * Extract interactive elements from the page, assign sequential IDs,
 * and compute deterministic CSS selectors for each.
 * Runs inside page.evaluate().
 */
function extractInteractiveElements(maxElements) {
  const INTERACTIVE_SELECTOR = [
    'a[href]',
    'button',
    '[role="button"]',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  function isVisible(el) {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    return true;
  }

  function buildSelector(el) {
    const parts = [];
    let current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      let tag = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift(`#${CSS.escape(current.id)}`);
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((c) => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          tag += `:nth-of-type(${idx})`;
        }
      }
      parts.unshift(tag);
      current = parent;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
  }

  const candidates = [...document.querySelectorAll(INTERACTIVE_SELECTOR)];
  const elements = [];

  for (const el of candidates) {
    if (elements.length >= maxElements) break;
    if (!isVisible(el)) continue;

    // Skip nested interactive elements inside buttons/links
    if (el.closest('button') !== el && el.closest('button')) continue;
    if (el.tagName !== 'A' && el.closest('a[href]')) continue;

    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);

    elements.push({
      index: elements.length + 1,
      tag,
      type: el.type || null,
      name: el.name || null,
      text: text || el.getAttribute('aria-label') || el.getAttribute('value') || null,
      role: el.getAttribute('role') || null,
      value: el.value || null,
      placeholder: el.placeholder || null,
      href: el.href || null,
      selector: buildSelector(el),
      boundingBox: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    });
  }

  return elements;
}

/**
 * Build a compressed, token-efficient DOM representation.
 * Interactive elements get [N] prefixes matching their element index.
 * Non-interactive structural elements get descriptive labels.
 * Runs inside page.evaluate().
 */
function buildCompressedDOM(args) {
  const { elementSelectors, maxLength } = args;

  // Build a lookup: DOM element -> index
  const selectorToIndex = new Map();
  for (const { selector, index } of elementSelectors) {
    const el = document.querySelector(selector);
    if (el) selectorToIndex.set(el, index);
  }

  const SKIP_TAGS = new Set([
    'script', 'style', 'svg', 'noscript', 'link', 'meta', 'head',
    'br', 'hr', 'img', 'path', 'defs', 'clippath',
  ]);

  const INLINE_TAGS = new Set([
    'span', 'strong', 'em', 'b', 'i', 'u', 'small', 'mark', 'abbr', 'code',
  ]);

  let output = '';

  function walk(node, depth) {
    if (output.length >= maxLength) return;

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (text && text.length > 1) {
        // Only emit standalone text if parent isn't already emitting it
        const parent = node.parentElement;
        if (parent && !selectorToIndex.has(parent) && !INLINE_TAGS.has(parent.tagName.toLowerCase())) {
          const indent = '  '.repeat(depth);
          output += `${indent}text: "${text.slice(0, 120)}"\n`;
        }
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;

    // Check visibility
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return;

    const indent = '  '.repeat(depth);
    const idx = selectorToIndex.get(node);

    if (idx !== undefined) {
      // Interactive element with index
      let desc = '';
      if (tag === 'a') {
        const text = (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        const href = node.getAttribute('href') || '';
        desc = `link "${text}" -> ${href}`;
      } else if (tag === 'button' || node.getAttribute('role') === 'button') {
        const text = (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        desc = `button "${text}"`;
      } else if (tag === 'input') {
        const type = node.type || 'text';
        const name = node.name ? ` name="${node.name}"` : '';
        const ph = node.placeholder ? ` placeholder="${node.placeholder}"` : '';
        const val = node.value ? ` value="${node.value}"` : '';
        desc = `input[${type}]${name}${ph}${val}`;
      } else if (tag === 'select') {
        const name = node.name ? ` name="${node.name}"` : '';
        const selected = node.options?.[node.selectedIndex]?.text || '';
        desc = `select${name} selected="${selected}"`;
      } else if (tag === 'textarea') {
        const name = node.name ? ` name="${node.name}"` : '';
        desc = `textarea${name}`;
      } else {
        const text = (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        desc = `${tag} "${text}"`;
      }
      output += `${indent}[${idx}] ${desc}\n`;
      return; // Don't recurse into interactive elements
    }

    // Non-interactive structural elements
    if (/^h[1-6]$/.test(tag)) {
      const text = (node.innerText || '').replace(/\s+/g, ' ').trim();
      if (text) output += `${indent}heading(${tag}) "${text}"\n`;
      return;
    }

    if (tag === 'table') {
      const headers = [...node.querySelectorAll('th')].map((th) =>
        (th.textContent || '').trim()
      ).filter(Boolean);
      const rowCount = node.querySelectorAll('tr').length;
      const caption = node.querySelector('caption')?.textContent?.trim() || '';
      const headerStr = headers.length ? `: ${headers.slice(0, 8).join(', ')}` : '';
      const captionStr = caption ? ` "${caption}"` : '';
      output += `${indent}table${captionStr} (${rowCount} rows, ${headers.length} cols)${headerStr}\n`;

      // Still recurse into table to find interactive elements inside cells
      for (const child of node.children) {
        walk(child, depth + 1);
      }
      return;
    }

    if (tag === 'nav' || node.getAttribute('role') === 'navigation') {
      output += `${indent}nav:\n`;
    } else if (tag === 'form') {
      const action = node.getAttribute('action') || '';
      output += `${indent}form${action ? ` action="${action}"` : ''}:\n`;
    } else if (tag === 'li') {
      const text = (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      // Only emit if no interactive children (those will emit themselves)
      if (!node.querySelector('a, button, input, select, textarea')) {
        if (text) output += `${indent}- "${text}"\n`;
        return;
      }
    }

    // Recurse into children
    for (const child of node.childNodes) {
      walk(child, depth);
    }
  }

  walk(document.body, 0);
  return output.slice(0, maxLength);
}

/**
 * V2 page inspection: returns compressed DOM with indexed interactive elements.
 * Keeps inspectPage() intact for backward compatibility.
 */
async function inspectPageV2(page) {
  const config = require('./config');
  const title = await page.title();
  const url = page.url();

  // Extract interactive elements
  const elements = await page.evaluate(extractInteractiveElements, config.MAX_ELEMENTS);

  // Build compressed DOM using element selectors for index lookup
  const elementSelectors = elements.map(({ selector, index }) => ({ selector, index }));
  const compressedDOM = await page.evaluate(buildCompressedDOM, {
    elementSelectors,
    maxLength: config.MAX_DOM_LENGTH,
  });

  return {
    title,
    url,
    compressedDOM,
    elements,
    inspectedAt: new Date().toISOString(),
  };
}

module.exports = { inspectPage, inspectPageV2 };
