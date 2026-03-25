const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

module.exports = {
  ROOT_DIR,
  PROFILE_DIR: path.join(ROOT_DIR, 'profiles', 'default'),
  OUTPUT_DIR: path.join(ROOT_DIR, 'output'),
  BROWSER_TYPE: 'chromium',
  VIEWPORT: { width: 1440, height: 900 },
  MAX_ELEMENTS: 200,
  MAX_DOM_LENGTH: 8000,
  MAX_COLORS: 50,
  EVAL_TIMEOUT_MS: 30000,
  POOL_SIZE: parseInt(process.env.TAPSITE_POOL_SIZE, 10) || 4,
  CRAWL_CONCURRENCY: parseInt(process.env.TAPSITE_CRAWL_CONCURRENCY, 10) || 4,
  POOL_HEALTH_CHECK_TIMEOUT_MS: 5000,
  CACHE_DIR: path.join(ROOT_DIR, 'output', 'cache'),
  CACHE_TTL_MS: 3600000, // 1 hour
  PROXY_LIST: JSON.parse(process.env.TAPSITE_PROXIES || '[]'),
  ANTI_BOT_MAX_TIER: 3,
  ANTI_BOT_RETRY_DELAY: 2000,
};
