const path = require('path');
const fs = require('fs');
const { sanitizeForLLM } = require('./sanitizer');
const { inspectPageV2 } = require('./inspector');
const config = require('./config');
const browser = require('./browser');

const PKG_VERSION = require('../package.json').version;

async function navigateIfNeeded(url, waitMs = 1500) {
  if (!url) return;
  try {
    await browser.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch {}
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

  fs.writeFileSync(filePath, JSON.stringify({ _meta, ...data }, null, 2));

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

module.exports = { navigateIfNeeded, summarizeResult, indexPage, resolveElement, formatIndexResult };
