const path = require('path');
const fs = require('fs');
const { sanitizeForLLM } = require('./sanitizer');
const { inspectPageV2 } = require('./inspector');
const config = require('./config');
const browser = require('./browser');
const { isBlocked, AntiBot, STEALTH_INIT_SCRIPT, UNDETECTED_ARGS } = require('./anti-bot');
const { ProxyManager } = require('./proxy');
// Lazy-loaded to allow test override via _setChromium
let _chromium = null;
function getChromium() {
  if (!_chromium) _chromium = require('./stealth-setup').chromium;
  return _chromium;
}
function _setChromium(c) { _chromium = c; }

const antiBot = new AntiBot();
const proxyManager = new ProxyManager(config.PROXY_LIST);

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
  requireSafeUrl(url);
  if (!browser.page) throw new Error('Browser not initialized');
  const current = browser.page.url();
  if (current === url) return;
  await safeNavigate(browser.page, url, { waitMs });
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
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`page.evaluate() timed out after ${timeout}ms`)), timeout);
    });
    try {
      return await Promise.race([
        page.evaluate(fn, arg),
        timeoutPromise,
      ]);
    } catch (err) {
      clearTimeout(timer);
      const retryable = /execution context|destroyed|navigating|target closed/i.test(err.message);
      if (retryable && attempt < maxRetries) {
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(500);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function safeNavigate(page, url, opts = {}) {
  requireSafeUrl(url);
  const { waitUntil = 'networkidle', timeout = 30000, waitMs = 1000 } = opts;
  const domain = new URL(url).hostname;
  const startTier = antiBot.getTier(domain);

  for (let tier = startTier; tier <= config.ANTI_BOT_MAX_TIER; tier++) {
    let navPage = page;
    let tmpBrowser = null;

    try {
      // Tier 3: launch separate browser with undetected args
      if (tier === 3) {
        const proxyOpt = proxyManager.hasProxies ? proxyManager.next() : null;
        const launchOpts = { headless: true, args: UNDETECTED_ARGS };
        if (proxyOpt) launchOpts.proxy = { server: proxyOpt.url, username: proxyOpt.username, password: proxyOpt.password };
        tmpBrowser = await getChromium().launch(launchOpts);
        const tmpContext = await tmpBrowser.newContext({ viewport: config.VIEWPORT });
        navPage = await tmpContext.newPage();
        await navPage.addInitScript(STEALTH_INIT_SCRIPT);
      } else if (tier >= 2) {
        // Tier 2: stealth init script + proxy awareness
        await page.addInitScript(STEALTH_INIT_SCRIPT).catch(() => {});
      }

      let response;
      try {
        response = await navPage.goto(url, { waitUntil, timeout });
      } catch {
        try {
          response = await navPage.goto(url, { waitUntil: 'domcontentloaded', timeout });
        } catch {}
      }

      const statusCode = response ? response.status() : 0;
      const blocked = await isBlocked(navPage, statusCode);

      if (!blocked) {
        antiBot.recordSuccess(domain);
        // If tier 3 succeeded, copy content back to original page
        if (tmpBrowser && navPage !== page) {
          const content = await navPage.content();
          await page.setContent(content);
        }
        if (waitMs > 0) await page.waitForTimeout(waitMs);
        return response;
      }

      // Record proxy failure if one was used
      if (tier >= 2 && proxyManager.hasProxies) {
        const usedProxy = proxyManager._proxies[((proxyManager._index - 1) + proxyManager._proxies.length) % proxyManager._proxies.length];
        if (usedProxy) proxyManager.recordFailure(usedProxy.url);
      }

      // Blocked — escalate
      antiBot.escalate(domain);
      if (tier < config.ANTI_BOT_MAX_TIER) {
        await page.waitForTimeout(config.ANTI_BOT_RETRY_DELAY);
      }
    } finally {
      if (tmpBrowser) await tmpBrowser.close().catch(() => {});
    }
  }

  // All tiers exhausted
  if (waitMs > 0) await page.waitForTimeout(waitMs);
  return null;
}

module.exports = { navigateIfNeeded, requireSafeUrl, summarizeResult, indexPage, resolveElement, formatIndexResult, safeEvaluate, safeNavigate, _setChromium };
