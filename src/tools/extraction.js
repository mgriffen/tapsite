const { z } = require('zod');
const path = require('path');
const fs = require('fs');
const {
  extractColorsInBrowser,
  extractFontsInBrowser,
  extractCssVarsInBrowser,
  extractSpacingInBrowser,
  extractImagesInBrowser,
  extractSvgsInBrowser,
  extractFaviconInBrowser,
  extractLayoutInBrowser,
  extractComponentsInBrowser,
  extractBreakpointsInBrowser,
  extractMetadataInBrowser,
  extractContentInBrowser,
  extractFormsInBrowser,
  extractAnimationsInBrowser,
  extractA11yInBrowser,
  detectDarkmodeInBrowser,
  extractPerfInBrowser,
  extractShadowsInBrowser,
  extractIconsInBrowser,
  extractContrastInBrowser,
  extractWebComponentsInBrowser,
  extractThirdPartyInBrowser,
  extractStorageInBrowser,
  extractPwaInBrowser,
  extractSecurityInBrowser,
  extractAiMlInBrowser,
  extractCanvasInBrowser,
  extractI18nInBrowser,
  extractGraphqlInBrowser,
  extractWasmInBrowser,
} = require('../extractors');
const config = require('../config');
const browser = require('../browser');
const { navigateIfNeeded, requireSafeUrl, summarizeResult, safeEvaluate } = require('../helpers');

function formatLayoutTree(node, indent = '') {
  if (!node) return '';
  const attrs = [];
  if (node.display) attrs.push(node.display);
  if (node.direction) attrs.push(node.direction);
  if (node.columns) attrs.push(`cols: ${node.columns}`);
  if (node.rows) attrs.push(`rows: ${node.rows}`);
  if (node.gap) attrs.push(`gap: ${node.gap}`);
  if (node.justify) attrs.push(`justify: ${node.justify}`);
  if (node.align) attrs.push(`align: ${node.align}`);
  if (node.wrap) attrs.push(`wrap: ${node.wrap}`);
  if (node.position) attrs.push(`pos: ${node.position}`);
  const dims = `${node.w}×${node.h}`;
  const line = `${indent}${node.el} [${dims}] ${attrs.join(', ')}`;
  const lines = [line];
  if (node.children) {
    for (const child of node.children) {
      if (child === '…') {
        lines.push(`${indent}  …`);
      } else {
        lines.push(formatLayoutTree(child, indent + '  '));
      }
    }
  }
  return lines.join('\n');
}

module.exports = function registerExtractionTools(server, allowTool = () => true) {

  if (allowTool('tapsite_extract_table')) server.tool(
    'tapsite_extract_table',
    'Extract table data as structured rows.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
      minColumns: z.number().default(2).describe('Min columns per row'),
      limit: z.number().default(50).describe('Max rows'),
    },
    async ({ url, minColumns, limit }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);

      const tableData = await safeEvaluate(browser.page, 
        ({ minColumns, limit }) => {
          const rows = [...document.querySelectorAll('tr')];
          const results = [];
          for (const row of rows) {
            const cells = [...row.querySelectorAll('td, th')];
            if (cells.length >= minColumns) {
              const rowData = cells.map((c) => {
                const text = c.textContent.trim();
                const link = c.querySelector('a')?.href || undefined;
                const imgAlt = c.querySelector('img')?.alt || undefined;
                return { text: text.slice(0, 200), link, imgAlt };
              });
              results.push(rowData);
              if (results.length >= limit) break;
            }
          }
          return results;
        },
        { minColumns, limit }
      );

      const rows = tableData || [];
      const cols = rows[0]?.length || 0;
      const headers = rows[0]?.map(c => c.text).join(' | ') || '';
      const preview = rows.slice(1, 4).map(r => r.map(c => c.text?.slice(0, 25)).join(' | ')).join('\n  ');
      const summary = `Table: ${rows.length} rows x ${cols} columns\nHeaders: ${headers}\nPreview:\n  ${preview || '(empty)'}`;
      return summarizeResult('table', tableData, summary, { tool: 'tapsite_extract_table', description: 'Table rows extracted from the page' });
    }
  );

  if (allowTool('tapsite_extract_links')) server.tool(
    'tapsite_extract_links',
    'Extract all links with text and href.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
      filter: z.string().optional().describe('Filter: href contains this string'),
    },
    async ({ url, filter }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);

      let links = await safeEvaluate(browser.page, () => {
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
        return [...document.querySelectorAll('a[href]')]
          .filter(a => !isHiddenElement(a))
          .map((a) => ({
            text: a.textContent.trim() || a.querySelector('img')?.alt || '(image link)',
            href: a.href,
          }));
      });

      if (filter) {
        links = links.filter((l) => l.href.includes(filter));
      }

      const pageUrl = browser.page.url();
      let internal = 0, external = 0;
      try {
        const host = new URL(pageUrl).hostname;
        links.forEach(l => { try { new URL(l.href).hostname === host ? internal++ : external++; } catch { external++; } });
      } catch { external = links.length; }
      const sample = links.slice(0, 6).map(l => `${l.text.slice(0, 30)} (${l.href.slice(0, 50)})`).join('\n  ');
      const summary = `Links: ${links.length} found (${internal} internal, ${external} external)\n  ${sample || 'none'}`;
      return summarizeResult('links', links, summary, { tool: 'tapsite_extract_links', description: 'Links extracted from visible page elements' });
    }
  );

  if (allowTool('tapsite_extract_colors')) server.tool(
    'tapsite_extract_colors',
    'Extract color palette sorted by frequency.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
      limit: z.number().default(30).describe('Max colors'),
    },
    async ({ url, limit }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);
      const result = await safeEvaluate(browser.page, extractColorsInBrowser, { limit });
      const colors = result.colors || [];
      const top5 = colors.slice(0, 5).map(c => `${c.hex} (${c.count}x)`).join(', ');
      const summary = `Colors: ${colors.length} unique\nTop: ${top5 || 'none'}`;
      return summarizeResult('colors', result, summary, { tool: 'tapsite_extract_colors', description: 'Color palette extracted from computed styles and CSS custom properties' });
    }
  );

  if (allowTool('tapsite_extract_fonts')) server.tool(
    'tapsite_extract_fonts',
    'Extract fonts: families, sizes, weights, sources.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
    },
    async ({ url }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);
      const result = await safeEvaluate(browser.page, extractFontsInBrowser);
      const families = (result.families || []).map(f => `"${f.value}" (${f.count}x)`).join(', ');
      const sizes = (result.sizes || []).slice(0, 5).map(s => s.value).join(', ');
      const summary = `Fonts: ${(result.families || []).length} families, ${(result.sizes || []).length} sizes, ${(result.weights || []).length} weights\nFamilies: ${families || 'none'}\nSizes: ${sizes || 'none'}`;
      return summarizeResult('fonts', result, summary, { tool: 'tapsite_extract_fonts', description: 'Font families, sizes, and weights used across the page' });
    }
  );

  if (allowTool('tapsite_extract_css_vars')) server.tool(
    'tapsite_extract_css_vars',
    'Extract CSS custom properties, categorized by type.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
      includeAll: z.boolean().default(false).describe('Also scan inline styles'),
    },
    async ({ url, includeAll }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);
      const result = await safeEvaluate(browser.page, extractCssVarsInBrowser, { includeAll });
      const vars = result.variables || [];
      const catStr = Object.entries(result.summary || {}).map(([k, v]) => `${k} (${v})`).join(', ');
      const samples = vars.slice(0, 4).map(v => `${v.name}: ${v.value}`).join(', ');
      const summary = `CSS vars: ${result.total || vars.length} total | ${catStr}\nSample: ${samples || 'none'}`;
      return summarizeResult('css-vars', result, summary, { tool: 'tapsite_extract_css_vars', description: 'CSS custom properties (variables) defined in stylesheets' });
    }
  );

  if (allowTool('tapsite_extract_spacing')) server.tool(
    'tapsite_extract_spacing',
    'Extract spacing scale: margins, padding, gaps, radii.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
      sampleSize: z.number().default(200).describe('Max elements to sample'),
    },
    async ({ url, sampleSize }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);
      const result = await safeEvaluate(browser.page, extractSpacingInBrowser, { sampleSize });
      const spacing = result.spacing || [];
      const scale = spacing.slice(0, 10).map(s => s.value).join(', ');
      const top5 = spacing.slice(0, 5).map(s => `${s.value} (${s.count}x)`).join(', ');
      const summary = `Spacing: ${spacing.length} values | Base: ${result.inferredBase || 'unknown'}\nScale: ${scale || 'none'}\nTop: ${top5 || 'none'}`;
      return summarizeResult('spacing', result, summary, { tool: 'tapsite_extract_spacing', description: 'Spacing scale values from margins, padding, and gaps' });
    }
  );

  if (allowTool('tapsite_extract_images')) server.tool(
    'tapsite_extract_images',
    'Extract all images with src, dimensions, alt, format.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
      minWidth: z.number().default(1).describe('Min width in px'),
      filter: z.string().optional().describe('Filter: src contains string'),
    },
    async ({ url, minWidth, filter }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);
      const result = await safeEvaluate(browser.page, extractImagesInBrowser, { minWidth, filter: filter || '' });
      const imgs = result.images || [];
      const byType = {};
      imgs.forEach(i => { byType[i.source || 'unknown'] = (byType[i.source || 'unknown'] || 0) + 1; });
      const typeStr = Object.entries(byType).map(([k, v]) => `${k} (${v})`).join(', ');
      const top3 = imgs.slice(0, 3).map(i => `${(i.src || '').split('/').pop()?.slice(0, 30)} ${i.width}x${i.height}`).join(', ');
      const summary = `Images: ${imgs.length} found | ${typeStr}\nTop: ${top3 || 'none'}`;
      return summarizeResult('images', result, summary, { tool: 'tapsite_extract_images', description: 'Images found on the page with dimensions and source URLs' });
    }
  );

  if (allowTool('tapsite_download_images')) server.tool(
    'tapsite_download_images',
    'Download images to disk. Uses session cookies for auth assets.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
      minWidth: z.number().default(50).describe('Min width in px'),
      filter: z.string().optional().describe('Filter: src contains string'),
      limit: z.number().min(1).max(200).default(50).describe('Max images (1-200)'),
      formats: z.array(z.string()).optional().describe("Extensions filter (e.g. ['png','jpg'])"),
    },
    async ({ url, minWidth, filter, limit, formats }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);

      const { images } = await safeEvaluate(browser.page, extractImagesInBrowser, { minWidth, filter: filter || '' });

      let toDownload = images;
      if (formats && formats.length > 0) {
        const exts = formats.map(f => f.toLowerCase().replace(/^\./, ''));
        toDownload = toDownload.filter(img => {
          const urlPath = new URL(img.src, browser.page.url()).pathname.toLowerCase();
          return exts.some(ext => urlPath.endsWith(`.${ext}`));
        });
      }
      toDownload = toDownload.slice(0, limit);

      const assetsDir = path.join(config.OUTPUT_DIR, 'assets', 'images');
      fs.mkdirSync(assetsDir, { recursive: true });

      const downloaded = [];
      const errors = [];

      for (const img of toDownload) {
        try {
          const imgUrl = new URL(img.src, browser.page.url()).href;
          try { requireSafeUrl(imgUrl); } catch { errors.push({ src: img.src, error: 'Blocked non-http(s) URL' }); continue; }
          const response = await browser.page.context().request.get(imgUrl);
          if (!response.ok()) {
            errors.push({ src: img.src, status: response.status() });
            continue;
          }
          const body = await response.body();

          const urlObj = new URL(imgUrl);
          let filename = path.basename(urlObj.pathname) || 'image';
          filename = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
          let savePath = path.join(assetsDir, filename);
          let counter = 1;
          while (fs.existsSync(savePath)) {
            const ext = path.extname(filename);
            const base = path.basename(filename, ext);
            savePath = path.join(assetsDir, `${base}_${counter}${ext}`);
            counter++;
          }

          fs.writeFileSync(savePath, body);
          downloaded.push({ src: img.src, saved: savePath, size: body.length });
        } catch (err) {
          errors.push({ src: img.src, error: err.message });
        }
      }

      const summary = `Downloaded ${downloaded.length}/${toDownload.length} images to ${assetsDir}\n` +
        downloaded.map(d => `  ✓ ${path.basename(d.saved)} (${(d.size / 1024).toFixed(1)}KB)`).join('\n') +
        (errors.length ? '\n\nErrors:\n' + errors.map(e => `  ✗ ${e.src}: ${e.error || `HTTP ${e.status}`}`).join('\n') : '');

      return { content: [{ type: 'text', text: summary }] };
    }
  );

  if (allowTool('tapsite_extract_svgs')) server.tool(
    'tapsite_extract_svgs',
    'Extract SVGs: inline markup, external URLs, icon/illustration classification.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
      limit: z.number().min(1).max(200).default(50).describe('Max SVGs (1-200)'),
      download: z.boolean().default(false).describe('Download to output/assets/svgs/'),
    },
    async ({ url, limit, download }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);
      const result = await safeEvaluate(browser.page, extractSvgsInBrowser, { limit });

      if (download) {
        const svgDir = path.join(config.OUTPUT_DIR, 'assets', 'svgs');
        fs.mkdirSync(svgDir, { recursive: true });
        let savedCount = 0;

        for (let i = 0; i < result.svgs.length; i++) {
          const svg = result.svgs[i];
          try {
            if (svg.type === 'inline' && svg.markup && !svg.markup.endsWith('…')) {
              const filePath = path.join(svgDir, `inline_${i + 1}.svg`);
              fs.writeFileSync(filePath, svg.markup);
              svg.savedTo = filePath;
              savedCount++;
            } else if (svg.type === 'external' && svg.src) {
              try { requireSafeUrl(new URL(svg.src, browser.page.url()).href); } catch { continue; }
              const response = await browser.page.context().request.get(svg.src);
              if (response.ok()) {
                const body = await response.body();
                const filename = path.basename(new URL(svg.src, browser.page.url()).pathname).replace(/[^a-zA-Z0-9._-]/g, '_') || `svg_${i + 1}.svg`;
                const filePath = path.join(svgDir, filename);
                fs.writeFileSync(filePath, body);
                svg.savedTo = filePath;
                savedCount++;
              }
            }
          } catch {}
        }
        result.downloaded = savedCount;
        result.downloadDir = svgDir;
      }

      const svgs = result.svgs || [];
      const inline = svgs.filter(s => s.type === 'inline').length;
      const external = svgs.filter(s => s.type === 'external').length;
      const icons = svgs.filter(s => s.classification === 'icon').length;
      const summary = `SVGs: ${svgs.length} total (${inline} inline, ${external} external) | Icons: ${icons}, Illustrations: ${svgs.length - icons}${result.downloaded != null ? ` | Downloaded: ${result.downloaded}` : ''}`;
      return summarizeResult('svgs', result, summary, { tool: 'tapsite_extract_svgs', description: 'SVG elements with markup, classification, and source URLs' });
    }
  );

  if (allowTool('tapsite_extract_favicon')) server.tool(
    'tapsite_extract_favicon',
    'Extract favicon and icon references. Optional download.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
      download: z.boolean().default(false).describe('Download to output/assets/favicons/'),
    },
    async ({ url, download }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);
      const result = await safeEvaluate(browser.page, extractFaviconInBrowser);

      if (result.manifestUrl) {
        try {
          const response = await browser.page.context().request.get(result.manifestUrl);
          if (response.ok()) {
            const manifest = JSON.parse(await response.text());
            if (manifest.icons && Array.isArray(manifest.icons)) {
              for (const icon of manifest.icons) {
                let src;
                try { src = new URL(icon.src, result.manifestUrl).href; } catch { continue; }
                const proto = new URL(src).protocol;
                if (proto !== 'http:' && proto !== 'https:') continue;
                result.icons.push({
                  src,
                  type: 'manifest-icon',
                  sizes: icon.sizes || null,
                  mimeType: icon.type || null,
                });
              }
              result.total = result.icons.length;
            }
          }
        } catch {}
      }

      if (download) {
        const favDir = path.join(config.OUTPUT_DIR, 'assets', 'favicons');
        fs.mkdirSync(favDir, { recursive: true });
        let savedCount = 0;

        for (const icon of result.icons) {
          try {
            try { requireSafeUrl(new URL(icon.src, browser.page.url()).href); } catch { continue; }
            const response = await browser.page.context().request.get(icon.src);
            if (response.ok()) {
              const body = await response.body();
              const urlObj = new URL(icon.src, browser.page.url());
              let filename = path.basename(urlObj.pathname).replace(/[^a-zA-Z0-9._-]/g, '_') || 'favicon';
              let savePath = path.join(favDir, filename);
              let counter = 1;
              while (fs.existsSync(savePath)) {
                const ext = path.extname(filename);
                const base = path.basename(filename, ext);
                savePath = path.join(favDir, `${base}_${counter}${ext}`);
                counter++;
              }
              fs.writeFileSync(savePath, body);
              icon.savedTo = savePath;
              savedCount++;
            }
          } catch {}
        }
        result.downloaded = savedCount;
        result.downloadDir = favDir;
      }

      const icons = result.icons || [];
      const types = {};
      icons.forEach(i => { types[i.type || 'icon'] = (types[i.type || 'icon'] || 0) + 1; });
      const typeStr = Object.entries(types).map(([k, v]) => `${k} (${v})`).join(', ');
      const sizes = icons.map(i => i.sizes).filter(Boolean).join(', ');
      const summary = `Favicons: ${icons.length} found | ${typeStr}\nSizes: ${sizes || 'none'}${result.downloaded != null ? `\nDownloaded: ${result.downloaded}` : ''}`;
      return summarizeResult('favicon', result, summary, { tool: 'tapsite_extract_favicon', description: 'Favicon and icon references including Web App Manifest icons' });
    }
  );

  if (allowTool('tapsite_extract_layout')) server.tool(
    'tapsite_extract_layout',
    'Extract layout tree: flex/grid/block containers with properties.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
      maxDepth: z.number().default(6).describe('Max tree depth'),
    },
    async ({ url, maxDepth }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);
      const result = await safeEvaluate(browser.page, extractLayoutInBrowser, { maxDepth });
      const text = formatLayoutTree(result.layout);
      return { content: [{ type: 'text', text }] };
    }
  );

  if (allowTool('tapsite_extract_components')) server.tool(
    'tapsite_extract_components',
    'Detect repeated UI component patterns with instance counts.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
      minOccurrences: z.number().default(3).describe('Min occurrences to qualify'),
    },
    async ({ url, minOccurrences }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);
      const result = await safeEvaluate(browser.page, extractComponentsInBrowser, { minOccurrences });
      const comps = result.components || [];
      const top5 = comps.slice(0, 5).map(c => `${c.tag}${c.classes ? '.' + c.classes.split(' ')[0] : ''} (${c.count}x)`).join('\n  ');
      const summary = `Components: ${comps.length} patterns detected\n  ${top5 || 'none'}`;
      return summarizeResult('components', result, summary, { tool: 'tapsite_extract_components', description: 'Repeated UI component patterns detected on the page' });
    }
  );

  if (allowTool('tapsite_extract_breakpoints')) server.tool(
    'tapsite_extract_breakpoints',
    'Extract CSS breakpoints and detect framework (Tailwind/Bootstrap/MUI).',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
    },
    async ({ url }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);
      const result = await safeEvaluate(browser.page, extractBreakpointsInBrowser);
      const bps = result.breakpoints || [];
      const vals = bps.map(b => b.value || b.query || '').join(', ');
      const fw = (result.detectedFrameworks || []).length ? ` | Framework: ${result.detectedFrameworks.join(', ')}` : '';
      const summary = `Breakpoints: ${bps.length} found${fw}\nValues: ${vals || 'none'}\nViewport: ${result.viewport?.width || '?'}x${result.viewport?.height || '?'}`;
      return summarizeResult('breakpoints', result, summary, { tool: 'tapsite_extract_breakpoints', description: 'CSS media query breakpoints and detected responsive framework' });
    }
  );

  if (allowTool('tapsite_extract_metadata')) server.tool(
    'tapsite_extract_metadata',
    'Extract metadata: OG, Twitter Cards, JSON-LD, RSS, canonical.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
    },
    async ({ url }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url, 1000);
      const result = await safeEvaluate(browser.page, extractMetadataInBrowser);
      const og = result.openGraph ? Object.keys(result.openGraph).length : 0;
      const tw = result.twitterCard ? Object.keys(result.twitterCard).length : 0;
      const ld = Array.isArray(result.jsonLd) ? result.jsonLd.length : 0;
      const summary = `Metadata: "${result.title || ''}" | OG: ${og} tags | Twitter: ${tw} tags | JSON-LD: ${ld}\nCanonical: ${result.canonical || 'none'} | Lang: ${result.lang || '?'}`;
      return summarizeResult('metadata', result, summary, { tool: 'tapsite_extract_metadata', description: 'Page metadata: Open Graph, Twitter Cards, JSON-LD, and canonical URLs' });
    }
  );

  if (allowTool('tapsite_extract_content')) server.tool(
    'tapsite_extract_content',
    'Extract main content as clean markdown, stripping chrome.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
      selector: z.string().max(500).optional().describe('CSS selector to scope extraction'),
      includeImages: z.boolean().default(false).describe('Include images in output'),
    },
    async ({ url, selector, includeImages }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url, 1000);
      const result = await safeEvaluate(browser.page, extractContentInBrowser, { selector, includeImages });
      return { content: [{ type: 'text', text: result.content }] };
    }
  );

  if (allowTool('tapsite_extract_forms')) server.tool(
    'tapsite_extract_forms',
    'Extract forms: fields, validation, actions, hidden fields.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
    },
    async ({ url }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url, 1000);
      const result = await safeEvaluate(browser.page, extractFormsInBrowser);
      const forms = result.forms || [];
      const totalFields = forms.reduce((sum, f) => sum + (f.fields || []).length, 0);
      const formLines = forms.slice(0, 5).map(f => {
        const names = (f.fields || []).slice(0, 5).map(fld => fld.name || fld.type).join(', ');
        return `${f.method || '?'} ${f.action || '?'} — ${(f.fields || []).length} fields [${names}]`;
      }).join('\n  ');
      const summary = `Forms: ${forms.length} found, ${totalFields} total fields\n  ${formLines || 'none'}`;
      return summarizeResult('forms', result, summary, { tool: 'tapsite_extract_forms', description: 'Form elements with fields, validation attributes, and actions' });
    }
  );

  if (allowTool('tapsite_extract_animations')) server.tool(
    'tapsite_extract_animations',
    'Extract CSS animations, transitions, and detect animation libraries.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
    },
    async ({ url }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);
      const result = await safeEvaluate(browser.page, extractAnimationsInBrowser);
      const kf = (result.keyframes || []).length;
      const tr = (result.transitions || []).length;
      const libs = [...(result.jsLibraries || []), ...(result.cssLibraries || [])].join(', ');
      const kfNames = (result.keyframes || []).slice(0, 5).map(k => k.name).join(', ');
      const summary = `Animations: ${kf} @keyframes, ${tr} transitions${libs ? ` | Libraries: ${libs}` : ''}\nKeyframes: ${kfNames || 'none'}`;
      return summarizeResult('animations', result, summary, { tool: 'tapsite_extract_animations', description: 'CSS animations, keyframes, transitions, and detected animation libraries' });
    }
  );

  if (allowTool('tapsite_extract_a11y')) server.tool(
    'tapsite_extract_a11y',
    'Accessibility audit with score (0-100) and issues by severity.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
      standard: z.enum(['aa', 'aaa']).default('aa').describe('WCAG standard (aa or aaa)'),
    },
    async ({ url, standard }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);
      const result = await safeEvaluate(browser.page, extractA11yInBrowser, { standard });
      const issues = result.issues || [];
      const bySev = {};
      issues.forEach(i => { bySev[i.severity || 'info'] = (bySev[i.severity || 'info'] || 0) + 1; });
      const sevStr = Object.entries(bySev).map(([k, v]) => `${v} ${k}`).join(', ');
      const topIssues = issues.filter(i => i.severity === 'critical' || i.severity === 'error').slice(0, 3).map(i => i.message || i.type).join('; ');
      const summary = `A11y Score: ${result.score ?? '?'}/100 (WCAG ${standard.toUpperCase()}) | ${sevStr || 'no issues'}\nTop issues: ${topIssues || 'none critical'}`;
      return summarizeResult('a11y', result, summary, { tool: 'tapsite_extract_a11y', description: 'Accessibility audit with WCAG score and issues by severity' });
    }
  );

  if (allowTool('tapsite_extract_darkmode')) server.tool(
    'tapsite_extract_darkmode',
    'Detect dark mode support. Optionally capture dark palette.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
      activateDark: z.boolean().default(false).describe('Emulate dark mode and capture palette'),
    },
    async ({ url, activateDark }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);

      const result = await safeEvaluate(browser.page, detectDarkmodeInBrowser);

      if (activateDark) {
        await browser.page.emulateMedia({ colorScheme: 'dark' });
        await browser.page.waitForTimeout(500);
        const darkPalette = await safeEvaluate(browser.page, () => {
          const counts = {};
          for (const el of document.querySelectorAll('body *')) {
            if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
            const cs = getComputedStyle(el);
            for (const prop of ['color', 'background-color']) {
              const c = cs.getPropertyValue(prop);
              if (c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') {
                counts[c] = (counts[c] || 0) + 1;
              }
            }
          }
          return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => c);
        });
        result.darkPalette = darkPalette;
        await browser.page.emulateMedia({ colorScheme: 'no-preference' });
      }

      const method = result.hasDarkmodeMedia ? 'prefers-color-scheme' : (result.darkmodeClasses?.length ? 'css-classes' : 'unknown');
      const darkColors = (result.darkPalette || []).slice(0, 5).join(', ');
      const summary = `Dark mode: ${result.supported ? 'supported' : 'not detected'} (${method})${darkColors ? `\nDark palette: ${darkColors}` : ''}`;
      return summarizeResult('darkmode', result, summary, { tool: 'tapsite_extract_darkmode', description: 'Dark mode support detection and optional dark palette capture' });
    }
  );

  if (allowTool('tapsite_extract_perf')) server.tool(
    'tapsite_extract_perf',
    'Performance metrics: Web Vitals, resource sizes, timing.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
    },
    async ({ url }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url, 2000);
      const result = await safeEvaluate(browser.page, extractPerfInBrowser);
      const t = result.timing || {};
      const dom = result.dom || {};
      const res = result.resources || {};
      const byType = res.byType || {};
      const resStr = Object.entries(byType).map(([k, v]) => `${k}: ${v.count} files, ${v.transferKB}KB`).join(' | ');
      const summary = `Perf: TTFB ${t.ttfbMs ?? '?'}ms, DOMContentLoaded ${t.domContentLoadedMs ?? '?'}ms, Load ${t.loadMs ?? '?'}ms | DOM: ${dom.nodeCount ?? '?'} nodes (${dom.domSizeKB ?? '?'}KB)\nResources: ${res.total ?? '?'} total | ${resStr || 'none'}`;
      return summarizeResult('perf', result, summary, { tool: 'tapsite_extract_perf', description: 'Performance metrics: Web Vitals, resource sizes, and load timing' });
    }
  );

  if (allowTool('tapsite_extract_shadows')) server.tool(
    'tapsite_extract_shadows',
    'Extract box-shadow and text-shadow patterns as design tokens.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
      sampleSize: z.number().default(300).describe('Max elements to sample'),
    },
    async ({ url, sampleSize }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);
      const result = await safeEvaluate(browser.page, extractShadowsInBrowser, { sampleSize });
      const bs = result.boxShadows || [];
      const ts = result.textShadows || [];
      const byElev = {};
      bs.forEach(s => { byElev[s.elevation] = (byElev[s.elevation] || 0) + 1; });
      const elevStr = Object.entries(byElev).map(([k, v]) => `${k} (${v})`).join(', ');
      const top3 = bs.slice(0, 3).map(s => `${s.value.slice(0, 40)} (${s.count}x)`).join('\n  ');
      const summary = `Shadows: ${bs.length} box-shadow, ${ts.length} text-shadow | Elevation: ${elevStr || 'none'}\nTop:\n  ${top3 || 'none'}`;
      return summarizeResult('shadows', result, summary, { tool: 'tapsite_extract_shadows', description: 'Box-shadow and text-shadow patterns classified by elevation' });
    }
  );

  if (allowTool('tapsite_extract_icons')) server.tool(
    'tapsite_extract_icons',
    'Detect icon font libraries and extract icon usage (Font Awesome, Material, Bootstrap Icons, etc.).',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
    },
    async ({ url }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);
      const result = await safeEvaluate(browser.page, extractIconsInBrowser);
      const libs = (result.libraries || []).join(', ');
      const top5 = (result.icons || []).slice(0, 5).map(i => `${i.className} (${i.count}x)`).join(', ');
      const summary = `Icons: ${result.totalUniqueIcons || 0} unique, ${result.totalIconElements || 0} elements | Libraries: ${libs || 'none'}${result.pseudoContentIcons ? ` | Pseudo-content: ${result.pseudoContentIcons}` : ''}\nTop: ${top5 || 'none'}`;
      return summarizeResult('icons', result, summary, { tool: 'tapsite_extract_icons', description: 'Icon font libraries and individual icon usage detected on the page' });
    }
  );

  if (allowTool('tapsite_extract_contrast')) server.tool(
    'tapsite_extract_contrast',
    'WCAG contrast ratio audit between text and background color pairs.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
      sampleSize: z.number().default(200).describe('Max text elements to check'),
      standard: z.enum(['aa', 'aaa']).default('aa').describe('WCAG standard (aa or aaa)'),
    },
    async ({ url, sampleSize, standard }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);
      const result = await safeEvaluate(browser.page, extractContrastInBrowser, { sampleSize, standard });
      const worst = (result.worstPairs || []).slice(0, 3).map(p => `${p.foreground}/${p.background} = ${p.ratio}:1`).join(', ');
      const summary = `Contrast (WCAG ${standard.toUpperCase()}): ${result.passing || 0} passing, ${result.failing || 0} failing out of ${result.totalPairs || 0} pairs\nWorst: ${worst || 'all passing'}`;
      return summarizeResult('contrast', result, summary, { tool: 'tapsite_extract_contrast', description: 'WCAG contrast ratio audit for text/background color pairs' });
    }
  );

  if (allowTool('tapsite_extract_web_components')) {
    server.tool(
      'tapsite_extract_web_components',
      'Inventory custom elements, shadow DOM, exposed attributes, and web component libraries.',
      { url: z.string().optional().describe('URL (omit for current page)') },
      async ({ url }) => {
        await browser.ensureBrowser();
        await navigateIfNeeded(url);
        const data = await safeEvaluate(browser.page, extractWebComponentsInBrowser);
        const libs = data.libraries.length ? data.libraries.join(', ') : 'none';
        const shadowCount = data.components.filter(c => c.hasShadowRoot).length;
        const summary = `Web Components: ${data.totalCustomElements} custom elements (${data.totalInstances} total instances) | Libraries: ${libs} | Shadow roots: ${shadowCount}`;
        return summarizeResult('web-components', data, summary, { tool: 'tapsite_extract_web_components', description: 'Inventory custom elements and shadow DOM' });
      }
    );
  }

  if (allowTool('tapsite_extract_third_party')) {
    server.tool(
      'tapsite_extract_third_party',
      'Classify all cross-origin scripts and resources by vendor and category (analytics, payments, chat, etc.).',
      { url: z.string().optional().describe('URL (omit for current page)') },
      async ({ url }) => {
        await browser.ensureBrowser();
        await navigateIfNeeded(url);
        const data = await safeEvaluate(browser.page, extractThirdPartyInBrowser);
        const cats = Object.entries(data.byCategory).map(([k, v]) => `${k}: ${v}`).join(', ');
        const summary = `Third-Party: ${data.totalThirdParty} vendors | ${cats || 'none detected'} | Globals: ${data.confirmedGlobals.length ? data.confirmedGlobals.join(', ') : 'none'}`;
        return summarizeResult('third-party', data, summary, { tool: 'tapsite_extract_third_party', description: 'Classify cross-origin scripts and resources by vendor' });
      }
    );
  }

  if (allowTool('tapsite_extract_storage')) {
    server.tool(
      'tapsite_extract_storage',
      'Audit client-side storage: cookies (with classification), localStorage, sessionStorage, IndexedDB.',
      { url: z.string().optional().describe('URL (omit for current page)') },
      async ({ url }) => {
        await browser.ensureBrowser();
        await navigateIfNeeded(url);
        const data = await safeEvaluate(browser.page, extractStorageInBrowser);
        const cookieClasses = Object.entries(data.cookies.classified).map(([k, v]) => `${k}: ${v}`).join(', ');
        const summary = `Storage: ${data.cookies.total} cookies (${cookieClasses || 'none classified'}) | localStorage: ${data.localStorage.total} items (${data.localStorage.totalSizeEstimate}) | sessionStorage: ${data.sessionStorage.total} items (${data.sessionStorage.totalSizeEstimate})`;
        return summarizeResult('storage', data, summary, { tool: 'tapsite_extract_storage', description: 'Audit client-side storage: cookies, localStorage, sessionStorage, IndexedDB' });
      }
    );
  }

  if (allowTool('tapsite_extract_pwa')) {
    server.tool(
      'tapsite_extract_pwa',
      'Profile PWA readiness: manifest, service worker, Apple/MS meta tags, and platform capabilities.',
      { url: z.string().optional().describe('URL (omit for current page)') },
      async ({ url }) => {
        await browser.ensureBrowser();
        await navigateIfNeeded(url);
        const data = await safeEvaluate(browser.page, extractPwaInBrowser);
        let manifest = null;
        if (data.manifestUrl) {
          try {
            const resp = await browser.page.context().request.get(data.manifestUrl);
            if (resp.ok()) manifest = await resp.json();
          } catch {}
        }
        if (manifest) data.manifest = manifest;
        const installable = !!(manifest && manifest.name && manifest.start_url && manifest.display && manifest.icons?.length);
        data.installable = installable;
        const caps = Object.entries(data.capabilities).filter(([, v]) => v).map(([k]) => k);
        const summary = `PWA: manifest ${data.manifestUrl ? 'found' : 'missing'} | installable: ${installable ? 'yes' : 'no'} | SW: ${data.serviceWorker.registered ? 'active' : 'not registered'} | Capabilities: ${caps.length ? caps.join(', ') : 'none'}`;
        return summarizeResult('pwa', data, summary, { tool: 'tapsite_extract_pwa', description: 'Profile PWA readiness: manifest, service worker, capabilities' });
      }
    );
  }

  if (allowTool('tapsite_extract_security')) {
    server.tool(
      'tapsite_extract_security',
      'Security audit: CSP, SRI, mixed content, iframe sandboxing, insecure forms, response headers, and scoring.',
      { url: z.string().optional().describe('URL (omit for current page)') },
      async ({ url }) => {
        await browser.ensureBrowser();
        await navigateIfNeeded(url);
        const data = await safeEvaluate(browser.page, extractSecurityInBrowser);
        let responseHeaders = null;
        try {
          const resp = await browser.page.context().request.get(browser.page.url());
          if (resp.ok()) {
            const h = resp.headers();
            const secHeaders = [
              'content-security-policy', 'strict-transport-security', 'x-content-type-options',
              'x-frame-options', 'permissions-policy', 'referrer-policy',
              'cross-origin-embedder-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy',
            ];
            responseHeaders = {};
            for (const name of secHeaders) {
              if (h[name]) responseHeaders[name] = h[name];
            }
          }
        } catch {}
        if (responseHeaders) {
          data.responseHeaders = responseHeaders;
          if (responseHeaders['strict-transport-security']) data.score = Math.min(100, data.score + 5);
          if (responseHeaders['x-content-type-options']) data.score = Math.min(100, data.score + 5);
          if (responseHeaders['content-security-policy'] && !data.metaCsp) data.score = Math.min(100, data.score + 10);
          if (!responseHeaders['strict-transport-security']) data.findings.push({ issue: 'No HSTS header', severity: 'medium' });
          if (!responseHeaders['x-content-type-options']) data.findings.push({ issue: 'No X-Content-Type-Options header', severity: 'low' });
          data.grade = data.score >= 90 ? 'A' : data.score >= 80 ? 'B' : data.score >= 70 ? 'C' : data.score >= 60 ? 'D' : 'F';
        }
        const summary = `Security: ${data.grade} (${data.score}/100) | ${data.findings.length} findings | CSP: ${data.metaCsp ? 'yes' : 'no'} | SRI: ${data.sriAudit.withSri}/${data.sriAudit.total} scripts`;
        return summarizeResult('security', data, summary, { tool: 'tapsite_extract_security', description: 'Security audit: CSP, SRI, mixed content, headers, scoring' });
      }
    );
  }

  if (allowTool('tapsite_extract_aiml')) {
    server.tool(
      'tapsite_extract_aiml',
      'Detect client-side AI/ML libraries (TensorFlow.js, ONNX, MediaPipe, etc.) and browser ML capabilities.',
      { url: z.string().optional().describe('URL (omit for current page)') },
      async ({ url }) => {
        await browser.ensureBrowser();
        await navigateIfNeeded(url);
        const data = await safeEvaluate(browser.page, extractAiMlInBrowser);
        const libs = data.libraries.map(l => l.version ? `${l.name} v${l.version}` : l.name).join(', ');
        const caps = Object.entries(data.capabilities).filter(([, v]) => v).map(([k]) => k);
        const summary = `AI/ML: ${data.totalDetected} libraries detected (${libs || 'none'}) | Capabilities: ${caps.length ? caps.join(', ') : 'none'}`;
        return summarizeResult('aiml', data, summary, { tool: 'tapsite_extract_aiml', description: 'Detect client-side AI/ML libraries and capabilities' });
      }
    );
  }

  if (allowTool('tapsite_extract_canvas')) {
    server.tool(
      'tapsite_extract_canvas',
      'Inventory canvas elements, detect 2D/3D frameworks (Three.js, PixiJS, Phaser, etc.), and report GPU info.',
      { url: z.string().optional().describe('URL (omit for current page)') },
      async ({ url }) => {
        await browser.ensureBrowser();
        await navigateIfNeeded(url);
        const data = await safeEvaluate(browser.page, extractCanvasInBrowser);
        const fws = data.frameworks.map(f => f.version ? `${f.name} v${f.version}` : f.name).join(', ');
        const gpu = data.gpuInfo?.renderer ? ` | GPU: ${data.gpuInfo.renderer}` : '';
        const summary = `Canvas: ${data.totalCanvases} elements | Frameworks: ${fws || 'none'}${gpu} | WebGPU: ${data.webgpuSupported ? 'yes' : 'no'}`;
        return summarizeResult('canvas', data, summary, { tool: 'tapsite_extract_canvas', description: 'Inventory canvas elements, 2D/3D frameworks, GPU info' });
      }
    );
  }

  if (allowTool('tapsite_extract_i18n')) {
    server.tool(
      'tapsite_extract_i18n',
      'Profile internationalization: languages, hreflang tags, RTL content, i18n frameworks, and language switchers.',
      { url: z.string().optional().describe('URL (omit for current page)') },
      async ({ url }) => {
        await browser.ensureBrowser();
        await navigateIfNeeded(url);
        const data = await safeEvaluate(browser.page, extractI18nInBrowser);
        const fws = data.frameworks.map(f => f.name).join(', ');
        const summary = `i18n: ${data.primaryLanguage || 'unset'} | hreflang: ${data.hreflangCount} | RTL: ${data.hasRtlContent ? 'yes' : 'no'} | Frameworks: ${fws || 'none'} | Switcher: ${data.languageSwitcher ? data.languageSwitcher.type : 'none'}`;
        return summarizeResult('i18n', data, summary, { tool: 'tapsite_extract_i18n', description: 'Profile internationalization: languages, hreflang, RTL, frameworks' });
      }
    );
  }

  if (allowTool('tapsite_extract_graphql')) {
    server.tool(
      'tapsite_extract_graphql',
      'Detect GraphQL clients (Apollo, Relay, urql), related scripts, and endpoint hints.',
      { url: z.string().optional().describe('URL (omit for current page)') },
      async ({ url }) => {
        await browser.ensureBrowser();
        await navigateIfNeeded(url);
        const data = await safeEvaluate(browser.page, extractGraphqlInBrowser);
        const clientNames = data.clients.map(c => c.version ? `${c.name} v${c.version}` : c.name).join(', ');
        const summary = `GraphQL: ${data.totalClients} clients (${clientNames || 'none'}) | Endpoints: ${data.endpointHints.length || 'none detected'}`;
        return summarizeResult('graphql', data, summary, { tool: 'tapsite_extract_graphql', description: 'Detect GraphQL clients, scripts, and endpoint hints' });
      }
    );
  }

  if (allowTool('tapsite_extract_wasm')) {
    server.tool(
      'tapsite_extract_wasm',
      'Detect WebAssembly modules, infer source languages (Rust, C++, Go, .NET), and check WASM capabilities.',
      { url: z.string().optional().describe('URL (omit for current page)') },
      async ({ url }) => {
        await browser.ensureBrowser();
        await navigateIfNeeded(url);
        const data = await safeEvaluate(browser.page, extractWasmInBrowser);
        const langs = data.languageHints.length ? data.languageHints.join(', ') : 'none detected';
        const caps = Object.entries(data.capabilities).filter(([, v]) => v).map(([k]) => k);
        const summary = `WASM: ${data.supported ? 'supported' : 'not supported'} | ${data.totalModules} modules | Languages: ${langs} | Capabilities: ${caps.join(', ')}`;
        return summarizeResult('wasm', data, summary, { tool: 'tapsite_extract_wasm', description: 'Detect WebAssembly modules, source languages, capabilities' });
      }
    );
  }

  if (allowTool('tapsite_extract_markdown')) server.tool(
    'tapsite_extract_markdown',
    'Extract page content as clean Markdown. Modes: raw (full page), fit (noise filtered), citations (numbered refs). Optional BM25 query filtering and chunking.',
    {
      url: z.string().describe('URL to extract'),
      mode: z.enum(['raw', 'fit', 'citations']).default('fit').describe('Markdown mode'),
      query: z.string().optional().describe('BM25 query to filter content by relevance'),
      chunk: z.enum(['none', 'fixed', 'semantic', 'sentence']).default('none').describe('Chunking strategy'),
      chunkSize: z.number().default(750).describe('Chunk size in words (fixed/sentence modes)'),
    },
    async ({ url, mode, query, chunk, chunkSize }) => {
      const { generateMarkdown } = require('../markdown');
      const { bm25Filter } = require('../content-filter');
      const { chunkMarkdown } = require('../chunker');

      await browser.ensureBrowser();
      requireSafeUrl(url);
      await navigateIfNeeded(url);

      const html = await browser.page.content();
      let md = generateMarkdown(html, { mode });

      // Apply BM25 filter if query provided
      if (query) {
        const blocks = md.split(/\n\n+/);
        const filtered = bm25Filter(blocks, query);
        md = filtered.join('\n\n');
      }

      // Apply chunking
      let result;
      if (chunk && chunk !== 'none') {
        result = chunkMarkdown(md, { strategy: chunk, chunkSize });
      } else {
        result = md;
      }

      return summarizeResult('markdown', { url, mode, chunks: Array.isArray(result) ? result.length : 1 },
        typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    }
  );

};
