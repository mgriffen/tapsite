const { BrowserPool } = require('./browser-pool');
const config = require('./config');
const fs = require('fs');

let pool = null;
let elementMap = [];

async function ensureBrowser(headless = true) {
  if (pool) return;
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
};
