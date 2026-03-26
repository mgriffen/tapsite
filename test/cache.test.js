import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

describe('CrawlCache', () => {
  let tmpDir;
  let CrawlCache;
  let config;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapsite-cache-'));
    config = require('../src/config.js');
    config.CACHE_DIR = tmpDir;
    delete require.cache[require.resolve('../src/cache.js')];
    CrawlCache = require('../src/cache.js');
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeCache(opts = {}) {
    return new CrawlCache({ domain: 'example.com', baseDir: tmpDir, ttlMs: 3600000, ...opts });
  }

  describe('get', () => {
    it('returns null for a cache miss', () => {
      const cache = makeCache();
      const result = cache.get('https://example.com/page');
      expect(result).toBeNull();
    });

    it('stores and retrieves cached result', () => {
      const cache = makeCache();
      const data = { title: 'Test Page', elements: [1, 2, 3] };
      cache.set('https://example.com/page', data, 'abc123');
      const result = cache.get('https://example.com/page');
      expect(result).toEqual(data);
    });

    it('returns null for expired entries', () => {
      vi.useFakeTimers();
      const ttlMs = 3600000;
      const cache = makeCache({ ttlMs });
      const data = { title: 'Stale Page' };
      cache.set('https://example.com/stale', data, 'hash1');

      // Advance time past TTL
      vi.advanceTimersByTime(ttlMs + 1);

      // Need a fresh cache instance so it re-reads manifest with same timestamps
      delete require.cache[require.resolve('../src/cache.js')];
      CrawlCache = require('../src/cache.js');
      const cache2 = new CrawlCache({ domain: 'example.com', baseDir: tmpDir, ttlMs });
      const result = cache2.get('https://example.com/stale');
      expect(result).toBeNull();
    });
  });

  describe('hasChanged', () => {
    it('returns false for same content hash', () => {
      const cache = makeCache();
      const data = { title: 'Page' };
      cache.set('https://example.com/page', data, 'hash-aaa');
      expect(cache.hasChanged('https://example.com/page', 'hash-aaa')).toBe(false);
    });

    it('returns true for different content hash', () => {
      const cache = makeCache();
      const data = { title: 'Page' };
      cache.set('https://example.com/page', data, 'hash-aaa');
      expect(cache.hasChanged('https://example.com/page', 'hash-bbb')).toBe(true);
    });

    it('returns true when no entry exists', () => {
      const cache = makeCache();
      expect(cache.hasChanged('https://example.com/new', 'hash-xyz')).toBe(true);
    });
  });

  describe('queue persistence', () => {
    it('saves and restores queue state', () => {
      const cache = makeCache();
      const queueState = {
        pending: ['https://example.com/a', 'https://example.com/b'],
        startUrl: 'https://example.com',
        config: { maxPages: 10 },
      };
      cache.saveQueue(queueState);
      const loaded = cache.loadQueue();
      expect(loaded).toEqual(queueState);
    });

    it('returns null when no saved queue exists', () => {
      const cache = makeCache();
      const result = cache.loadQueue();
      expect(result).toBeNull();
    });

    it('clearQueue removes the queue file', () => {
      const cache = makeCache();
      cache.saveQueue({ pending: [], startUrl: 'https://example.com', config: {} });
      cache.clearQueue();
      const result = cache.loadQueue();
      expect(result).toBeNull();
    });
  });

  describe('completedUrls', () => {
    it('returns list of completed, non-expired URLs', () => {
      vi.useFakeTimers();
      const ttlMs = 3600000;
      const cache = makeCache({ ttlMs });

      cache.set('https://example.com/page1', { title: 'P1' }, 'h1');
      cache.set('https://example.com/page2', { title: 'P2' }, 'h2');

      const urls = cache.completedUrls();
      expect(urls).toContain('https://example.com/page1');
      expect(urls).toContain('https://example.com/page2');
      expect(urls).toHaveLength(2);
    });

    it('excludes expired URLs from completedUrls', () => {
      vi.useFakeTimers();
      const ttlMs = 3600000;
      const cache = makeCache({ ttlMs });

      cache.set('https://example.com/old', { title: 'Old' }, 'h-old');

      vi.advanceTimersByTime(ttlMs + 1);

      cache.set('https://example.com/new', { title: 'New' }, 'h-new');

      delete require.cache[require.resolve('../src/cache.js')];
      CrawlCache = require('../src/cache.js');
      const cache2 = new CrawlCache({ domain: 'example.com', baseDir: tmpDir, ttlMs });

      const urls = cache2.completedUrls();
      expect(urls).not.toContain('https://example.com/old');
      expect(urls).toContain('https://example.com/new');
    });
  });

  describe('cache key normalization', () => {
    it('normalizes URLs with sorted query params to the same key', () => {
      const cache = makeCache();
      const data = { title: 'Normalized' };

      // Set with one param order
      cache.set('https://example.com/search?z=last&a=first', data, 'hashN');

      // Get with different param order - should hit same cache entry
      const result = cache.get('https://example.com/search?a=first&z=last');
      expect(result).toEqual(data);
    });

    it('treats URLs differing only in param order as the same key', () => {
      const cache = makeCache();
      cache.set('https://example.com/q?b=2&a=1', { v: 1 }, 'h1');
      cache.set('https://example.com/q?a=1&b=2', { v: 2 }, 'h2');

      // Both writes go to the same key, second overwrites first
      const result = cache.get('https://example.com/q?a=1&b=2');
      expect(result).toEqual({ v: 2 });
    });
  });
});
