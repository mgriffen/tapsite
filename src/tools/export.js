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
} = require('../extractors');
const { inspectPageV2 } = require('../inspector');
const { createRunDir, screenshotPath, exportJSON, exportMarkdown, exportHTML, exportCSV } = require('../exporter');
const config = require('../config');
const browser = require('../browser');
const { navigateIfNeeded, requireSafeUrl, safeEvaluate } = require('../helpers');

const PKG_VERSION = require('../../package.json').version;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = function registerExportTools(server, allowTool = () => true) {

  if (allowTool('tapsite_export')) server.tool(
    'tapsite_export',
    'Export URLs as Markdown + HTML report + JSON + CSV + screenshots.',
    {
      urls: z.array(z.string()).describe('URLs to export'),
    },
    async ({ urls }) => {
      await browser.ensureBrowser();
      const runDir = createRunDir();
      const results = [];

      for (const [i, url] of urls.entries()) {
        requireSafeUrl(url);
        try {
          await browser.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        } catch {}
        await browser.page.waitForTimeout(1500);

        const data = await inspectPageV2(browser.page);
        await browser.page.screenshot({ path: screenshotPath(runDir, i), fullPage: true });
        results.push(data);
      }

      const jsonPath = exportJSON(runDir, results);
      const mdPath = exportMarkdown(runDir, results);
      const htmlPath = exportHTML(runDir, results);
      const csvFiles = exportCSV(runDir, results);

      const lines = [
        `Exported ${results.length} page(s) to ${runDir}`,
        `  JSON:     ${jsonPath}`,
        `  Markdown: ${mdPath}`,
        `  HTML:     ${htmlPath}`,
        `  Screenshots: ${runDir}/screenshots/`,
      ];
      if (csvFiles.length) {
        lines.push(`  CSV tables (${csvFiles.length}): ${csvFiles.map(f => path.basename(f)).join(', ')}`);
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  if (allowTool('tapsite_export_design_report')) server.tool(
    'tapsite_export_design_report',
    'Full design system report: HTML + W3C tokens JSON + CSS vars.',
    {
      url: z.string().describe('URL to analyze'),
      include: z
        .array(z.enum(['colors', 'fonts', 'css_vars', 'spacing', 'components', 'breakpoints']))
        .default(['colors', 'fonts', 'css_vars', 'spacing', 'components', 'breakpoints'])
        .describe('Sections to include'),
    },
    async ({ url, include }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);

      const data = {};
      if (include.includes('colors'))      data.colors      = await safeEvaluate(browser.page, extractColorsInBrowser, { limit: 50 });
      if (include.includes('fonts'))       data.fonts       = await safeEvaluate(browser.page, extractFontsInBrowser);
      if (include.includes('css_vars'))    data.cssVars     = await safeEvaluate(browser.page, extractCssVarsInBrowser, { includeAll: false });
      if (include.includes('spacing'))     data.spacing     = await safeEvaluate(browser.page, extractSpacingInBrowser, { sampleSize: 200 });
      if (include.includes('components')) data.components  = await safeEvaluate(browser.page, extractComponentsInBrowser, { minOccurrences: 2 });
      if (include.includes('breakpoints')) data.breakpoints = await safeEvaluate(browser.page, extractBreakpointsInBrowser);

      // Build design-tokens.json (W3C Design Tokens format)
      const tokens = {};

      if (data.colors?.colors?.length) {
        tokens.color = {};
        data.colors.colors.forEach((c, i) => {
          const name = `color-${i + 1}`;
          tokens.color[name] = { $value: c.hex, $type: 'color', $description: `count: ${c.count}` };
        });
      }

      if (data.fonts?.families?.length) {
        tokens.fontFamily = {};
        data.fonts.families.forEach((f, i) => {
          tokens.fontFamily[`font-${i + 1}`] = { $value: f.value, $type: 'fontFamily', $description: `${f.count} use(s)` };
        });
        if (data.fonts.sizes?.length) {
          tokens.fontSize = {};
          data.fonts.sizes.forEach((s, i) => {
            tokens.fontSize[`size-${i + 1}`] = { $value: s.value, $type: 'dimension', $description: `count: ${s.count}` };
          });
        }
      }

      if (data.spacing?.spacing?.length) {
        tokens.spacing = {};
        data.spacing.spacing.forEach((s, i) => {
          tokens.spacing[`space-${i + 1}`] = { $value: s.value, $type: 'dimension', $description: `count: ${s.count}` };
        });
      }

      if (data.cssVars?.variables?.length) {
        tokens.cssCustomProperty = {};
        for (const v of data.cssVars.variables) {
          const key = v.name.replace(/^--/, '').replace(/[^a-zA-Z0-9-]/g, '-');
          tokens.cssCustomProperty[key] = { $value: v.value, $type: 'string' };
        }
      }

      // Build design-tokens.css
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
        cssLines.push('  /* Spacing Scale */');
        data.spacing.spacing.forEach((s, i) => { cssLines.push(`  --space-${i + 1}: ${s.value};`); });
      }
      if (data.cssVars?.variables?.length) {
        cssLines.push('  /* Original CSS Custom Properties */');
        for (const v of data.cssVars.variables) { cssLines.push(`  ${v.name}: ${v.value};`); }
      }
      cssLines.push('}');

      // Build report.html
      let body = '';

      if (data.colors?.colors?.length) {
        body += `<section id="colors"><h2>Colors <span class="count">${data.colors.colors.length}</span></h2>
        <div class="swatches">`;
        for (const c of data.colors.colors) {
          const isLight = parseInt(c.hex.slice(1, 3), 16) * 0.299 +
                          parseInt(c.hex.slice(3, 5), 16) * 0.587 +
                          parseInt(c.hex.slice(5, 7), 16) * 0.114 > 186;
          body += `<div class="swatch" style="background:${c.hex};color:${isLight ? '#222' : '#fff'}">
          <span class="swatch-hex">${esc(c.hex)}</span>
          <span class="swatch-count">${c.count}×</span></div>`;
        }
        body += '</div></section>';
      }

      if (data.fonts?.families?.length) {
        body += `<section id="typography"><h2>Typography</h2><table>
        <thead><tr><th>Family</th><th>Usage</th></tr></thead><tbody>`;
        for (const f of data.fonts.families) {
          body += `<tr><td style="font-family:${esc(f.value)}">${esc(f.value)}</td>
          <td>${f.count}</td></tr>`;
        }
        if (data.fonts.sizes?.length) {
          body += `</tbody></table><h3>Font Sizes</h3><table><thead><tr><th>Size</th><th>Count</th></tr></thead><tbody>`;
          for (const s of data.fonts.sizes.slice(0, 15)) {
            body += `<tr><td>${esc(s.value)}</td><td>${s.count}</td></tr>`;
          }
        }
        body += '</tbody></table></section>';
      }

      if (data.cssVars?.variables?.length) {
        body += `<section id="css-vars"><h2>CSS Custom Properties <span class="count">${data.cssVars.variables.length}</span></h2><table>
        <thead><tr><th>Variable</th><th>Value</th><th>Category</th></tr></thead><tbody>`;
        for (const v of data.cssVars.variables) {
          const isColor = /^#|^rgb/.test(v.value);
          const swatch = isColor ? `<span class="inline-swatch" style="background:${esc(v.value)}"></span>` : '';
          body += `<tr><td><code>${esc(v.name)}</code></td><td>${swatch}${esc(v.value)}</td><td>${esc(v.category || '')}</td></tr>`;
        }
        body += '</tbody></table></section>';
      }

      if (data.spacing?.spacing?.length) {
        body += `<section id="spacing"><h2>Spacing Scale</h2><div class="spacing-list">`;
        for (const s of data.spacing.spacing) {
          const px = parseFloat(s.value) || 0;
          const barW = Math.min(px * 2, 300);
          body += `<div class="spacing-row">
          <code>${esc(s.value)}</code>
          <div class="spacing-bar" style="width:${barW}px"></div>
          <span class="spacing-count">${s.count}×</span></div>`;
        }
        body += '</div></section>';
      }

      if (data.components?.components?.length) {
        body += `<section id="components"><h2>Components <span class="count">${data.components.components.length}</span></h2><table>
        <thead><tr><th>Pattern</th><th>Count</th><th>Tag</th></tr></thead><tbody>`;
        for (const c of data.components.components) {
          body += `<tr><td><code>${esc(c.signature)}</code></td><td>${c.count}</td><td>${esc(c.tag || '')}</td></tr>`;
        }
        body += '</tbody></table></section>';
      }

      if (data.breakpoints?.breakpoints?.length) {
        body += `<section id="breakpoints"><h2>Breakpoints</h2><table>
        <thead><tr><th>Query</th><th>Min</th><th>Max</th></tr></thead><tbody>`;
        for (const bp of data.breakpoints.breakpoints) {
          body += `<tr><td><code>${esc(bp.query)}</code></td><td>${esc(bp.minWidth ?? '')}</td><td>${esc(bp.maxWidth ?? '')}</td></tr>`;
        }
        body += '</tbody></table></section>';
      }

      const reportHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Design System Report</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 1100px; margin: 0 auto; padding: 2rem; color: #1a1a1a; background: #fafafa; }
    header { margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 2px solid #e5e7eb; }
    header h1 { margin: 0 0 .25rem; font-size: 1.6rem; }
    header p { margin: 0; color: #6b7280; font-size: .9rem; }
    nav { display: flex; gap: 1rem; margin: 1rem 0 2rem; flex-wrap: wrap; }
    nav a { font-size: .85rem; color: #4f46e5; text-decoration: none; padding: .3rem .7rem; border: 1px solid #c7d2fe; border-radius: 999px; }
    nav a:hover { background: #ede9fe; }
    section { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; }
    h2 { margin: 0 0 1rem; font-size: 1.1rem; display: flex; align-items: center; gap: .5rem; }
    .count { font-size: .75rem; font-weight: 400; background: #f3f4f6; color: #6b7280; padding: .1rem .45rem; border-radius: 999px; }
    table { border-collapse: collapse; width: 100%; font-size: .875rem; }
    th, td { border: 1px solid #e5e7eb; padding: 7px 12px; text-align: left; }
    th { background: #f9fafb; font-weight: 600; }
    code { font-family: ui-monospace, monospace; font-size: .8rem; background: #f3f4f6; padding: .1rem .3rem; border-radius: 3px; }
    .swatches { display: flex; flex-wrap: wrap; gap: .5rem; }
    .swatch { width: 80px; height: 80px; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: .65rem; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
    .swatch-hex { margin-bottom: 2px; }
    .swatch-count { opacity: .7; }
    .inline-swatch { display: inline-block; width: 12px; height: 12px; border-radius: 2px; border: 1px solid rgba(0,0,0,.15); vertical-align: middle; margin-right: 4px; }
    .spacing-list { display: flex; flex-direction: column; gap: .4rem; }
    .spacing-row { display: flex; align-items: center; gap: 1rem; font-size: .85rem; }
    .spacing-row code { width: 70px; flex-shrink: 0; }
    .spacing-bar { height: 16px; background: #4f46e5; border-radius: 3px; flex-shrink: 0; }
    .spacing-count { color: #9ca3af; font-size: .75rem; }
    footer { color: #9ca3af; font-size: .8rem; text-align: center; margin-top: 2rem; }
  </style>
</head>
<body>
  <header>
    <h1>Design System Report</h1>
    <p>${esc(url)} &mdash; ${new Date().toISOString()}</p>
  </header>
  <nav>
    ${include.map(s => `<a href="#${s.replace('_', '-')}">${s.replace('_', ' ')}</a>`).join('\n    ')}
  </nav>
  ${body}
  <footer>Generated by tapsite</footer>
</body>
</html>`;

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const outDir = path.join(config.OUTPUT_DIR, `design-report-${timestamp}`);
      fs.mkdirSync(outDir, { recursive: true });

      const htmlFile   = path.join(outDir, 'report.html');
      const tokensFile = path.join(outDir, 'design-tokens.json');
      const cssFile    = path.join(outDir, 'design-tokens.css');

      fs.writeFileSync(htmlFile,   reportHtml);
      const tokensWithMeta = {
        _meta: {
          tool: 'tapsite_export_design_report',
          url: browser.page?.url() || url,
          timestamp: new Date().toISOString(),
          version: PKG_VERSION,
          description: 'Design system tokens extracted in W3C Design Tokens format',
          sections: include,
        },
        ...tokens,
      };
      fs.writeFileSync(tokensFile, JSON.stringify(tokensWithMeta, null, 2));
      fs.writeFileSync(cssFile,    cssLines.join('\n'));

      const sections = Object.keys(data).join(', ');
      return {
        content: [{
          type: 'text',
          text: [
            `Design system report for ${url}`,
            `Sections: ${sections}`,
            `  HTML:             ${htmlFile}`,
            `  Design Tokens JSON: ${tokensFile}`,
            `  Design Tokens CSS:  ${cssFile}`,
          ].join('\n'),
        }],
      };
    }
  );

};
