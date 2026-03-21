const { chromium } = require('playwright');
const config = require('./config');
const fs = require('fs');

/**
 * Launch a persistent browser context.
 * The profile directory preserves cookies, localStorage, and session state
 * across runs — so you only need to log in and complete MFA once.
 */
async function launchPersistent({ headless = false } = {}) {
  fs.mkdirSync(config.PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(config.PROFILE_DIR, {
    headless,
    viewport: config.VIEWPORT,
    ignoreHTTPSErrors: false,
    acceptDownloads: false,
  });

  return context;
}

module.exports = { launchPersistent };
