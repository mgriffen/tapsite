const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const config = require('./config');
const fs = require('fs');

chromium.use(stealth());

let context = null;
let page = null;
let isHeadless = null;
let elementMap = [];

async function ensureBrowser(headless = true) {
  if (context) return;
  fs.mkdirSync(config.PROFILE_DIR, { recursive: true });
  context = await chromium.launchPersistentContext(config.PROFILE_DIR, {
    headless,
    viewport: config.VIEWPORT,
    ignoreHTTPSErrors: false,
    acceptDownloads: false,
  });
  isHeadless = headless;
  page = context.pages()[0] || (await context.newPage());
}

async function closeBrowser() {
  if (context) {
    await context.close();
    context = null;
    page = null;
    isHeadless = null;
    elementMap = [];
  }
}

// Used by cli.js
async function launchPersistent({ headless = false } = {}) {
  fs.mkdirSync(config.PROFILE_DIR, { recursive: true });
  const ctx = await chromium.launchPersistentContext(config.PROFILE_DIR, {
    headless,
    viewport: config.VIEWPORT,
    ignoreHTTPSErrors: false,
    acceptDownloads: false,
  });
  return ctx;
}

function isStealthEnabled() { return true; }

module.exports = {
  get context() { return context; },
  get page() { return page; },
  get elementMap() { return elementMap; },
  set elementMap(v) { elementMap = v; },
  ensureBrowser,
  closeBrowser,
  launchPersistent,
};
