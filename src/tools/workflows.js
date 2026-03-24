const { z } = require('zod');
const path = require('path');
const fs = require('fs');
const {
  extractColorsInBrowser,
  extractFontsInBrowser,
  extractCssVarsInBrowser,
  extractSpacingInBrowser,
  extractComponentsInBrowser,
  extractBreakpointsInBrowser,
  extractAnimationsInBrowser,
  extractA11yInBrowser,
  detectDarkmodeInBrowser,
  extractPerfInBrowser,
  extractMetadataInBrowser,
  extractFormsInBrowser,
  extractContentInBrowser,
  extractImagesInBrowser,
  extractSvgsInBrowser,
  extractFaviconInBrowser,
  detectStackInBrowser,
  extractShadowsInBrowser,
  extractIconsInBrowser,
  extractContrastInBrowser,
} = require('../extractors');
const config = require('../config');
const browser = require('../browser');
const { navigateIfNeeded, requireSafeUrl, summarizeResult, safeEvaluate } = require('../helpers');

module.exports = function registerWorkflowTools(server) {

  server.tool(
    'tapsite_teardown',
    'Competitive design teardown — runs colors, fonts, CSS vars, spacing, shadows, components, breakpoints, animations, icons, stack detection, perf, a11y, contrast, and dark mode in one call. Returns a combined summary.',
    {
      url: z.string().describe('URL to analyze'),
    },
    async ({ url }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);

      const results = {};

      // Design extraction
      results.colors = await safeEvaluate(browser.page, extractColorsInBrowser, { limit: 50 });
      results.fonts = await safeEvaluate(browser.page, extractFontsInBrowser);
      results.cssVars = await safeEvaluate(browser.page, extractCssVarsInBrowser, { includeAll: false });
      results.spacing = await safeEvaluate(browser.page, extractSpacingInBrowser, { sampleSize: 200 });
      results.shadows = await safeEvaluate(browser.page, extractShadowsInBrowser, { sampleSize: 300 });

      // Components & layout
      results.components = await safeEvaluate(browser.page, extractComponentsInBrowser, { minOccurrences: 2 });
      results.breakpoints = await safeEvaluate(browser.page, extractBreakpointsInBrowser);
      results.animations = await safeEvaluate(browser.page, extractAnimationsInBrowser);
      results.icons = await safeEvaluate(browser.page, extractIconsInBrowser);

      // Tech stack
      results.stack = await safeEvaluate(browser.page, detectStackInBrowser);

      // Quality
      results.perf = await safeEvaluate(browser.page, extractPerfInBrowser);
      results.a11y = await safeEvaluate(browser.page, extractA11yInBrowser, { standard: 'aa' });
      results.contrast = await safeEvaluate(browser.page, extractContrastInBrowser, { sampleSize: 200, standard: 'aa' });
      results.darkmode = await safeEvaluate(browser.page, detectDarkmodeInBrowser);

      // Build summary
      const colors = (results.colors.colors || []).slice(0, 5).map(c => c.hex).join(', ');
      const fonts = (results.fonts.families || []).slice(0, 3).map(f => f.value).join(', ');
      const techs = [
        ...(results.stack.frameworks || []),
        ...(results.stack.cssFrameworks || []),
      ].map(t => t.name).join(', ');
      const compCount = (results.components.components || []).length;
      const animCount = (results.animations.keyframes || []).length;
      const bpCount = (results.breakpoints.breakpoints || []).length;

      const summaryText = [
        `🔍 TEARDOWN: ${url}`,
        '',
        `🎨 Design: ${(results.colors.colors || []).length} colors (${colors}), ${(results.fonts.families || []).length} fonts (${fonts})`,
        `   ${(results.spacing.spacing || []).length} spacing values (base: ${results.spacing.inferredBase || '?'}), ${(results.shadows.boxShadows || []).length} shadow patterns`,
        `📐 Structure: ${compCount} components, ${bpCount} breakpoints, ${animCount} animations`,
        `🔧 Stack: ${techs || 'none detected'}`,
        `⚡ Perf: TTFB ${results.perf.timing?.ttfbMs ?? '?'}ms, Load ${results.perf.timing?.loadMs ?? '?'}ms, ${results.perf.dom?.nodeCount ?? '?'} DOM nodes`,
        `♿ A11y: ${results.a11y.score ?? '?'}/100 | Contrast: ${results.contrast.failing || 0} failing pairs`,
        `🌙 Dark mode: ${results.darkmode.supported ? 'supported' : 'not detected'}`,
      ].join('\n');

      return summarizeResult('teardown', results, summaryText, {
        tool: 'tapsite_teardown',
        description: 'Complete competitive design teardown: design system, tech stack, performance, and accessibility',
      });
    }
  );

  server.tool(
    'tapsite_audit',
    'Pre-launch quality audit with scorecard — runs a11y, contrast, perf, metadata (SEO), dark mode, and forms. Returns pass/fail per category with an overall score out of 100.',
    {
      url: z.string().describe('URL to audit'),
      standard: z.enum(['aa', 'aaa']).default('aa').describe('WCAG standard'),
    },
    async ({ url, standard }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);

      const results = {};

      // Accessibility
      results.a11y = await safeEvaluate(browser.page, extractA11yInBrowser, { standard });
      results.contrast = await safeEvaluate(browser.page, extractContrastInBrowser, { sampleSize: 200, standard });

      // Performance
      results.perf = await safeEvaluate(browser.page, extractPerfInBrowser);

      // SEO
      results.metadata = await safeEvaluate(browser.page, extractMetadataInBrowser);

      // Dark mode
      results.darkmode = await safeEvaluate(browser.page, detectDarkmodeInBrowser);

      // Forms (for label/validation checks)
      results.forms = await safeEvaluate(browser.page, extractFormsInBrowser);

      // Build scorecard
      const checks = [];
      const a11yScore = results.a11y.score ?? 0;
      checks.push({ name: 'Accessibility', score: a11yScore, max: 100, pass: a11yScore >= 80 });

      const contrastPass = (results.contrast.failing || 0) === 0;
      checks.push({ name: 'Contrast', score: contrastPass ? 100 : Math.round((results.contrast.passing / Math.max(results.contrast.totalPairs, 1)) * 100), max: 100, pass: contrastPass });

      const loadMs = results.perf.timing?.loadMs ?? 999999;
      checks.push({ name: 'Performance', score: loadMs < 3000 ? 100 : loadMs < 5000 ? 70 : loadMs < 10000 ? 40 : 20, max: 100, pass: loadMs < 5000 });

      const hasTitle = !!(results.metadata.title && results.metadata.title.length > 0);
      const hasDesc = !!(results.metadata.description && results.metadata.description.length > 0);
      const hasOG = !!(results.metadata.openGraph && Object.keys(results.metadata.openGraph).length > 0);
      const hasCanonical = !!results.metadata.canonical;
      const seoScore = [hasTitle, hasDesc, hasOG, hasCanonical].filter(Boolean).length * 25;
      checks.push({ name: 'SEO', score: seoScore, max: 100, pass: seoScore >= 75 });

      checks.push({ name: 'Dark Mode', score: results.darkmode.supported ? 100 : 0, max: 100, pass: results.darkmode.supported });

      const overall = Math.round(checks.reduce((sum, c) => sum + c.score, 0) / checks.length);

      results.scorecard = { overall, checks };

      const summaryText = [
        `📋 AUDIT: ${url} — ${overall}/100`,
        '',
        ...checks.map(c => `${c.pass ? '✅' : '❌'} ${c.name}: ${c.score}/${c.max}`),
        '',
        `Details:`,
        `  A11y: ${(results.a11y.issues || []).length} issues (${(results.a11y.issues || []).filter(i => i.severity === 'critical').length} critical)`,
        `  Contrast: ${results.contrast.failing || 0} failing, ${results.contrast.passing || 0} passing`,
        `  Load: ${results.perf.timing?.loadMs ?? '?'}ms | ${results.perf.dom?.nodeCount ?? '?'} DOM nodes`,
        `  SEO: title=${hasTitle ? '✓' : '✗'} desc=${hasDesc ? '✓' : '✗'} OG=${hasOG ? '✓' : '✗'} canonical=${hasCanonical ? '✓' : '✗'}`,
        `  Forms: ${(results.forms.forms || []).length} found`,
      ].join('\n');

      return summarizeResult('audit', results, summaryText, {
        tool: 'tapsite_audit',
        description: 'Pre-launch quality audit with scorecard: accessibility, contrast, performance, SEO, dark mode',
      });
    }
  );

  server.tool(
    'tapsite_harvest',
    'Migration asset inventory — crawls up to maxPages pages and extracts content, images, SVGs, forms, fonts, and links per page. Returns per-page counts and a link map. Output written to output/harvest-{ts}/.',
    {
      url: z.string().describe('Start URL'),
      maxPages: z.number().min(1).max(50).default(10).describe('Max pages to crawl (1-50)'),
    },
    async ({ url, maxPages }) => {
      await browser.ensureBrowser();
      requireSafeUrl(url);

      const normalizeUrl = (u) => {
        try { const p = new URL(u); return `${p.origin}${p.pathname}`; } catch { return u; }
      };

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const runDir = path.join(config.OUTPUT_DIR, `harvest-${timestamp}`);
      fs.mkdirSync(runDir, { recursive: true });

      const startUrl = new URL(url);
      const visited = new Set();
      const queue = [{ url: normalizeUrl(url), depth: 0 }];
      const inventory = {
        pages: [],
        totalImages: 0,
        totalSvgs: 0,
        totalForms: 0,
        totalLinks: 0,
        fonts: new Set(),
        allLinks: [],
      };

      while (queue.length > 0 && visited.size < maxPages) {
        const { url: currentUrl, depth } = queue.shift();
        if (visited.has(currentUrl)) continue;
        visited.add(currentUrl);

        const pageResult = { url: currentUrl, depth };
        try {
          try { await browser.page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 30000 }); } catch {}
          await browser.page.waitForTimeout(1000);

          // Content
          const content = await safeEvaluate(browser.page, extractContentInBrowser, { selector: null, includeImages: false });
          pageResult.wordCount = (content.content || '').split(/\s+/).filter(Boolean).length;

          // Images
          const images = await safeEvaluate(browser.page, extractImagesInBrowser, { minWidth: 10, filter: '' });
          pageResult.imageCount = images.total;
          inventory.totalImages += images.total;

          // SVGs
          const svgs = await safeEvaluate(browser.page, extractSvgsInBrowser, { limit: 50 });
          pageResult.svgCount = svgs.total;
          inventory.totalSvgs += svgs.total;

          // Forms
          const forms = await safeEvaluate(browser.page, extractFormsInBrowser);
          pageResult.formCount = (forms.forms || []).length;
          inventory.totalForms += (forms.forms || []).length;

          // Fonts (first page only)
          if (visited.size === 1) {
            const fonts = await safeEvaluate(browser.page, extractFontsInBrowser);
            (fonts.families || []).forEach(f => inventory.fonts.add(f.value));
          }

          // Links for crawling + inventory
          const links = await safeEvaluate(browser.page, () =>
            [...document.querySelectorAll('a[href]')].map(a => ({ text: a.textContent.trim().slice(0, 80), href: a.href })).filter(l => l.href.startsWith('http'))
          );
          pageResult.linkCount = links.length;
          inventory.totalLinks += links.length;

          for (const link of links) {
            inventory.allLinks.push({ from: currentUrl, to: link.href, text: link.text });
            if (depth < 2) {
              try {
                const linkUrl = new URL(link.href);
                const normLink = `${linkUrl.origin}${linkUrl.pathname}`;
                if (visited.has(normLink)) continue;
                if (linkUrl.hostname !== startUrl.hostname) continue;
                queue.push({ url: normLink, depth: depth + 1 });
              } catch {}
            }
          }
        } catch (e) {
          pageResult.error = e.message;
        }

        inventory.pages.push(pageResult);
      }

      // Save inventory
      const output = {
        startUrl: url,
        pagesVisited: inventory.pages.length,
        totalImages: inventory.totalImages,
        totalSvgs: inventory.totalSvgs,
        totalForms: inventory.totalForms,
        totalLinks: inventory.totalLinks,
        fonts: [...inventory.fonts],
        pages: inventory.pages,
        linkMap: inventory.allLinks.slice(0, 500),
      };

      fs.writeFileSync(path.join(runDir, 'inventory.json'), JSON.stringify(output, null, 2));

      const summaryText = [
        `📦 HARVEST: ${url} — ${inventory.pages.length} pages crawled`,
        `Output: ${runDir}`,
        '',
        `Assets found:`,
        `  🖼️  Images: ${inventory.totalImages}`,
        `  🎨 SVGs: ${inventory.totalSvgs}`,
        `  📝 Forms: ${inventory.totalForms}`,
        `  🔗 Links: ${inventory.totalLinks}`,
        `  🔤 Fonts: ${[...inventory.fonts].join(', ') || 'none'}`,
        '',
        `Pages:`,
        ...inventory.pages.map(p => `  ${p.url} — ${p.wordCount || 0} words, ${p.imageCount || 0} imgs, ${p.formCount || 0} forms${p.error ? ' (ERROR)' : ''}`),
      ].join('\n');

      return { content: [{ type: 'text', text: summaryText }] };
    }
  );

  server.tool(
    'tapsite_designsystem',
    'Design system extraction — runs colors, fonts, spacing, shadows, CSS vars, breakpoints, animations, icons, and components. Exports W3C design-tokens.json, design-tokens.css, and raw-data.json to output/design-system-{ts}/.',
    {
      url: z.string().describe('URL to extract from'),
    },
    async ({ url }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);

      const data = {};
      data.colors = await safeEvaluate(browser.page, extractColorsInBrowser, { limit: 50 });
      data.fonts = await safeEvaluate(browser.page, extractFontsInBrowser);
      data.cssVars = await safeEvaluate(browser.page, extractCssVarsInBrowser, { includeAll: false });
      data.spacing = await safeEvaluate(browser.page, extractSpacingInBrowser, { sampleSize: 200 });
      data.shadows = await safeEvaluate(browser.page, extractShadowsInBrowser, { sampleSize: 300 });
      data.breakpoints = await safeEvaluate(browser.page, extractBreakpointsInBrowser);
      data.animations = await safeEvaluate(browser.page, extractAnimationsInBrowser);
      data.icons = await safeEvaluate(browser.page, extractIconsInBrowser);
      data.components = await safeEvaluate(browser.page, extractComponentsInBrowser, { minOccurrences: 2 });

      // Build W3C design tokens
      const tokens = {};

      if (data.colors?.colors?.length) {
        tokens.color = {};
        data.colors.colors.forEach((c, i) => {
          tokens.color[`color-${i + 1}`] = { $value: c.hex, $type: 'color', $description: `${c.count} uses` };
        });
      }

      if (data.fonts?.families?.length) {
        tokens.fontFamily = {};
        data.fonts.families.forEach((f, i) => {
          tokens.fontFamily[`font-${i + 1}`] = { $value: f.value, $type: 'fontFamily', $description: `${f.count} uses` };
        });
        if (data.fonts.sizes?.length) {
          tokens.fontSize = {};
          data.fonts.sizes.forEach((s, i) => {
            tokens.fontSize[`size-${i + 1}`] = { $value: s.value, $type: 'dimension' };
          });
        }
      }

      if (data.spacing?.spacing?.length) {
        tokens.spacing = {};
        data.spacing.spacing.forEach((s, i) => {
          tokens.spacing[`space-${i + 1}`] = { $value: s.value, $type: 'dimension' };
        });
      }

      if (data.shadows?.boxShadows?.length) {
        tokens.shadow = {};
        data.shadows.boxShadows.forEach((s, i) => {
          tokens.shadow[`shadow-${i + 1}`] = { $value: s.value, $type: 'shadow', $description: `${s.elevation} (${s.count} uses)` };
        });
      }

      if (data.cssVars?.variables?.length) {
        tokens.cssCustomProperty = {};
        for (const v of data.cssVars.variables) {
          const key = v.name.replace(/^--/, '').replace(/[^a-zA-Z0-9-]/g, '-');
          tokens.cssCustomProperty[key] = { $value: v.value, $type: 'string' };
        }
      }

      // Build CSS output
      const cssLines = [':root {'];
      if (data.colors?.colors?.length) {
        cssLines.push('  /* Colors */');
        data.colors.colors.forEach((c, i) => { cssLines.push(`  --color-${i + 1}: ${c.hex};`); });
      }
      if (data.fonts?.families?.length) {
        cssLines.push('  /* Font Families */');
        data.fonts.families.forEach((f, i) => { cssLines.push(`  --font-family-${i + 1}: ${f.value};`); });
      }
      if (data.fonts?.sizes?.length) {
        cssLines.push('  /* Font Sizes */');
        data.fonts.sizes.forEach((s, i) => { cssLines.push(`  --font-size-${i + 1}: ${s.value};`); });
      }
      if (data.spacing?.spacing?.length) {
        cssLines.push('  /* Spacing */');
        data.spacing.spacing.forEach((s, i) => { cssLines.push(`  --space-${i + 1}: ${s.value};`); });
      }
      if (data.shadows?.boxShadows?.length) {
        cssLines.push('  /* Shadows */');
        data.shadows.boxShadows.forEach((s, i) => { cssLines.push(`  --shadow-${i + 1}: ${s.value};`); });
      }
      cssLines.push('}');

      // Save files
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const outDir = path.join(config.OUTPUT_DIR, `design-system-${timestamp}`);
      fs.mkdirSync(outDir, { recursive: true });

      const tokensFile = path.join(outDir, 'design-tokens.json');
      const cssFile = path.join(outDir, 'design-tokens.css');
      const rawFile = path.join(outDir, 'raw-data.json');

      fs.writeFileSync(tokensFile, JSON.stringify({
        _meta: { tool: 'tapsite_designsystem', url, timestamp: new Date().toISOString() },
        ...tokens,
      }, null, 2));
      fs.writeFileSync(cssFile, cssLines.join('\n'));
      fs.writeFileSync(rawFile, JSON.stringify(data, null, 2));

      const summaryText = [
        `🎨 DESIGN SYSTEM: ${url}`,
        `Output: ${outDir}`,
        '',
        `Tokens extracted:`,
        `  Colors: ${(data.colors.colors || []).length}`,
        `  Fonts: ${(data.fonts.families || []).length} families, ${(data.fonts.sizes || []).length} sizes`,
        `  Spacing: ${(data.spacing.spacing || []).length} values (base: ${data.spacing.inferredBase || '?'})`,
        `  Shadows: ${(data.shadows.boxShadows || []).length}`,
        `  CSS vars: ${(data.cssVars.variables || []).length}`,
        `  Breakpoints: ${(data.breakpoints.breakpoints || []).length}`,
        `  Animations: ${(data.animations.keyframes || []).length}`,
        `  Icons: ${data.icons.totalUniqueIcons || 0} (${(data.icons.libraries || []).join(', ') || 'none'})`,
        `  Components: ${(data.components.components || []).length} patterns`,
        '',
        `Files:`,
        `  ${tokensFile}`,
        `  ${cssFile}`,
        `  ${rawFile}`,
      ].join('\n');

      return { content: [{ type: 'text', text: summaryText }] };
    }
  );

};
