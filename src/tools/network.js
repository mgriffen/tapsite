const { z } = require('zod');
const { detectStackInBrowser } = require('../extractors');
const browser = require('../browser');
const { navigateIfNeeded, requireSafeUrl, summarizeResult, safeEvaluate } = require('../helpers');

const STATIC_RESOURCE_TYPES = new Set(['image', 'stylesheet', 'font', 'media']);
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-auth-token', 'x-api-key', 'x-csrf-token', 'x-xsrf-token']);

function redactHeaders(headers) {
  const safe = {};
  for (const [k, v] of Object.entries(headers)) {
    safe[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return safe;
}

async function captureNetwork({ duration, includeStatic, filterUrl, filterMethod }) {
  const entryMap = new Map();
  const bodyPromises = [];

  const onRequest = (req) => {
    if (!includeStatic && STATIC_RESOURCE_TYPES.has(req.resourceType())) return;
    const url = req.url();
    if (filterUrl && !url.includes(filterUrl)) return;
    if (filterMethod && req.method().toLowerCase() !== filterMethod.toLowerCase()) return;

    entryMap.set(req, {
      url,
      method: req.method(),
      resourceType: req.resourceType(),
      requestHeaders: redactHeaders(req.headers()),
      postData: req.postData() || null,
    });
  };

  const onResponse = (res) => {
    const req = res.request();
    const entry = entryMap.get(req);
    if (!entry) return;

    entry.status = res.status();
    entry.responseHeaders = redactHeaders(res.headers());
    entry.contentType = (res.headers()['content-type'] || '').split(';')[0].trim();

    const ct = entry.contentType;
    if (ct.includes('json') || ct.includes('text/plain') || ct.includes('text/html')) {
      const p = res.text().then((text) => {
        entry.responseBody = text.length > 10000 ? text.slice(0, 10000) + '…' : text;
      }).catch(() => {});
      bodyPromises.push(p);
    }
  };

  browser.page.on('request', onRequest);
  browser.page.on('response', onResponse);

  await browser.page.waitForTimeout(duration * 1000);

  browser.page.off('request', onRequest);
  browser.page.off('response', onResponse);

  await Promise.all(bodyPromises.map((p) => Promise.race([p, new Promise((r) => setTimeout(r, 2000))])));

  return [...entryMap.values()].filter((e) => e.status !== undefined);
}

module.exports = function registerNetworkTools(server, allowTool = () => true) {

  if (allowTool('tapsite_capture_network')) server.tool(
    'tapsite_capture_network',
    'Capture network traffic for a duration. Filters static assets by default.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
      duration: z.number().min(1).max(60).default(10).describe('Seconds to capture (1-60)'),
      includeStatic: z.boolean().default(false).describe('Include images/CSS/fonts'),
      filterUrl: z.string().max(500).optional().describe('Filter: URL contains string'),
      filterMethod: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']).optional().describe('Filter: HTTP method'),
    },
    async ({ url, duration, includeStatic, filterUrl, filterMethod }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url, 500);

      const requests = await captureNetwork({ duration, includeStatic, filterUrl, filterMethod });
      const data = { total: requests.length, requests };
      const byType = {};
      const byStatus = {};
      requests.forEach(r => {
        byType[r.resourceType || 'other'] = (byType[r.resourceType || 'other'] || 0) + 1;
        byStatus[r.status || '?'] = (byStatus[r.status || '?'] || 0) + 1;
      });
      const typeStr = Object.entries(byType).map(([k, v]) => `${k} (${v})`).join(', ');
      const statusStr = Object.entries(byStatus).map(([k, v]) => `${k} (${v})`).join(', ');
      const top5 = requests.slice(0, 5).map(r => `${r.method} ${r.url.slice(0, 60)} → ${r.status}`).join('\n  ');
      const summary = `Network: ${requests.length} requests (${duration}s)\nBy type: ${typeStr}\nBy status: ${statusStr}\nTop:\n  ${top5 || 'none'}`;
      return summarizeResult('network', data, summary, { tool: 'tapsite_capture_network', description: 'Network requests captured during page activity' });
    }
  );

  if (allowTool('tapsite_extract_api_schema')) server.tool(
    'tapsite_extract_api_schema',
    'Infer API schemas from captured network traffic.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
      duration: z.number().min(1).max(60).default(15).describe('Seconds to capture (1-60)'),
      filterUrl: z.string().max(500).optional().describe('Filter: URL contains string'),
    },
    async ({ url, duration, filterUrl }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url, 500);

      const all = await captureNetwork({ duration, includeStatic: false, filterUrl, filterMethod: undefined });
      const apiCalls = all.filter((r) => r.contentType && r.contentType.includes('json'));

      function inferSchema(value, depth = 0) {
        if (value === null) return 'null';
        if (Array.isArray(value)) {
          if (value.length === 0) return 'array<unknown>';
          const itemTypes = [...new Set(value.slice(0, 3).map((v) => inferSchema(v, depth + 1)))];
          return `array<${itemTypes.join('|')}>`;
        }
        const t = typeof value;
        if (t === 'object') {
          if (depth >= 3) return 'object';
          const schema = {};
          for (const [k, v] of Object.entries(value).slice(0, 30)) {
            schema[k] = inferSchema(v, depth + 1);
          }
          return schema;
        }
        return t;
      }

      function normalizeUrl(rawUrl) {
        try {
          const u = new URL(rawUrl);
          const p = u.pathname
            .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/{uuid}')
            .replace(/\/\d{4,}/g, '/{id}')
            .replace(/\/\d+/g, '/{id}');
          return u.origin + p;
        } catch {
          return rawUrl;
        }
      }

      const endpointMap = new Map();

      for (const req of apiCalls) {
        const normalized = normalizeUrl(req.url);
        const key = `${req.method} ${normalized}`;

        if (!endpointMap.has(key)) {
          endpointMap.set(key, {
            method: req.method,
            endpoint: normalized,
            calls: 0,
            statuses: [],
            requestSchema: null,
            responseSchema: null,
            hasAuth: false,
            pagination: false,
          });
        }

        const entry = endpointMap.get(key);
        entry.calls++;
        if (!entry.statuses.includes(req.status)) entry.statuses.push(req.status);

        const authHeader = req.requestHeaders['authorization'] || req.requestHeaders['x-auth-token'] || req.requestHeaders['x-api-key'];
        if (authHeader) entry.hasAuth = true;

        if (req.postData && !entry.requestSchema) {
          try {
            const parsed = JSON.parse(req.postData);
            entry.requestSchema = inferSchema(parsed);
          } catch {}
        }

        if (req.responseBody && !entry.responseSchema) {
          try {
            const parsed = JSON.parse(req.responseBody);
            entry.responseSchema = inferSchema(parsed);
            const keys = Object.keys(typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
            if (keys.some((k) => ['page', 'cursor', 'next', 'nextPage', 'offset', 'hasMore', 'total_pages'].includes(k))) {
              entry.pagination = true;
            }
          } catch {}
        }
      }

      const endpoints = [...endpointMap.values()].sort((a, b) => b.calls - a.calls);
      const data = { totalApiCalls: apiCalls.length, uniqueEndpoints: endpoints.length, endpoints };
      const epLines = endpoints.slice(0, 8).map(e =>
        `${e.method} ${e.endpoint} — ${e.calls}x, [${e.statuses.join(',')}]${e.hasAuth ? ', auth' : ''}${e.pagination ? ', paginated' : ''}`
      ).join('\n  ');
      const summary = `API: ${endpoints.length} endpoints from ${apiCalls.length} calls (${duration}s)\n  ${epLines || 'none detected'}`;
      return summarizeResult('api-schema', data, summary, { tool: 'tapsite_extract_api_schema', description: 'API endpoints inferred from observed JSON network traffic' });
    }
  );

  if (allowTool('tapsite_extract_stack')) server.tool(
    'tapsite_extract_stack',
    'Detect tech stack: frameworks, libraries, CMS, analytics, CDNs.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
    },
    async ({ url }) => {
      await browser.ensureBrowser();

      let serverHeaders = null;

      if (url) {
        requireSafeUrl(url);
        let mainResponse = null;
        try {
          mainResponse = await browser.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        } catch {}
        await browser.page.waitForTimeout(1500);

        if (mainResponse) {
          const headers = mainResponse.headers();
          const interesting = ['server', 'x-powered-by', 'x-generator', 'x-framework', 'via', 'cf-ray', 'x-vercel-id', 'x-amzn-requestid'];
          serverHeaders = {};
          for (const h of interesting) {
            if (headers[h]) serverHeaders[h] = headers[h];
          }
          if (Object.keys(serverHeaders).length === 0) serverHeaders = null;
        }
      }

      const stack = await safeEvaluate(browser.page, detectStackInBrowser);

      if (serverHeaders) {
        stack.serverHeaders = serverHeaders;

        const hosting = [];
        if (serverHeaders['cf-ray']) hosting.push('Cloudflare');
        if (serverHeaders['x-vercel-id']) hosting.push('Vercel');
        if (serverHeaders['x-amzn-requestid'] || (serverHeaders['server'] || '').includes('AmazonS3')) hosting.push('AWS');
        if ((serverHeaders['server'] || '').toLowerCase().includes('nginx')) hosting.push('nginx');
        if ((serverHeaders['server'] || '').toLowerCase().includes('apache')) hosting.push('Apache');
        if ((serverHeaders['x-powered-by'] || '').toLowerCase().includes('php')) hosting.push('PHP');
        if ((serverHeaders['x-powered-by'] || '').toLowerCase().includes('express')) hosting.push('Express.js');
        if (hosting.length) stack.hosting = hosting;
      }

      const allTechs = [
        ...(stack.frameworks || []),
        ...(stack.cssFrameworks || []),
        ...(stack.buildTools || []),
        ...(stack.analytics || []),
        ...(stack.cms || []),
      ];
      const techs = allTechs.map(t => t.name + (t.version ? ` ${t.version}` : '')).join(', ');
      const hosting = (stack.hosting || []).join(', ');
      const summary = `Stack: ${techs || 'none detected'}${hosting ? `\nHosting: ${hosting}` : ''}`;
      return summarizeResult('stack', stack, summary, { tool: 'tapsite_extract_stack', description: 'Tech stack detected from scripts, globals, CSS, and HTTP headers' });
    }
  );

};
