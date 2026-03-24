const path = require('path');
const fs = require('fs');
const { sanitizeForLLM } = require('./sanitizer');
const { inspectPageV2 } = require('./inspector');
const config = require('./config');
const browser = require('./browser');

const PKG_VERSION = require('../package.json').version;

function sanitizeObject(obj) {
  if (typeof obj === 'string') return sanitizeForLLM(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = sanitizeObject(v);
    return out;
  }
  return obj;
}

function requireSafeUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid URL: ${urlStr}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme "${parsed.protocol}" — only http: and https: are allowed`);
  }
  const hostname = parsed.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1' || hostname === '0.0.0.0') {
    throw new Error(`Blocked private/loopback address "${hostname}"`);
  }
  const ipv4 = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0) {
      throw new Error(`Blocked private/internal IP "${hostname}"`);
    }
  }
  return parsed;
}

async function navigateIfNeeded(url, waitMs = 1500) {
  if (!url) return;
  requireSafeUrl(url);
  try {
    const response = await browser.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    if (response && response.status() >= 400) {
      console.error(`[tapsite] Navigation warning: ${url} returned HTTP ${response.status()}`);
    }
  } catch (err) {
    console.error(`[tapsite] Navigation error for ${url}: ${err.message}`);
  }
  await browser.page.waitForTimeout(waitMs);
}

function summarizeResult(name, data, summary, meta = {}) {
  const timestamp = new Date().toISOString();
  const tsFile = timestamp.replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(config.OUTPUT_DIR, 'extractions');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${name}-${tsFile}.json`);

  const _meta = {
    tool: meta.tool || name,
    url: browser.page?.url() || '',
    timestamp,
    version: PKG_VERSION,
    description: meta.description || '',
    summary,
  };

  fs.writeFileSync(filePath, JSON.stringify(sanitizeObject({ _meta, ...data }), null, 2));

  if (process.env.TAPSITE_REPORT === '1') {
    const mdPath = path.join(dir, `${name}-${tsFile}.md`);
    const lines = [
      `# ${_meta.tool}`,
      '',
      '## Report Info',
      '',
      `| Field       | Value |`,
      `|-------------|-------|`,
      `| **Tool**    | \`${_meta.tool}\` |`,
      `| **URL**     | ${_meta.url || '—'} |`,
      `| **Timestamp** | ${_meta.timestamp} |`,
      `| **Version** | ${_meta.version} |`,
    ];
    if (_meta.description) {
      lines.push(`| **Description** | ${_meta.description} |`);
    }
    lines.push('', '## Summary', '', summary, '');
    fs.writeFileSync(mdPath, lines.join('\n'));
  }

  const sanitized = sanitizeForLLM(summary);
  return {
    content: [{ type: 'text', text: `${sanitized}\n\nFull data: ${filePath}` }],
  };
}

async function indexPage() {
  const result = await inspectPageV2(browser.page);
  browser.elementMap = result.elements;
  return result;
}

function resolveElement(index) {
  const el = browser.elementMap.find((e) => e.index === index);
  if (!el) {
    throw new Error(
      `Element [${index}] not found. Valid indices: 1-${browser.elementMap.length}. Re-inspect the page to get updated indices.`
    );
  }
  return { locator: browser.page.locator(el.selector).first(), element: el };
}

function formatIndexResult(result) {
  const text = `Title: ${result.title}\nURL: ${result.url}\n\nInteractive elements: ${result.elements.length}\n\n${result.compressedDOM}`;
  return sanitizeForLLM(text);
}

async function safeEvaluate(page, fn, arg, timeoutMs) {
  const timeout = timeoutMs || config.EVAL_TIMEOUT_MS;
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`page.evaluate() timed out after ${timeout}ms`)), timeout);
  });
  try {
    return await Promise.race([
      page.evaluate(fn, arg),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { navigateIfNeeded, requireSafeUrl, summarizeResult, indexPage, resolveElement, formatIndexResult, safeEvaluate };
