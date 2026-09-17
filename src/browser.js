const { BrowserPool } = require('./browser-pool');
const config = require('./config');
const { ensureDisplay } = require('./display');
const fs = require('fs');

let pool = null;
let elementMap = [];

/**
 * Throw a useful error rather than letting Playwright fail with a raw
 * "Missing X server or $DISPLAY" stack trace.
 */
function requireDisplay() {
  const result = ensureDisplay();
  if (!result.ok) {
    throw new Error(
      `Cannot open a headed browser: ${result.reason}. ` +
      'On WSL make sure WSLg is running, or set DISPLAY explicitly. ' +
      'Headless calls are unaffected.'
    );
  }
  return result;
}

async function ensureBrowser(headless = true) {
  if (pool) {
    // Reuse the live pool, EXCEPT when a headed browser is requested and the
    // live pool is headless. That case is the trap: login_manual would silently
    // receive a headless browser, no window would ever appear, and it would
    // still report success.
    //
    // Deliberately ASYMMETRIC: a headless request must never tear down a headed
    // pool, because extractors are expected to reuse an authenticated headed
    // session and tearing it down would destroy the login.
    if (headless !== false || pool.headless === false) return;
    await closeBrowser();
  }
  if (headless === false) requireDisplay();
  pool = new BrowserPool({ poolSize: config.POOL_SIZE, headless });
  await pool.init();
}

async function closeBrowser() {
  if (pool) {
    const draining = pool;
    pool = null;
    elementMap = [];
    await draining.drain();
  }
}

// Used by cli.js — standalone persistent context, not pool-managed
// NOTE: stealth plugin already registered globally via stealth-setup.js
async function launchPersistent({ headless = false } = {}) {
  if (headless === false) requireDisplay();
  const { chromium } = require('./stealth-setup');
  fs.mkdirSync(config.PROFILE_DIR, { recursive: true });
  const ctx = await chromium.launchPersistentContext(config.PROFILE_DIR, {
    headless,
    viewport: config.VIEWPORT,
    userAgent: config.USER_AGENT,
    ignoreHTTPSErrors: false,
    acceptDownloads: false,
  });
  return ctx;
}

module.exports = {
  get context() { return pool ? pool.primaryContext : null; },
  get page() { return pool ? pool.primaryPage : null; },
  get pool() { return pool; },
  get elementMap() { return elementMap; },
  set elementMap(v) { elementMap = v; },
  ensureBrowser,
  closeBrowser,
  launchPersistent,
  requireDisplay,
};
