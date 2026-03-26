const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');

if (!chromium._plugins?.some(p => p.name === 'stealth')) {
  chromium.use(stealth());
}

module.exports = { chromium };
