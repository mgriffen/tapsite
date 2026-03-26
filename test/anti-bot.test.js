import { describe, it, expect, vi, beforeAll } from 'vitest';

describe('ProxyManager', () => {
  let ProxyManager;

  beforeAll(async () => {
    const mod = await import('../src/proxy.js');
    ProxyManager = mod.ProxyManager;
  });

  it('should return null when no proxies configured', () => {
    const pm = new ProxyManager([]);
    expect(pm.next()).toBeNull();
  });

  it('should rotate through proxies round-robin', () => {
    const proxies = [
      { url: 'http://proxy1:8080' },
      { url: 'http://proxy2:8080' },
    ];
    const pm = new ProxyManager(proxies);
    expect(pm.next().url).toBe('http://proxy1:8080');
    expect(pm.next().url).toBe('http://proxy2:8080');
    expect(pm.next().url).toBe('http://proxy1:8080');
  });

  it('should mark proxy as failed and skip after 3 failures', () => {
    const proxies = [
      { url: 'http://proxy1:8080' },
      { url: 'http://proxy2:8080' },
    ];
    const pm = new ProxyManager(proxies);
    pm.recordFailure('http://proxy1:8080');
    pm.recordFailure('http://proxy1:8080');
    pm.recordFailure('http://proxy1:8080');
    expect(pm.next().url).toBe('http://proxy2:8080');
    expect(pm.next().url).toBe('http://proxy2:8080');
  });

  it('should return null when all proxies are failed', () => {
    const proxies = [{ url: 'http://proxy1:8080' }];
    const pm = new ProxyManager(proxies);
    pm.recordFailure('http://proxy1:8080');
    pm.recordFailure('http://proxy1:8080');
    pm.recordFailure('http://proxy1:8080');
    expect(pm.next()).toBeNull();
  });

  it('should record success and reset failure count', () => {
    const proxies = [{ url: 'http://proxy1:8080' }];
    const pm = new ProxyManager(proxies);
    pm.recordFailure('http://proxy1:8080');
    pm.recordFailure('http://proxy1:8080');
    pm.recordSuccess('http://proxy1:8080');
    expect(pm.next().url).toBe('http://proxy1:8080');
  });
});

describe('AntiBot', () => {
  let isBlocked, AntiBot;

  beforeAll(async () => {
    const mod = await import('../src/anti-bot.js');
    isBlocked = mod.isBlocked;
    AntiBot = mod.AntiBot;
  });

  describe('isBlocked', () => {
    it('should detect 403 status as blocked', async () => {
      const page = {
        evaluate: vi.fn(() => ({ status: 403, bodyText: '' })),
      };
      expect(await isBlocked(page, 403)).toBe(true);
    });

    it('should detect 429 status as blocked', async () => {
      const page = { evaluate: vi.fn(() => ({ status: 429, bodyText: '' })) };
      expect(await isBlocked(page, 429)).toBe(true);
    });

    it('should detect Cloudflare challenge page', async () => {
      const page = {
        evaluate: vi.fn(() => ({ status: 200, bodyText: 'Checking if the site connection is secure Ray ID: abc123' })),
      };
      expect(await isBlocked(page, 200)).toBe(true);
    });

    it('should not flag normal pages', async () => {
      const page = {
        evaluate: vi.fn(() => ({ status: 200, bodyText: 'Welcome to our website' })),
      };
      expect(await isBlocked(page, 200)).toBe(false);
    });
  });

  describe('AntiBot tier management', () => {
    it('should start at tier 1', () => {
      const ab = new AntiBot();
      expect(ab.getTier('example.com')).toBe(1);
    });

    it('should escalate tier on failure', () => {
      const ab = new AntiBot();
      ab.escalate('example.com');
      expect(ab.getTier('example.com')).toBe(2);
    });

    it('should remember successful tier per domain', () => {
      const ab = new AntiBot();
      ab.escalate('example.com');
      ab.recordSuccess('example.com');
      expect(ab.getTier('example.com')).toBe(2);
    });

    it('should cap at max tier', () => {
      const ab = new AntiBot({ maxTier: 3 });
      ab.escalate('example.com');
      ab.escalate('example.com');
      ab.escalate('example.com');
      expect(ab.getTier('example.com')).toBe(3);
    });
  });
});
