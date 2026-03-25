const { z } = require('zod');
const path = require('path');
const fs = require('fs');
const { summarizeResult, requireSafeUrl, navigateIfNeeded, safeEvaluate } = require('../helpers');
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

module.exports = function registerMultipageTools(server, allowTool = () => true) {

  if (allowTool('tapsite_crawl')) server.tool(
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

  if (allowTool('tapsite_diff_pages')) server.tool(
    'tapsite_diff_pages',
    'Compare two URLs (cross-site) or the same URL over time (temporal). Runs real extractors — colors, fonts, spacing, a11y, perf, metadata, components, breakpoints — and produces a structured diff with regressions/improvements highlighted. Omit url2 for temporal mode (compares against last saved snapshot).',
    {
      url1: z.string().describe('First URL / baseline (or sole URL for temporal mode)'),
      url2: z.string().optional().describe('Second URL to compare against url1 (omit for temporal diff)'),
      extractors: z.array(z.string()).optional().describe('Which extractors to run (default: all core). Options: colors, fonts, spacing, components, breakpoints, a11y, perf, metadata, contrast'),
    },
    async ({ url1, url2, extractors: extractorNames }) => {
      const { EXTRACTOR_MAP, DEFAULT_EXTRACTORS, diffExtractorResult } = require('../diff');
      const { saveSnapshot, loadLatestSnapshot } = require('../snapshots');

      await browser.ensureBrowser();
      requireSafeUrl(url1);
      if (url2) requireSafeUrl(url2);

      const names = (extractorNames || DEFAULT_EXTRACTORS).filter(n => EXTRACTOR_MAP[n]);
      const mode = url2 ? 'cross-site' : 'temporal';

      // Extract url1 (baseline / "before" in cross-site mode)
      await navigateIfNeeded(url1);
      const beforeData = {};
      const beforeTimestamp = new Date().toISOString();
      for (const name of names) {
        try {
          const { fn, args } = EXTRACTOR_MAP[name];
          beforeData[name] = await safeEvaluate(browser.page, fn, args);
        } catch (e) {
          beforeData[name] = { _error: e.message };
        }
      }

      // Get "after" data
      const afterData = {};

      if (mode === 'cross-site') {
        // Navigate to url2 — force navigation even if same domain
        try { await browser.page.goto(url2, { waitUntil: 'networkidle', timeout: 30000 }); } catch (err) {
          console.error(`[tapsite] Navigation error for ${url2}: ${err.message}`);
        }
        await browser.page.waitForTimeout(1500);

        for (const name of names) {
          try {
            const { fn, args } = EXTRACTOR_MAP[name];
            afterData[name] = await safeEvaluate(browser.page, fn, args);
          } catch (e) {
            afterData[name] = { _error: e.message };
          }
        }
      } else {
        // Temporal — current extraction is "after", snapshots are "before"
        // Move url1 extraction from beforeData to afterData
        let hasAnySnapshot = false;
        let snapshotTimestamp = null;
        for (const name of names) {
          afterData[name] = beforeData[name];
          delete beforeData[name];
          const snap = loadLatestSnapshot(url1, name);
          if (snap) {
            beforeData[name] = snap.data;
            if (!snapshotTimestamp) snapshotTimestamp = snap.timestamp;
            hasAnySnapshot = true;
          }
        }

        // Save current as new snapshots
        for (const name of names) {
          if (!afterData[name]?._error) {
            saveSnapshot(url1, name, afterData[name]);
          }
        }

        if (!hasAnySnapshot) {
          return {
            content: [{
              type: 'text',
              text: `Baseline captured for ${url1}\n\nExtractors: ${names.join(', ')}\nSnapshots saved to output/snapshots/. Run this tool again later to see changes.`,
            }],
          };
        }
      }

      // Compute diffs
      const changes = {};
      const regressions = [];
      const improvements = [];
      const errors = [];
      let totalChanges = 0;

      for (const name of names) {
        if (afterData[name]?._error) {
          changes[name] = { error: afterData[name]._error };
          errors.push(`${name}: ${afterData[name]._error}`);
          continue;
        }
        if (beforeData[name]?._error) {
          changes[name] = { error: `before: ${beforeData[name]._error}` };
          errors.push(`${name} (before): ${beforeData[name]._error}`);
          continue;
        }
        if (!beforeData[name]) {
          changes[name] = { note: 'no previous data' };
          continue;
        }

        const diff = diffExtractorResult(name, beforeData[name], afterData[name]);
        changes[name] = diff;
        totalChanges += (diff.added?.length || 0) + (diff.removed?.length || 0);

        // Detect regressions/improvements
        if (name === 'a11y' && diff.deltas?.score) {
          if (diff.deltas.score < 0) regressions.push(`a11y score ${(beforeData[name].score ?? '?')} → ${(afterData[name].score ?? '?')} (${diff.deltas.score})`);
          if (diff.deltas.score > 0) improvements.push(`a11y score ${(beforeData[name].score ?? '?')} → ${(afterData[name].score ?? '?')} (+${diff.deltas.score})`);
        }
        if (name === 'perf' && diff.deltas?.loadMs !== null) {
          if (diff.deltas.loadMs > 500) regressions.push(`Load time +${diff.deltas.loadMs}ms`);
          if (diff.deltas.loadMs < -500) improvements.push(`Load time ${diff.deltas.loadMs}ms`);
        }
        if (name === 'contrast' && diff.deltas?.failing) {
          if (diff.deltas.failing > 0) regressions.push(`Contrast: +${diff.deltas.failing} failing pairs`);
          if (diff.deltas.failing < 0) improvements.push(`Contrast: ${diff.deltas.failing} failing pairs`);
        }
      }

      const afterTimestamp = new Date().toISOString();

      const result = {
        mode,
        urls: { before: mode === 'cross-site' ? url1 : url1, after: mode === 'cross-site' ? url2 : url1 },
        timestamps: { before: mode === 'temporal' ? (snapshotTimestamp || beforeTimestamp) : beforeTimestamp, after: afterTimestamp },
        extractors: names,
        changes,
        summary: { totalChanges, regressions, improvements, errors },
      };

      // Build summary text
      const timeSince = beforeTimestamp
        ? (() => {
            const ms = new Date(afterTimestamp) - new Date(beforeTimestamp);
            const hours = Math.round(ms / 3600000);
            if (hours < 24) return `${hours}h since last snapshot`;
            return `${Math.round(hours / 24)}d since last snapshot`;
          })()
        : '';

      const lines = [`DIFF: ${url1} (${mode}${timeSince ? ', ' + timeSince : ''})`];

      if (regressions.length) {
        lines.push('', 'REGRESSIONS:');
        regressions.forEach(r => lines.push(`  ${r}`));
      }
      if (improvements.length) {
        lines.push('', 'IMPROVEMENTS:');
        improvements.forEach(i => lines.push(`  ${i}`));
      }
      if (errors.length) {
        lines.push('', 'ERRORS:');
        errors.forEach(e => lines.push(`  ${e}`));
      }

      lines.push('', 'CHANGES:');
      for (const name of names) {
        const c = changes[name];
        if (c.error) {
          lines.push(`  ${name}: ERROR — ${c.error}`);
        } else if (c.note) {
          lines.push(`  ${name}: ${c.note}`);
        } else {
          const parts = [];
          if (c.added?.length) parts.push(`+${c.added.length} added`);
          if (c.removed?.length) parts.push(`-${c.removed.length} removed`);
          if (c.unchanged) parts.push(`${c.unchanged} unchanged`);
          if (c.deltas) {
            for (const [k, v] of Object.entries(c.deltas)) {
              if (v === 'same' || v === null) continue;
              if (typeof v === 'number') parts.push(`${k}: ${v >= 0 ? '+' : ''}${v}`);
            }
          }
          lines.push(`  ${name}: ${parts.join(', ') || 'no change'}`);
        }
      }

      return summarizeResult('diff', result, lines.join('\n'), {
        tool: 'tapsite_diff_pages',
        description: `${mode} diff: ${names.length} extractors compared`,
      });
    }
  );

};
