import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock helpers ─────────────────────────────────────────────────────────────

function makeMockPage() {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue('about:blank'),
  };
}

function makeMockContext() {
  const page = makeMockPage();
  return {
    newPage: vi.fn().mockResolvedValue(page),
    pages: vi.fn().mockReturnValue([page]),
    cookies: vi.fn().mockResolvedValue([
      { name: 'sid', value: '123', domain: '.example.com', path: '/' },
    ]),
    addCookies: vi.fn().mockResolvedValue(undefined),
    route: vi.fn().mockResolvedValue(undefined),
    addInitScript: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockBrowser() {
  return {
    newContext: vi.fn().mockImplementation(() => Promise.resolve(makeMockContext())),
    close: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
  };
}

function makeMockChromium(browser, primaryContext) {
  return {
    use: vi.fn(),
    launch: vi.fn().mockResolvedValue(browser),
    launchPersistentContext: vi.fn().mockResolvedValue(primaryContext),
  };
}

// ── Module mocks (prevent real playwright from loading) ──────────────────────

vi.mock('../src/stealth-setup.js', () => ({
  chromium: { use: vi.fn(), launch: vi.fn(), launchPersistentContext: vi.fn() },
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { BrowserPool } = require('../src/browser-pool.js');

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BrowserPool', () => {
  let pool;
  let mockBrowser;
  let mockPrimaryContext;
  let mockChromium;

  beforeEach(() => {
    mockBrowser = makeMockBrowser();
    mockPrimaryContext = makeMockContext();
    mockChromium = makeMockChromium(mockBrowser, mockPrimaryContext);
  });

  afterEach(async () => {
    if (pool) {
      try { await pool.drain(); } catch { /* ignore */ }
      pool = null;
    }
  });

  it('should initialize with correct pool size', async () => {
    pool = new BrowserPool({ poolSize: 3, chromium: mockChromium });
    await pool.init();

    expect(pool.size).toBe(3);
    expect(mockBrowser.newContext).toHaveBeenCalledTimes(3);
    expect(pool.primaryContext).toBe(mockPrimaryContext);
  });

  it('should acquire and release a lease', async () => {
    pool = new BrowserPool({ poolSize: 2, chromium: mockChromium });
    await pool.init();

    const lease = await pool.acquire();
    expect(lease).toHaveProperty('context');
    expect(lease).toHaveProperty('page');
    expect(lease).toHaveProperty('release');
    expect(typeof lease.release).toBe('function');

    await lease.release();
  });

  it('should block when pool is exhausted and resolve on release', async () => {
    pool = new BrowserPool({ poolSize: 1, chromium: mockChromium });
    await pool.init();

    const lease1 = await pool.acquire();

    let lease2Resolved = false;
    const lease2Promise = pool.acquire().then((l) => {
      lease2Resolved = true;
      return l;
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(lease2Resolved).toBe(false);

    await lease1.release();
    const lease2 = await lease2Promise;
    expect(lease2Resolved).toBe(true);
    expect(lease2).toHaveProperty('context');

    await lease2.release();
  });

  it('should copy cookies from primary context on acquire', async () => {
    pool = new BrowserPool({ poolSize: 2, chromium: mockChromium });
    await pool.init();

    const lease = await pool.acquire();

    expect(mockPrimaryContext.cookies).toHaveBeenCalled();
    expect(lease.context.addCookies).toHaveBeenCalledWith([
      { name: 'sid', value: '123', domain: '.example.com', path: '/' },
    ]);

    await lease.release();
  });

  it('should drain all contexts and report size 0', async () => {
    pool = new BrowserPool({ poolSize: 2, chromium: mockChromium });
    await pool.init();

    await pool.drain();

    expect(pool.size).toBe(0);
    expect(mockBrowser.close).toHaveBeenCalled();
  });
});

// ── browser.js facade tests are in browser-facade.test.js ───────────────────
