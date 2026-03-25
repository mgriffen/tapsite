import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

// ── Module mocks (prevent real playwright / pool from loading) ───────────────

vi.mock('../src/stealth-setup.js', () => ({
  chromium: { use: vi.fn(), launch: vi.fn(), launchPersistentContext: vi.fn() },
}));

vi.mock('../src/browser-pool.js', () => {
  class MockBrowserPool {
    constructor(opts = {}) {
      this._opts = opts;
      this._headless = opts.headless ?? true;
      this._primaryContext = { id: 'mock-context' };
      this._primaryPage = { id: 'mock-page', goto: vi.fn() };
    }
    get primaryContext() { return this._primaryContext; }
    get primaryPage() { return this._primaryPage; }
    async init() {}
    async drain() {
      this._primaryContext = null;
      this._primaryPage = null;
    }
  }

  return { BrowserPool: MockBrowserPool };
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('browser.js facade', () => {
  let browser;

  beforeEach(async () => {
    vi.resetModules();
    const req = createRequire(import.meta.url);
    browser = req('../src/browser.js');
  });

  afterEach(async () => {
    if (browser) {
      await browser.closeBrowser();
    }
  });

  it('should expose ensureBrowser that delegates to pool', async () => {
    await browser.ensureBrowser();
    expect(browser.page).toBeTruthy();
    expect(browser.context).toBeTruthy();
    expect(browser.pool).toBeTruthy();
    await browser.closeBrowser();
  });

  it('should return null for context and page before init', () => {
    expect(browser.context).toBeNull();
    expect(browser.page).toBeNull();
    expect(browser.pool).toBeNull();
  });

  it('should preserve elementMap on the facade', async () => {
    await browser.ensureBrowser();
    browser.elementMap = [{ index: 1, selector: '.test' }];
    expect(browser.elementMap).toEqual([{ index: 1, selector: '.test' }]);
    await browser.closeBrowser();
  });

  it('should reset elementMap on closeBrowser', async () => {
    await browser.ensureBrowser();
    browser.elementMap = [{ index: 1, selector: '.test' }];
    await browser.closeBrowser();
    expect(browser.elementMap).toEqual([]);
  });

  it('should not re-init pool if already initialized', async () => {
    await browser.ensureBrowser();
    const poolRef = browser.pool;
    await browser.ensureBrowser(); // second call should be a no-op
    expect(browser.pool).toBe(poolRef);
    await browser.closeBrowser();
  });

  it('should forward headless=false to BrowserPool constructor', async () => {
    await browser.ensureBrowser(false);
    expect(browser.pool).toBeTruthy();
    expect(browser.pool._headless).toBe(false);
    await browser.closeBrowser();
  });

  it('should forward headless=true (default) to BrowserPool constructor', async () => {
    await browser.ensureBrowser();
    expect(browser.pool).toBeTruthy();
    expect(browser.pool._headless).toBe(true);
    await browser.closeBrowser();
  });
});
