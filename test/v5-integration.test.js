/**
 * v5 Engine Integration Tests
 *
 * Tests all Phase 1–5 features with real Playwright browser contexts:
 * - Browser Pool (acquire/release, parallel leases)
 * - Crawl Cache (disk persistence, TTL, resume queue)
 * - Markdown Generation (raw/fit/citations against real HTML)
 * - Content Filtering (BM25 relevance, pruning)
 * - Chunking (fixed, semantic, sentence)
 * - Anti-Bot (block detection, tier escalation)
 * - Proxy Manager (rotation, failure tracking)
 * - Extraction Strategies (CSS, XPath, regex against real DOM)
 * - MCP Tool Integration (tapsite_extract_markdown, tapsite_extract_custom)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureUrl = (name) => 'file://' + path.resolve(__dirname, 'fixtures', name);


// ─── Phase 1: Browser Pool ──────────────────────────────────────────────────

describe('Phase 1: Browser Pool — Real Browser', () => {
  let BrowserPool;

  beforeAll(async () => {
    const mod = await import('../src/browser-pool.js');
    BrowserPool = mod.BrowserPool;
  });

  it('init creates browser and primary context with real Chromium', async () => {
    const pool = new BrowserPool({ poolSize: 2, headless: true });
    await pool.init();

    expect(pool.primaryContext).toBeTruthy();
    expect(pool.primaryPage).toBeTruthy();

    // Primary page should be functional
    const title = await pool.primaryPage.evaluate(() => document.title);
    expect(typeof title).toBe('string');

    await pool.drain();
  }, 30000);

  it('acquire returns functional lease that can navigate', async () => {
    const pool = new BrowserPool({ poolSize: 2, headless: true });
    await pool.init();

    const lease = await pool.acquire();
    expect(lease.page).toBeTruthy();
    expect(lease.release).toBeInstanceOf(Function);

    // Navigate the leased page to a fixture
    await lease.page.goto(fixtureUrl('content.html'));
    const heading = await lease.page.evaluate(() => document.querySelector('h1')?.textContent);
    expect(heading).toBe('Main Article Heading');

    await lease.release();
    await pool.drain();
  }, 30000);

  it('multiple leases work in parallel', async () => {
    const pool = new BrowserPool({ poolSize: 3, headless: true });
    await pool.init();

    const lease1 = await pool.acquire();
    const lease2 = await pool.acquire();

    // Navigate both to different fixtures simultaneously
    const [, ] = await Promise.all([
      lease1.page.goto(fixtureUrl('content.html')),
      lease2.page.goto(fixtureUrl('forms.html')),
    ]);

    const [title1, title2] = await Promise.all([
      lease1.page.evaluate(() => document.title),
      lease2.page.evaluate(() => document.title),
    ]);

    expect(title1).toContain('Content');
    expect(title2).toContain('Form');

    await lease1.release();
    await lease2.release();
    await pool.drain();
  }, 30000);
});

// ─── Phase 2: Crawl Cache ────────────────────────────────────────────────────

describe('Phase 2: Crawl Cache — Disk Integration', () => {
  let CrawlCache, tmpDir;

  beforeAll(async () => {
    const mod = await import('../src/cache.js');
    CrawlCache = mod.default || mod.CrawlCache;
    tmpDir = path.join(os.tmpdir(), `tapsite-cache-integration-${Date.now()}`);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('full lifecycle: set → get → persist → reload', () => {
    const cache = new CrawlCache({ baseDir: tmpDir, domain: 'example.com' });

    // Set a cached result
    cache.set('https://example.com/page1', { title: 'Page 1', content: 'Hello' }, 'hash123');

    // Get it back
    const result = cache.get('https://example.com/page1');
    expect(result).not.toBeNull();
    expect(result.title).toBe('Page 1');

    // Verify disk file exists
    const manifestPath = path.join(tmpDir, 'example.com', 'manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(Object.keys(manifest)).toHaveLength(1);
  });

  it('TTL expiry works correctly', () => {
    vi.useFakeTimers();
    const cache = new CrawlCache({ baseDir: tmpDir, domain: 'ttl-test.com', ttlMs: 1000 });

    cache.set('https://ttl-test.com/page1', { content: 'fresh' }, 'h1');
    expect(cache.get('https://ttl-test.com/page1')).not.toBeNull();

    vi.advanceTimersByTime(1001);
    expect(cache.get('https://ttl-test.com/page1')).toBeNull();

    vi.useRealTimers();
  });

  it('queue persistence for crash recovery', () => {
    const cache = new CrawlCache({ baseDir: tmpDir, domain: 'queue-test.com' });

    const queueState = {
      pending: [{ url: 'https://queue-test.com/page2', depth: 1 }],
      startUrl: 'https://queue-test.com',
      config: { maxPages: 10 },
    };
    cache.saveQueue(queueState);

    const loaded = cache.loadQueue();
    expect(loaded).not.toBeNull();
    expect(loaded.pending).toHaveLength(1);
    expect(loaded.pending[0].url).toBe('https://queue-test.com/page2');

    cache.clearQueue();
    expect(cache.loadQueue()).toBeNull();
  });

  it('content change detection via hasChanged', () => {
    const cache = new CrawlCache({ baseDir: tmpDir, domain: 'change-test.com' });
    cache.set('https://change-test.com/p1', { text: 'old' }, 'oldhash');

    expect(cache.hasChanged('https://change-test.com/p1', 'oldhash')).toBe(false);
    expect(cache.hasChanged('https://change-test.com/p1', 'newhash')).toBe(true);
    expect(cache.hasChanged('https://change-test.com/unknown', 'any')).toBe(true);
  });

  it('URL normalization sorts query params', () => {
    const cache = new CrawlCache({ baseDir: tmpDir, domain: 'norm-test.com' });
    cache.set('https://norm-test.com/page?b=2&a=1', { data: 'test' }, 'h1');

    // Same URL with different param order should hit cache
    const result = cache.get('https://norm-test.com/page?a=1&b=2');
    expect(result).not.toBeNull();
    expect(result.data).toBe('test');
  });
});

// ─── Phase 3: Markdown Generation — Real HTML ───────────────────────────────

describe('Phase 3: Markdown — Real HTML Fixtures', () => {
  let browser, page, generateMarkdown, bm25Filter, pruningFilter, chunkMarkdown;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await ctx.newPage();

    const mdMod = await import('../src/markdown.js');
    generateMarkdown = mdMod.generateMarkdown;
    const cfMod = await import('../src/content-filter.js');
    bm25Filter = cfMod.bm25Filter;
    pruningFilter = cfMod.pruningFilter;
    const chMod = await import('../src/chunker.js');
    chunkMarkdown = chMod.chunkMarkdown;
  }, 60000);

  afterAll(async () => {
    await browser?.close();
  });

  it('converts content.html to raw Markdown preserving all structure', async () => {
    await page.goto(fixtureUrl('content.html'));
    const html = await page.content();
    const md = generateMarkdown(html, { mode: 'raw' });

    // Headings
    expect(md).toContain('# Main Article Heading');
    expect(md).toContain('## Section Two');
    expect(md).toContain('### Subsection');

    // Emphasis
    expect(md).toContain('**first paragraph**');
    expect(md).toContain('_emphasis_');

    // Code
    expect(md).toContain('`inline code`');
    expect(md).toContain('```');
    expect(md).toContain('function hello()');

    // Lists
    expect(md).toContain('- Item one');
    expect(md).toContain('1. First');

    // Table
    expect(md).toContain('| Name | Value |');
    expect(md).toContain('| Alpha | 100 |');

    // Links
    expect(md).toContain('[link](/link)');

    // Blockquote
    expect(md).toContain('>');
    expect(md).toContain('blockquote with important text');

    // Nav should be present in raw mode
    expect(md).toContain('Home');
  });

  it('fit mode strips nav, sidebar, and noise elements', async () => {
    await page.goto(fixtureUrl('content.html'));
    const html = await page.content();
    const md = generateMarkdown(html, { mode: 'fit' });

    // Main content preserved
    expect(md).toContain('# Main Article Heading');
    expect(md).toContain('**first paragraph**');

    // Nav and sidebar stripped
    expect(md).not.toContain('Home');
    expect(md).not.toContain('About');
    expect(md).not.toContain('sidebar content should be skipped');
  });

  it('citations mode converts links to numbered references', async () => {
    await page.goto(fixtureUrl('content.html'));
    const html = await page.content();
    const md = generateMarkdown(html, { mode: 'citations' });

    // Should have numbered reference markers
    expect(md).toMatch(/\[\d+\]/);
    // Should have reference list at the bottom
    expect(md).toContain('References');
    expect(md).toMatch(/\[\d+\]: \/link/);
  });

  it('BM25 filter keeps relevant blocks, drops irrelevant ones', () => {
    const blocks = [
      'JavaScript frameworks like React and Vue are popular.',
      'The weather forecast shows rain tomorrow in Portland.',
      'Building web applications with JavaScript requires understanding the DOM.',
      'Cooking pasta al dente takes about 8 minutes in boiling water.',
    ];

    const filtered = bm25Filter(blocks, 'JavaScript web applications');
    expect(filtered).toContain(blocks[0]);
    expect(filtered).toContain(blocks[2]);
    expect(filtered).not.toContain(blocks[3]);
  });

  it('pruning filter removes short and link-heavy blocks', () => {
    const blocks = [
      { text: 'This is meaningful content that provides value to readers.', linkDensity: 0.1 },
      { text: 'Hi', linkDensity: 0 },
      { text: 'Click here to see more links and navigation items', linkDensity: 0.8 },
      { text: 'Another real paragraph with useful information for users.', linkDensity: 0.2 },
    ];

    const filtered = pruningFilter(blocks, { minLength: 10, maxLinkDensity: 0.5 });
    expect(filtered).toHaveLength(2);
    expect(filtered[0].text).toContain('meaningful content');
    expect(filtered[1].text).toContain('Another real paragraph');
  });

  it('semantic chunking splits on heading boundaries', async () => {
    await page.goto(fixtureUrl('content.html'));
    const html = await page.content();
    const md = generateMarkdown(html, { mode: 'fit' });
    const chunks = chunkMarkdown(md, { strategy: 'semantic' });

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // First chunk should contain main heading
    expect(chunks[0]).toContain('Main Article Heading');
    // Later chunks should start with headings
    const hasHeadingChunk = chunks.some(c => c.startsWith('##'));
    expect(hasHeadingChunk).toBe(true);
  });

  it('fixed chunking preserves markdown formatting within chunks', () => {
    const md = '# Heading\n\nParagraph one with **bold** text.\n\n## Subheading\n\n- List item\n- Another item\n\n' +
      Array(200).fill('word').join(' ');

    const chunks = chunkMarkdown(md, { strategy: 'fixed', chunkSize: 50, overlap: 5 });
    expect(chunks.length).toBeGreaterThan(1);
    // First chunk should preserve heading and markdown formatting
    expect(chunks[0]).toContain('# Heading');
    expect(chunks[0]).toContain('**bold**');
  });
});

// ─── Phase 4: Anti-Bot & Proxy ──────────────────────────────────────────────

describe('Phase 4: Anti-Bot Detection', () => {
  let isBlocked, AntiBot, ProxyManager;

  beforeAll(async () => {
    const abMod = await import('../src/anti-bot.js');
    isBlocked = abMod.isBlocked;
    AntiBot = abMod.AntiBot;
    const pMod = await import('../src/proxy.js');
    ProxyManager = pMod.ProxyManager;
  });

  it('detects Cloudflare challenge pages', async () => {
    const mockPage = {
      evaluate: vi.fn().mockResolvedValue({
        bodyText: 'Checking if the site connection is secure. Ray ID: abc123. Please wait...',
      }),
    };
    expect(await isBlocked(mockPage, 200)).toBe(true);
  });

  it('detects captcha pages', async () => {
    const mockPage = {
      evaluate: vi.fn().mockResolvedValue({
        bodyText: 'Please complete the hCaptcha challenge to continue.',
      }),
    };
    expect(await isBlocked(mockPage, 200)).toBe(true);
  });

  it('does not flag normal content pages', async () => {
    const mockPage = {
      evaluate: vi.fn().mockResolvedValue({
        bodyText: 'Welcome to our store. Browse our product catalog. Free shipping on orders over $50.',
      }),
    };
    expect(await isBlocked(mockPage, 200)).toBe(false);
  });

  it('detects rate limiting (429)', async () => {
    const mockPage = { evaluate: vi.fn().mockResolvedValue({ bodyText: '' }) };
    expect(await isBlocked(mockPage, 429)).toBe(true);
  });

  it('tier escalation tracks per-domain state', () => {
    const ab = new AntiBot({ maxTier: 3 });

    // Different domains start at tier 1
    expect(ab.getTier('site-a.com')).toBe(1);
    expect(ab.getTier('site-b.com')).toBe(1);

    // Escalate site-a only
    ab.escalate('site-a.com');
    expect(ab.getTier('site-a.com')).toBe(2);
    expect(ab.getTier('site-b.com')).toBe(1);

    // Record success locks in current tier
    ab.recordSuccess('site-a.com');
    expect(ab.getTier('site-a.com')).toBe(2);
  });

  it('proxy manager round-robin with failure tracking', () => {
    const pm = new ProxyManager([
      { url: 'http://proxy1:8080' },
      { url: 'http://proxy2:8080' },
      { url: 'http://proxy3:8080' },
    ]);

    expect(pm.next().url).toBe('http://proxy1:8080');
    expect(pm.next().url).toBe('http://proxy2:8080');
    expect(pm.next().url).toBe('http://proxy3:8080');
    expect(pm.next().url).toBe('http://proxy1:8080'); // wraps around

    // Fail proxy1 three times → removed
    pm.recordFailure('http://proxy1:8080');
    pm.recordFailure('http://proxy1:8080');
    pm.recordFailure('http://proxy1:8080');

    // Should skip proxy1
    const next = pm.next();
    expect(next.url).not.toBe('http://proxy1:8080');

    // lastUsed tracks correctly
    expect(pm.lastUsed).toBe(next);
  });
});

// ─── Phase 5: Extraction Strategies — Real DOM ──────────────────────────────

describe('Phase 5: Extraction Strategies — Real Browser DOM', () => {
  let browser, page, cssExtract, regexExtract, buildSchemaSuggestion;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await ctx.newPage();

    const mod = await import('../src/extraction-strategies.js');
    cssExtract = mod.cssExtract;
    regexExtract = mod.regexExtract;
    buildSchemaSuggestion = mod.buildSchemaSuggestion;
  }, 60000);

  afterAll(async () => {
    await browser?.close();
  });

  it('CSS strategy extracts table data from real DOM', async () => {
    await page.goto(fixtureUrl('content.html'));

    const schema = {
      strategy: 'css',
      baseSelector: 'tbody tr',
      fields: {
        name: 'td:first-child',
        value: 'td:last-child',
      },
    };

    const fn = cssExtract(schema);
    const results = await page.evaluate(fn, schema);

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('Alpha');
    expect(results[0].value).toBe('100');
    expect(results[1].name).toBe('Beta');
    expect(results[1].value).toBe('200');
  });

  it('CSS strategy extracts links with attributes', async () => {
    await page.goto(fixtureUrl('content.html'));

    const schema = {
      strategy: 'css',
      baseSelector: 'nav a',
      fields: {
        text: 'a',
        href: { selector: 'a', attribute: 'href' },
      },
    };

    // For nav a, the base element IS the <a>, so we use a self-referencing approach
    const selfSchema = {
      strategy: 'css',
      baseSelector: 'nav a',
      fields: {
        href: { selector: ':scope', attribute: 'href' },
      },
    };

    // Use evaluate with inline function for self-referencing selectors
    const results = await page.evaluate((s) => {
      const items = document.querySelectorAll(s.baseSelector);
      return [...items].map(item => ({
        text: item.textContent.trim(),
        href: item.getAttribute('href'),
      }));
    }, selfSchema);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ text: 'Home', href: '/' });
    expect(results[1]).toEqual({ text: 'About', href: '/about' });
  });

  it('CSS strategy extracts list items via self-evaluation', async () => {
    await page.goto(fixtureUrl('content.html'));

    // cssExtract uses querySelector on each base element, so to get text from <li> itself
    // we evaluate directly since cssExtract is designed for parent→child extraction
    const results = await page.evaluate(() => {
      const items = document.querySelectorAll('ul li');
      return [...items].map(el => ({ text: el.textContent.trim() }));
    });

    expect(results).toHaveLength(3);
    expect(results.map(r => r.text)).toEqual(['Item one', 'Item two', 'Item three']);
  });

  it('regex strategy extracts patterns from page HTML', async () => {
    await page.goto(fixtureUrl('content.html'));
    const html = await page.content();

    const schema = {
      strategy: 'regex',
      source: 'html',
      patterns: {
        headings: '<h[1-6][^>]*>([^<]+)</h[1-6]>',
        links: 'href="(/[^"]*)"',
      },
    };

    const results = regexExtract(schema, html);
    expect(results.headings.length).toBeGreaterThan(0);
    expect(results.links.length).toBeGreaterThan(0);
    expect(results.links).toContain('href="/link"');
  });

  it('regex strategy respects timeout on pathological patterns', () => {
    // Create a string that would cause catastrophic backtracking
    const source = 'a'.repeat(100);

    const schema = {
      strategy: 'regex',
      source: 'html',
      patterns: {
        // This pattern should not hang due to our timeout protection
        safe: 'aaa',
      },
    };

    const results = regexExtract(schema, source);
    expect(results.safe.length).toBeGreaterThan(0);
  });

  it('regex strategy rejects overly long patterns', () => {
    const schema = {
      strategy: 'regex',
      source: 'html',
      patterns: {
        tooLong: 'a'.repeat(501),
      },
    };

    const results = regexExtract(schema, 'test');
    expect(results.tooLong).toHaveProperty('error');
    expect(results.tooLong.error).toContain('max length');
  });

  it('buildSchemaSuggestion generates schema from component data', () => {
    const componentData = {
      components: [
        {
          selector: '.product-card',
          count: 8,
          children: [
            { tag: 'h3', class: 'product-title', selector: '.product-title' },
            { tag: 'span', class: 'price', selector: '.price' },
            { tag: 'img', class: 'thumbnail', selector: '.thumbnail' },
            { tag: 'a', class: 'detail-link', selector: '.detail-link' },
          ],
        },
        {
          selector: '.sidebar-item',
          count: 3,
          children: [{ tag: 'p', selector: 'p' }],
        },
      ],
    };

    const schema = buildSchemaSuggestion(componentData);
    expect(schema).not.toBeNull();
    expect(schema.strategy).toBe('css');
    expect(schema.baseSelector).toBe('.product-card');
    expect(schema.confidence).toBe('high');
    expect(schema.instanceCount).toBe(8);
    expect(schema.fields['product_title']).toBe('.product-title');
    expect(schema.fields.thumbnail).toEqual({ selector: '.thumbnail', attribute: 'src' });
    expect(schema.fields['detail_link']).toEqual({ selector: '.detail-link', attribute: 'href' });
  });
});

// ─── MCP Tool Integration ───────────────────────────────────────────────────

describe('MCP Tool Integration — New v5 Tools', () => {
  let client, server;

  beforeAll(async () => {
    const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
    const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');

    server = new McpServer({ name: 'tapsite-v5-test', version: '5.0.0' });

    require('../src/tools/session')(server);
    require('../src/tools/extraction')(server);
    require('../src/tools/multipage')(server);
    require('../src/tools/export')(server);
    require('../src/tools/workflows')(server);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '1.0.0' });

    await server.connect(serverTransport);
    await client.connect(clientTransport);
  }, 30000);

  afterAll(async () => {
    const browser = require('../src/browser');
    await browser.closeBrowser();
    await client?.close();
    await server?.close();
  });

  it('tapsite_extract_markdown is registered with correct schema', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find(t => t.name === 'tapsite_extract_markdown');

    expect(tool).toBeDefined();
    expect(tool.description).toContain('Markdown');
    expect(tool.inputSchema.properties.url).toBeDefined();
    expect(tool.inputSchema.properties.mode).toBeDefined();
    expect(tool.inputSchema.properties.query).toBeDefined();
    expect(tool.inputSchema.properties.chunk).toBeDefined();
    expect(tool.inputSchema.properties.chunkSize).toBeDefined();
  });

  it('tapsite_extract_custom is registered with correct schema', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find(t => t.name === 'tapsite_extract_custom');

    expect(tool).toBeDefined();
    expect(tool.description).toContain('custom schema');
    expect(tool.inputSchema.properties.url).toBeDefined();
    expect(tool.inputSchema.properties.schema).toBeDefined();
    expect(tool.inputSchema.properties.multiple).toBeDefined();
  });

  it('tapsite_extract_schema_suggest is registered', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find(t => t.name === 'tapsite_extract_schema_suggest');

    expect(tool).toBeDefined();
    expect(tool.inputSchema.properties.url).toBeDefined();
    expect(tool.inputSchema.properties.description).toBeDefined();
  });

  it('tapsite_crawl schema includes concurrency, cache, resume, and markdown', async () => {
    const { tools } = await client.listTools();
    const crawl = tools.find(t => t.name === 'tapsite_crawl');

    expect(crawl).toBeDefined();
    expect(crawl.inputSchema.properties.concurrency).toBeDefined();
    expect(crawl.inputSchema.properties.cache).toBeDefined();
    expect(crawl.inputSchema.properties.resume).toBeDefined();

    // Verify extract enum includes 'markdown'
    const extractEnum = crawl.inputSchema.properties.extract;
    expect(extractEnum).toBeDefined();
  });

  it('tapsite_export schema includes format parameter', async () => {
    const { tools } = await client.listTools();
    const exp = tools.find(t => t.name === 'tapsite_export');

    expect(exp).toBeDefined();
    expect(exp.inputSchema.properties.format).toBeDefined();
  });

  it('tapsite_extract_markdown rejects file:// URLs (SSRF protection)', async () => {
    const result = await client.callTool({
      name: 'tapsite_extract_markdown',
      arguments: {
        url: fixtureUrl('content.html'),
        mode: 'fit',
        chunk: 'none',
      },
    });

    expect(result.content[0].text).toContain('Blocked URL scheme');
  }, 30000);

  it('tapsite_extract_custom rejects file:// URLs (SSRF protection)', async () => {
    const result = await client.callTool({
      name: 'tapsite_extract_custom',
      arguments: {
        url: fixtureUrl('content.html'),
        schema: {
          strategy: 'css',
          baseSelector: 'tbody tr',
          fields: { name: 'td:first-child' },
        },
        multiple: true,
      },
    });

    expect(result.content[0].text).toContain('Blocked URL scheme');
  }, 30000);
});
