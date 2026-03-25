'use strict';

const config = require('./config');

const BLOCK_PATTERNS = [
  /ray\s*id/i,
  /cloudflare/i,
  /checking\s+(if\s+the\s+site|your\s+browser)/i,
  /access\s+denied/i,
  /please\s+verify/i,
  /captcha/i,
  /hcaptcha/i,
  /recaptcha/i,
  /just\s+a\s+moment/i,
  /blocked/i,
  /rate\s+limit/i,
];

const BLOCKED_STATUS_CODES = new Set([403, 429, 503]);

async function isBlocked(page, statusCode) {
  if (BLOCKED_STATUS_CODES.has(statusCode)) return true;

  try {
    const { bodyText } = await page.evaluate(() => ({
      bodyText: document.body ? document.body.innerText.slice(0, 2000) : '',
    }));
    return BLOCK_PATTERNS.some(p => p.test(bodyText));
  } catch {
    return false;
  }
}

class AntiBot {
  constructor(opts = {}) {
    this._maxTier = opts.maxTier || config.ANTI_BOT_MAX_TIER;
    this._retryDelay = opts.retryDelay || config.ANTI_BOT_RETRY_DELAY;
    this._domainTiers = new Map();
  }

  getTier(domain) {
    return this._domainTiers.get(domain) || 1;
  }

  escalate(domain) {
    const current = this.getTier(domain);
    if (current < this._maxTier) {
      this._domainTiers.set(domain, current + 1);
    }
    return this.getTier(domain);
  }

  recordSuccess(domain) {
    // Lock in the current tier — don't reset, avoid re-escalation
  }

  get retryDelay() { return this._retryDelay; }
}

const UNDETECTED_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-infobars',
  '--no-first-run',
];

const STEALTH_INIT_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) window.chrome.runtime = undefined;
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(type) {
    const ctx = this.getContext('2d');
    if (ctx) {
      const imageData = ctx.getImageData(0, 0, this.width, this.height);
      for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i] = imageData.data[i] ^ 1;
      }
      ctx.putImageData(imageData, 0, 0);
    }
    return origToDataURL.call(this, type);
  };
`;

module.exports = { isBlocked, AntiBot, UNDETECTED_ARGS, STEALTH_INIT_SCRIPT };
