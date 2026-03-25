'use strict';

const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_MS = 300000; // 5 minutes

class ProxyManager {
  constructor(proxies = []) {
    this._proxies = proxies.map(p => ({
      ...p,
      failures: 0,
      disabledUntil: 0,
    }));
    this._index = 0;
  }

  next() {
    if (this._proxies.length === 0) return null;
    const now = Date.now();
    let tried = 0;

    while (tried < this._proxies.length) {
      const proxy = this._proxies[this._index % this._proxies.length];
      this._index = (this._index + 1) % this._proxies.length;
      tried++;

      if (proxy.failures >= MAX_CONSECUTIVE_FAILURES && now < proxy.disabledUntil) {
        continue;
      }
      if (proxy.failures >= MAX_CONSECUTIVE_FAILURES && now >= proxy.disabledUntil) {
        proxy.failures = 0;
      }
      return proxy;
    }

    return null;
  }

  recordFailure(proxyUrl) {
    const proxy = this._proxies.find(p => p.url === proxyUrl);
    if (!proxy) return;
    proxy.failures++;
    if (proxy.failures >= MAX_CONSECUTIVE_FAILURES) {
      proxy.disabledUntil = Date.now() + BACKOFF_MS;
    }
  }

  recordSuccess(proxyUrl) {
    const proxy = this._proxies.find(p => p.url === proxyUrl);
    if (!proxy) return;
    proxy.failures = 0;
    proxy.disabledUntil = 0;
  }

  get hasProxies() {
    return this._proxies.length > 0;
  }
}

module.exports = { ProxyManager };
