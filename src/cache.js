'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config.js');

/**
 * CrawlCache — disk-backed cache for crawl results.
 *
 * Scope: GET requests only. POSTs and other mutating requests are not cached.
 *
 * Structure on disk:
 *   {baseDir}/{domain}/
 *     manifest.json          — { [normalizedUrl]: { fileHash, contentHash, timestamp } }
 *     queue.json             — { pending, startUrl, config }
 *     pages/{fileHash}.json  — cached extraction result for a URL
 */
class CrawlCache {
  /**
   * @param {object} opts
   * @param {string} opts.domain   - Hostname used as the cache subdirectory name.
   * @param {string} [opts.baseDir] - Base directory for all cache files (default: config.CACHE_DIR).
   * @param {number} [opts.ttlMs]  - Time-to-live in milliseconds (default: config.CACHE_TTL_MS).
   */
  constructor(opts = {}) {
    const { domain, baseDir, ttlMs } = opts;
    if (!domain) throw new Error('CrawlCache: domain is required');

    this._domain = domain;
    this._ttlMs = ttlMs != null ? ttlMs : config.CACHE_TTL_MS;
    this._cacheDir = path.join(baseDir || config.CACHE_DIR, domain);
    this._pagesDir = path.join(this._cacheDir, 'pages');
    this._manifestPath = path.join(this._cacheDir, 'manifest.json');
    this._queuePath = path.join(this._cacheDir, 'queue.json');

    fs.mkdirSync(this._pagesDir, { recursive: true });

    this._manifest = this._readManifest();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  _readManifest() {
    if (!fs.existsSync(this._manifestPath)) return {};
    try {
      return JSON.parse(fs.readFileSync(this._manifestPath, 'utf8'));
    } catch {
      return {};
    }
  }

  _writeManifest() {
    fs.writeFileSync(this._manifestPath, JSON.stringify(this._manifest, null, 2), 'utf8');
  }

  /**
   * Normalize a URL to a stable cache key.
   * Keeps origin + pathname; sorts query parameters alphabetically.
   * Fragment (#) is ignored.
   */
  _normalizeUrl(url) {
    try {
      const u = new URL(url);
      const params = [...u.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      const sorted = new URLSearchParams(params);
      const qs = sorted.toString();
      return u.origin + u.pathname + (qs ? '?' + qs : '');
    } catch {
      // Fallback: return as-is
      return url;
    }
  }

  /**
   * Derive the first 16 hex chars of the SHA-256 hash of a string.
   */
  _hashString(str) {
    return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
  }

  _isExpired(entry) {
    return Date.now() - entry.timestamp > this._ttlMs;
  }

  _pageFilePath(fileHash) {
    return path.join(this._pagesDir, `${fileHash}.json`);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Retrieve cached data for a URL.
   * Returns null on miss or if the entry has expired.
   */
  get(url) {
    const key = this._normalizeUrl(url);
    const entry = this._manifest[key];
    if (!entry) return null;
    if (this._isExpired(entry)) return null;

    const filePath = this._pageFilePath(entry.fileHash);
    if (!fs.existsSync(filePath)) return null;

    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * Store data in the cache for a URL.
   * @param {string} url
   * @param {*} data          - The extraction result to cache.
   * @param {string} contentHash - A hash of the page content (used for change detection).
   */
  set(url, data, contentHash) {
    const key = this._normalizeUrl(url);
    const fileHash = this._hashString(key);
    const filePath = this._pageFilePath(fileHash);

    fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');

    this._manifest[key] = {
      fileHash,
      contentHash: contentHash || null,
      timestamp: Date.now(),
    };

    this._writeManifest();
  }

  /**
   * Returns true if the page content has changed since it was cached,
   * or if no cache entry exists.
   * Returns false if the content hash matches the cached hash.
   */
  hasChanged(url, newContentHash) {
    const key = this._normalizeUrl(url);
    const entry = this._manifest[key];
    if (!entry) return true;
    return entry.contentHash !== newContentHash;
  }

  /**
   * Returns true if the URL has a valid, non-expired cache entry.
   */
  isComplete(url) {
    const key = this._normalizeUrl(url);
    const entry = this._manifest[key];
    if (!entry) return false;
    if (this._isExpired(entry)) return false;
    return fs.existsSync(this._pageFilePath(entry.fileHash));
  }

  /**
   * Returns an array of all cached URLs that are complete and non-expired.
   * Uses only the public manifest (no private internal access to page files).
   */
  completedUrls() {
    const now = Date.now();
    return Object.entries(this._manifest)
      .filter(([, entry]) => (now - entry.timestamp) <= this._ttlMs)
      .map(([url]) => url);
  }

  // ---------------------------------------------------------------------------
  // Queue persistence
  // ---------------------------------------------------------------------------

  /**
   * Persist the current crawl queue state to disk.
   * @param {{ pending: string[], startUrl: string, config: object }} queueState
   */
  saveQueue(queueState) {
    fs.writeFileSync(this._queuePath, JSON.stringify(queueState, null, 2), 'utf8');
  }

  /**
   * Load a previously persisted queue state.
   * Returns null if no queue file exists.
   */
  loadQueue() {
    if (!fs.existsSync(this._queuePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(this._queuePath, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * Delete the persisted queue file.
   */
  clearQueue() {
    if (fs.existsSync(this._queuePath)) {
      fs.unlinkSync(this._queuePath);
    }
  }
}

module.exports = CrawlCache;
