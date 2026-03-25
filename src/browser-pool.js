// Import chromium with stealth plugin already registered
const { chromium: defaultChromium } = require('./stealth-setup');
const config = require('./config');
const fs = require('fs');

class BrowserPool {
  /**
   * @param {object} opts
   * @param {number} [opts.poolSize]
   * @param {number} [opts.healthCheckTimeout]
   * @param {object} [opts.chromium] - Chromium launcher (for testing)
   */
  constructor(opts = {}) {
    this._chromium = opts.chromium ?? defaultChromium;
    this._poolSize = opts.poolSize ?? config.POOL_SIZE;
    this._healthCheckTimeout = opts.healthCheckTimeout ?? config.POOL_HEALTH_CHECK_TIMEOUT_MS;
    this._acquireTimeout = opts.acquireTimeout ?? 30000;
    this._browser = null;
    this._primaryContext = null;
    this._primaryPage = null;
    /** @type {{ context: any, available: boolean }[]} */
    this._slots = [];
    /** @type {Array<(index: number) => void>} */
    this._waitQueue = [];
  }

  // ── Properties ───────────────────────────────────────────────────────────

  get size() {
    return this._slots.length;
  }

  get primaryContext() {
    return this._primaryContext;
  }

  get primaryPage() {
    return this._primaryPage;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async init() {
    // Launch shared browser
    this._browser = await this._chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });

    // Launch persistent context for auth/session data
    fs.mkdirSync(config.PROFILE_DIR, { recursive: true });
    this._primaryContext = await this._chromium.launchPersistentContext(config.PROFILE_DIR, {
      headless: true,
      viewport: config.VIEWPORT,
      ignoreHTTPSErrors: false,
      acceptDownloads: false,
    });
    const pages = this._primaryContext.pages();
    this._primaryPage = pages[0] || (await this._primaryContext.newPage());

    // Create pool slot contexts from the shared browser
    this._slots = [];
    for (let i = 0; i < this._poolSize; i++) {
      const context = await this._browser.newContext();
      this._slots.push({ context, available: true });
    }
  }

  // ── Acquire / Release ────────────────────────────────────────────────────

  async acquire() {
    const index = await this._getAvailableSlot();
    const slot = this._slots[index];
    slot.available = false;

    // Health check; replace if unhealthy
    const healthy = await this._isHealthy(slot);
    if (!healthy) {
      await this._replaceSlot(index);
    }

    // Copy auth cookies from primary context
    await this._copyAuthState(this._slots[index].context);

    const page = await this._slots[index].context.newPage();

    return {
      context: this._slots[index].context,
      page,
      release: () => this._release(index),
    };
  }

  async _release(index) {
    const slot = this._slots[index];
    if (!slot) return;

    // Close all pages in this context to clean up
    try {
      const pages = await slot.context.pages();
      for (const p of pages) {
        await p.close().catch(() => {});
      }
    } catch {
      // context may be dead — will be replaced on next acquire
    }

    slot.available = true;

    // Service wait queue
    if (this._waitQueue.length > 0) {
      const resolve = this._waitQueue.shift();
      resolve(index);
    }
  }

  /**
   * Returns the index of an available slot. Blocks if all are busy.
   * @returns {Promise<number>}
   */
  _getAvailableSlot() {
    for (let i = 0; i < this._slots.length; i++) {
      if (this._slots[i].available) {
        return Promise.resolve(i);
      }
    }
    // All busy — queue a waiter
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._waitQueue.indexOf(entry);
        if (idx !== -1) this._waitQueue.splice(idx, 1);
        reject(new Error('Pool acquire timeout'));
      }, this._acquireTimeout);
      const entry = (index) => {
        clearTimeout(timer);
        resolve(index);
      };
      this._waitQueue.push(entry);
    });
  }

  // ── Drain ────────────────────────────────────────────────────────────────

  async drain() {
    // Close pool slot contexts
    for (const slot of this._slots) {
      try { await slot.context.close(); } catch { /* ignore */ }
    }
    this._slots = [];

    // Close primary context
    if (this._primaryContext) {
      try { await this._primaryContext.close(); } catch { /* ignore */ }
      this._primaryContext = null;
      this._primaryPage = null;
    }

    // Close browser
    if (this._browser) {
      try { await this._browser.close(); } catch { /* ignore */ }
      this._browser = null;
    }
  }

  // ── Health ───────────────────────────────────────────────────────────────

  async _isHealthy(slot) {
    try {
      await Promise.race([
        slot.context.pages(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('health check timeout')), this._healthCheckTimeout)
        ),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async _replaceSlot(index) {
    const old = this._slots[index];
    try { await old.context.close(); } catch { /* ignore */ }

    const context = await this._browser.newContext();
    this._slots[index] = { context, available: false };
  }

  // ── Auth State ───────────────────────────────────────────────────────────

  async _copyAuthState(targetContext) {
    try {
      const cookies = await this._primaryContext.cookies();
      if (cookies.length > 0) {
        await targetContext.addCookies(cookies);
      }
    } catch {
      // Primary context may not have cookies yet — that's fine
    }
  }
}

module.exports = { BrowserPool };
