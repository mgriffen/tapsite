const { z } = require('zod');
const path = require('path');
const fs = require('fs');
const { summarizeResult, requireSafeUrl, safeEvaluate } = require('../helpers');
const {
  extractContentInBrowser,
  extractMetadataInBrowser,
  extractColorsInBrowser,
  extractFontsInBrowser,
  extractCssVarsInBrowser,
  extractComponentsInBrowser,
  extractFormsInBrowser,
} = require('../extractors');
const config = require('../config');
const browser = require('../browser');

module.exports = function registerMultipageTools(server) {

  server.tool(
    'tapsite_crawl',
    'BFS crawl with extraction per page. Writes to output/crawl-{ts}/.',
    {
      url: z.string().describe('Start URL'),
      maxPages: z.number().min(1).max(100).default(10).describe('Max pages (1-100)'),
      maxDepth: z.number().min(0).max(10).default(2).describe('Max link depth (0-10)'),
      extract: z.array(z.enum(['content', 'metadata', 'links', 'colors', 'fonts', 'css_vars', 'components', 'forms'])).default(['content']).describe('Extractions per page'),
      filterPath: z.string().optional().describe("Path prefix filter (e.g. '/blog/')"),
      sameDomain: z.boolean().default(true).describe('Same domain only'),
    },
    async ({ url, maxPages, maxDepth, extract, filterPath, sameDomain }) => {
      await browser.ensureBrowser();
      requireSafeUrl(url);

      const normalizeUrl = (u) => {
        try {
          const p = new URL(u);
          return `${p.origin}${p.pathname}`;
        } catch { return u; }
      };

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const runDir = path.join(config.OUTPUT_DIR, `crawl-${timestamp}`);
      fs.mkdirSync(runDir, { recursive: true });

      const startUrl = new URL(url);
      const visited = new Set();
      const queue = [{ url: normalizeUrl(url), depth: 0 }];
      const results = [];
      const crawlStart = Date.now();
      const CRAWL_TIMEOUT_MS = 300000; // 5 minutes
      const MAX_OUTPUT_BYTES = 50 * 1024 * 1024; // 50 MB
      let totalBytes = 0;

      while (queue.length > 0 && visited.size < maxPages) {
        if (Date.now() - crawlStart > CRAWL_TIMEOUT_MS) break;
        const { url: currentUrl, depth } = queue.shift();
        if (visited.has(currentUrl)) continue;
        visited.add(currentUrl);

        const pageResult = { url: currentUrl, depth, extractions: {} };
        try {
          try { await browser.page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 30000 }); } catch {}
          await browser.page.waitForTimeout(1000);

          for (const type of extract) {
            try {
              if (type === 'content') pageResult.extractions.content = (await safeEvaluate(browser.page, extractContentInBrowser, { selector: null, includeImages: false })).content;
              else if (type === 'metadata') pageResult.extractions.metadata = await safeEvaluate(browser.page, extractMetadataInBrowser);
              else if (type === 'links') pageResult.extractions.links = await safeEvaluate(browser.page, () => {
                function isHiddenElement(el) {
                  if (!el || el.nodeType !== 1) return false;
                  const cs = getComputedStyle(el);
                  if (cs.display === 'none') return true;
                  if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
                  if (parseFloat(cs.opacity) === 0) return true;
                  const rect = el.getBoundingClientRect();
                  if (rect.width === 0 && rect.height === 0 && cs.overflow === 'hidden') return true;
                  if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(100%)') return true;
                  if (cs.position === 'absolute' || cs.position === 'fixed') {
                    if (rect.right < 0 || rect.bottom < 0 || rect.left > window.innerWidth || rect.top > window.innerHeight) {
                      if (rect.width < 2 || rect.height < 2) return true;
                    }
                  }
                  return false;
                }
                return [...document.querySelectorAll('a[href]')].filter(a => !isHiddenElement(a)).map(a => ({ text: a.textContent.trim().slice(0, 100), href: a.href }));
              });
              else if (type === 'colors') pageResult.extractions.colors = await safeEvaluate(browser.page, extractColorsInBrowser, { limit: 50 });
              else if (type === 'fonts') pageResult.extractions.fonts = await safeEvaluate(browser.page, extractFontsInBrowser);
              else if (type === 'css_vars') pageResult.extractions.css_vars = await safeEvaluate(browser.page, extractCssVarsInBrowser, { includeAll: false });
              else if (type === 'components') pageResult.extractions.components = await safeEvaluate(browser.page, extractComponentsInBrowser, { minOccurrences: 2 });
              else if (type === 'forms') pageResult.extractions.forms = await safeEvaluate(browser.page, extractFormsInBrowser);
            } catch (e) {
              pageResult.extractions[type] = { error: e.message };
            }
          }

          if (depth < maxDepth) {
            const links = await safeEvaluate(browser.page, () =>
              [...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => h.startsWith('http'))
            );
            for (const link of links) {
              try {
                const linkUrl = new URL(link);
                const normLink = `${linkUrl.origin}${linkUrl.pathname}`;
                if (visited.has(normLink)) continue;
                if (sameDomain && linkUrl.hostname !== startUrl.hostname) continue;
                if (filterPath && !linkUrl.pathname.startsWith(filterPath)) continue;
                queue.push({ url: normLink, depth: depth + 1 });
              } catch {}
            }
          }
        } catch (e) {
          pageResult.error = e.message;
        }

        results.push(pageResult);
        const filename = `page-${String(results.length).padStart(3, '0')}.json`;
        const json = JSON.stringify(pageResult, null, 2);
        totalBytes += Buffer.byteLength(json);
        if (totalBytes > MAX_OUTPUT_BYTES) break;
        fs.writeFileSync(path.join(runDir, filename), json);
      }

      const summary = {
        startUrl: url,
        pagesVisited: results.length,
        outputDir: runDir,
        pages: results.map((r, i) => ({
          url: r.url,
          depth: r.depth,
          file: path.join(runDir, `page-${String(i + 1).padStart(3, '0')}.json`),
          error: r.error || null,
        })),
      };
      fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));

      const pageList = summary.pages.map(p => `${p.depth > 0 ? '  '.repeat(p.depth) : ''}${p.url}${p.error ? ' (ERROR)' : ''}`).join('\n');
      const summaryText = `Crawl: ${summary.pagesVisited} pages from ${summary.startUrl}\nOutput: ${summary.outputDir}\n${pageList}`;
      return { content: [{ type: 'text', text: summaryText }] };
    }
  );

  server.tool(
    'tapsite_diff_pages',
    'Compare two URLs: structure, content, colors, images, metadata.',
    {
      url1: z.string().describe('First URL'),
      url2: z.string().describe('Second URL'),
      viewport1: z.object({ width: z.number(), height: z.number() }).optional().describe('Viewport for url1'),
      viewport2: z.object({ width: z.number(), height: z.number() }).optional().describe('Viewport for url2'),
    },
    async ({ url1, url2, viewport1, viewport2 }) => {
      await browser.ensureBrowser();
      requireSafeUrl(url1);
      requireSafeUrl(url2);

      const capturePage = async (url, viewport) => {
        if (viewport) await browser.page.setViewportSize(viewport);
        try { await browser.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }); } catch {}
        await browser.page.waitForTimeout(1000);
        return safeEvaluate(browser.page, () => {
          const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => ({
            level: h.tagName.toLowerCase(),
            text: h.textContent.trim().slice(0, 200),
          }));
          const wordCount = (document.body.innerText || '').split(/\s+/).filter(Boolean).length;
          const title = document.title;
          const description = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
          const linkCount = document.querySelectorAll('a[href]').length;
          const imageCount = document.querySelectorAll('img').length;
          const formCount = document.querySelectorAll('form').length;
          const colorCounts = {};
          [...document.querySelectorAll('*')].slice(0, 500).forEach(el => {
            const s = window.getComputedStyle(el);
            [s.color, s.backgroundColor].forEach(c => {
              if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') {
                colorCounts[c] = (colorCounts[c] || 0) + 1;
              }
            });
          });
          const topColors = Object.entries(colorCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c]) => c);
          return { title, description, headings, wordCount, linkCount, imageCount, formCount, topColors };
        });
      };

      const data1 = await capturePage(url1, viewport1);
      const data2 = await capturePage(url2, viewport2);

      if (viewport1 || viewport2) await browser.page.setViewportSize(config.VIEWPORT);

      const headingTexts1 = new Set(data1.headings.map(h => h.text));
      const headingTexts2 = new Set(data2.headings.map(h => h.text));

      const result = {
        url1: { url: url1, viewport: viewport1 || config.VIEWPORT, ...data1 },
        url2: { url: url2, viewport: viewport2 || config.VIEWPORT, ...data2 },
        diff: {
          title: data1.title !== data2.title ? { url1: data1.title, url2: data2.title } : 'same',
          description: data1.description !== data2.description ? { url1: data1.description, url2: data2.description } : 'same',
          wordCount: { url1: data1.wordCount, url2: data2.wordCount, delta: data2.wordCount - data1.wordCount },
          linkCount: { url1: data1.linkCount, url2: data2.linkCount, delta: data2.linkCount - data1.linkCount },
          imageCount: { url1: data1.imageCount, url2: data2.imageCount, delta: data2.imageCount - data1.imageCount },
          formCount: { url1: data1.formCount, url2: data2.formCount, delta: data2.formCount - data1.formCount },
          headings: {
            onlyIn1: data1.headings.filter(h => !headingTexts2.has(h.text)),
            onlyIn2: data2.headings.filter(h => !headingTexts1.has(h.text)),
            shared: data1.headings.filter(h => headingTexts2.has(h.text)).length,
          },
          colors: {
            onlyIn1: data1.topColors.filter(c => !data2.topColors.includes(c)),
            onlyIn2: data2.topColors.filter(c => !data1.topColors.includes(c)),
            shared: data1.topColors.filter(c => data2.topColors.includes(c)),
          },
        },
      };

      const d = result.diff;
      const lines = [];
      lines.push(`Title: ${d.title === 'same' ? 'same' : 'DIFFERENT'}`);
      lines.push(`Words: ${d.wordCount.url1} vs ${d.wordCount.url2} (${d.wordCount.delta >= 0 ? '+' : ''}${d.wordCount.delta})`);
      lines.push(`Links: ${d.linkCount.url1} vs ${d.linkCount.url2} | Images: ${d.imageCount.url1} vs ${d.imageCount.url2}`);
      lines.push(`Headings: ${d.headings.shared} shared, ${d.headings.onlyIn1.length} only in url1, ${d.headings.onlyIn2.length} only in url2`);
      lines.push(`Colors: ${d.colors.shared.length} shared, ${d.colors.onlyIn1.length} only in url1, ${d.colors.onlyIn2.length} only in url2`);
      const summary = `Diff: ${url1} vs ${url2}\n${lines.join('\n')}`;
      return summarizeResult('diff', result, summary, { tool: 'tapsite_diff_pages', description: 'Structural and content comparison between two URLs' });
    }
  );

};
