/**
 * Shared extraction functions for page.evaluate().
 * All functions run in browser context — no Node.js APIs.
 */

/**
 * Extract all unique colors from computed styles and CSS custom properties.
 * @param {{ limit: number }} args
 */
function extractColorsInBrowser({ limit }) {
  const colorMap = new Map(); // hex -> { hex, rgb, count, samples[] }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function parseColor(str) {
    if (!str || str === 'transparent' || str === 'rgba(0, 0, 0, 0)' || str === 'inherit' || str === 'initial') return null;
    const rgba = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgba) {
      const [, r, g, b] = rgba.map(Number);
      return { hex: rgbToHex(r, g, b), rgb: `rgb(${r}, ${g}, ${b})` };
    }
    return null;
  }

  function recordColor(parsed, sampleDesc) {
    if (!parsed) return;
    const entry = colorMap.get(parsed.hex) || { hex: parsed.hex, rgb: parsed.rgb, count: 0, samples: [] };
    entry.count++;
    if (entry.samples.length < 3 && sampleDesc) entry.samples.push(sampleDesc);
    colorMap.set(parsed.hex, entry);
  }

  const COLOR_PROPS = ['color', 'background-color', 'border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color'];

  // Scan visible elements
  const elements = document.querySelectorAll('body *');
  for (const el of elements) {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    const cs = getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    const desc = el.className ? `${tag}.${String(el.className).split(' ')[0]}` : tag;

    for (const prop of COLOR_PROPS) {
      recordColor(parseColor(cs.getPropertyValue(prop)), `${desc} (${prop})`);
    }

    // box-shadow colors
    const shadow = cs.getPropertyValue('box-shadow');
    if (shadow && shadow !== 'none') {
      const shadowColors = shadow.match(/rgba?\([^)]+\)/g) || [];
      for (const sc of shadowColors) {
        recordColor(parseColor(sc), `${desc} (box-shadow)`);
      }
    }
  }

  // SVG fill/stroke
  for (const svg of document.querySelectorAll('svg *')) {
    const cs = getComputedStyle(svg);
    recordColor(parseColor(cs.fill), 'svg (fill)');
    recordColor(parseColor(cs.stroke), 'svg (stroke)');
  }

  // CSS custom properties on :root
  const rootStyles = getComputedStyle(document.documentElement);
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.selectorText === ':root' || rule.selectorText === ':root, :host') {
          for (const prop of rule.style) {
            if (prop.startsWith('--')) {
              const val = rootStyles.getPropertyValue(prop).trim();
              const parsed = parseColor(val);
              if (parsed) {
                recordColor(parsed, `var(${prop})`);
              }
            }
          }
        }
      }
    } catch { /* cross-origin */ }
  }

  const sorted = [...colorMap.values()].sort((a, b) => b.count - a.count).slice(0, limit);
  const palette = sorted.slice(0, 15).map(c => c.hex);

  return { colors: sorted, palette, totalUnique: colorMap.size };
}

/**
 * Extract typography information: font families, sizes, weights, line-heights, and font sources.
 */
function extractFontsInBrowser() {
  const familyMap = new Map();
  const sizeMap = new Map();
  const weightMap = new Map();
  const lineHeightMap = new Map();

  const elements = document.querySelectorAll('body *');
  for (const el of elements) {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    if (!el.textContent.trim()) continue;
    const cs = getComputedStyle(el);

    // Font family
    const family = cs.fontFamily;
    if (family) {
      const clean = family.split(',')[0].trim().replace(/['"]/g, '');
      familyMap.set(clean, (familyMap.get(clean) || 0) + 1);
    }

    // Font size
    const size = cs.fontSize;
    if (size) sizeMap.set(size, (sizeMap.get(size) || 0) + 1);

    // Font weight
    const weight = cs.fontWeight;
    if (weight) weightMap.set(weight, (weightMap.get(weight) || 0) + 1);

    // Line height
    const lh = cs.lineHeight;
    if (lh && lh !== 'normal') lineHeightMap.set(lh, (lineHeightMap.get(lh) || 0) + 1);
  }

  // Detect font sources from link tags and @font-face
  const sources = [];
  for (const link of document.querySelectorAll('link[href]')) {
    const href = link.href;
    if (href.includes('fonts.googleapis.com')) {
      sources.push({ type: 'Google Fonts', url: href });
    } else if (href.includes('use.typekit.net') || href.includes('p.typekit.net')) {
      sources.push({ type: 'Adobe Fonts (Typekit)', url: href });
    } else if (href.match(/\.(woff2?|ttf|otf|eot)/)) {
      sources.push({ type: 'Self-hosted', url: href });
    }
  }

  // Check @font-face rules
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule instanceof CSSFontFaceRule) {
          const family = rule.style.getPropertyValue('font-family').replace(/['"]/g, '').trim();
          const src = rule.style.getPropertyValue('src');
          const urlMatch = src.match(/url\(["']?([^"')]+)["']?\)/);
          if (urlMatch) {
            sources.push({ type: 'Self-hosted (@font-face)', family, url: urlMatch[1] });
          }
        }
      }
    } catch { /* cross-origin */ }
  }

  const sortMap = (map) => [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count }));

  return {
    families: sortMap(familyMap),
    sizes: sortMap(sizeMap),
    weights: sortMap(weightMap),
    lineHeights: sortMap(lineHeightMap),
    sources,
  };
}

/**
 * Extract CSS custom properties from :root, body, and optionally all elements.
 * @param {{ includeAll: boolean }} args
 */
function extractCssVarsInBrowser({ includeAll }) {
  const variables = [];
  const seen = new Set();

  function categorize(name, value) {
    const n = name.toLowerCase();
    const v = value.toLowerCase();
    if (v.match(/^#|^rgb|^hsl/) || n.match(/color|bg|background|border-color|fill|stroke/)) return 'color';
    if (v.match(/^\d+(\.\d+)?(px|rem|em|%)$/) && n.match(/space|gap|margin|padding|indent|offset/)) return 'spacing';
    if (n.match(/font|text|letter|line-height|type/)) return 'typography';
    if (n.match(/radius|round/)) return 'border-radius';
    if (n.match(/shadow/)) return 'shadow';
    if (n.match(/z-index|z_index|layer/)) return 'z-index';
    if (n.match(/breakpoint|screen|media/)) return 'breakpoint';
    if (n.match(/transition|duration|delay|ease|animation/)) return 'animation';
    if (n.match(/opacity|alpha/)) return 'opacity';
    if (v.match(/^\d+(\.\d+)?(px|rem|em|%)$/)) return 'sizing';
    return 'other';
  }

  function extractFromElement(el, source) {
    const cs = getComputedStyle(el);
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.style) {
            for (const prop of rule.style) {
              if (prop.startsWith('--') && !seen.has(prop)) {
                seen.add(prop);
                const value = cs.getPropertyValue(prop).trim();
                if (value) {
                  variables.push({
                    name: prop,
                    value,
                    category: categorize(prop, value),
                    source,
                  });
                }
              }
            }
          }
        }
      } catch { /* cross-origin */ }
    }
  }

  extractFromElement(document.documentElement, ':root');
  extractFromElement(document.body, 'body');

  if (includeAll) {
    // Scan elements for inline custom properties (rare but possible)
    for (const el of document.querySelectorAll('[style]')) {
      const style = el.getAttribute('style') || '';
      const matches = style.match(/--[\w-]+/g);
      if (matches) {
        for (const prop of matches) {
          if (!seen.has(prop)) {
            seen.add(prop);
            const value = getComputedStyle(el).getPropertyValue(prop).trim();
            if (value) {
              variables.push({
                name: prop,
                value,
                category: categorize(prop, value),
                source: 'inline',
              });
            }
          }
        }
      }
    }
  }

  // Group by category for summary
  const summary = {};
  for (const v of variables) {
    summary[v.category] = (summary[v.category] || 0) + 1;
  }

  return { variables, summary, total: variables.length };
}

/**
 * Extract spacing values (margin, padding, gap, border-radius) from visible elements.
 * @param {{ sampleSize: number }} args
 */
function extractSpacingInBrowser({ sampleSize }) {
  const spacingMap = new Map(); // px value -> count
  const radiusMap = new Map();
  const gapMap = new Map();

  const SPACING_PROPS = [
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  ];

  const elements = document.querySelectorAll('body *');
  let count = 0;

  for (const el of elements) {
    if (count >= sampleSize) break;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    count++;

    const cs = getComputedStyle(el);

    for (const prop of SPACING_PROPS) {
      const val = cs.getPropertyValue(prop);
      if (val && val !== '0px') {
        spacingMap.set(val, (spacingMap.get(val) || 0) + 1);
      }
    }

    // Gap
    const gap = cs.getPropertyValue('gap');
    if (gap && gap !== 'normal' && gap !== '0px') {
      gapMap.set(gap, (gapMap.get(gap) || 0) + 1);
    }
    const rowGap = cs.getPropertyValue('row-gap');
    if (rowGap && rowGap !== 'normal' && rowGap !== '0px') {
      gapMap.set(rowGap, (gapMap.get(rowGap) || 0) + 1);
    }
    const colGap = cs.getPropertyValue('column-gap');
    if (colGap && colGap !== 'normal' && colGap !== '0px') {
      gapMap.set(colGap, (gapMap.get(colGap) || 0) + 1);
    }

    // Border radius
    const br = cs.getPropertyValue('border-radius');
    if (br && br !== '0px') {
      radiusMap.set(br, (radiusMap.get(br) || 0) + 1);
    }
  }

  const sortMap = (map) => [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count }));

  // Infer spacing base
  const spacingValues = sortMap(spacingMap);
  const pxValues = spacingValues
    .map(s => parseFloat(s.value))
    .filter(v => v > 0 && v <= 200);

  let inferredBase = null;
  for (const base of [4, 8, 6, 5, 10]) {
    const multiples = pxValues.filter(v => v % base === 0).length;
    if (multiples / pxValues.length > 0.6) {
      inferredBase = `${base}px`;
      break;
    }
  }

  return {
    spacing: spacingValues,
    gaps: sortMap(gapMap),
    borderRadii: sortMap(radiusMap),
    inferredBase,
    elementsSampled: count,
  };
}

/**
 * Extract all images from the page: <img>, CSS background-image, <picture> sources, OG/meta images.
 * @param {{ minWidth: number, filter: string }} args
 */
function extractImagesInBrowser({ minWidth, filter }) {
  const images = [];
  const seen = new Set();

  function addImage(src, meta) {
    if (!src || seen.has(src)) return;
    if (filter && !src.includes(filter)) return;
    seen.add(src);
    images.push({ src, ...meta });
  }

  // <img> elements
  for (const img of document.querySelectorAll('img[src]')) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w < minWidth) continue;
    addImage(img.src, {
      type: 'img',
      alt: img.alt || null,
      width: w,
      height: h,
      loading: img.loading || null,
    });
  }

  // <picture> <source> elements
  for (const source of document.querySelectorAll('picture source[srcset]')) {
    const srcset = source.getAttribute('srcset');
    const urls = srcset.split(',').map(s => s.trim().split(/\s+/)[0]);
    for (const url of urls) {
      addImage(url, { type: 'picture-source', media: source.media || null });
    }
  }

  // CSS background-image on visible elements
  const elements = document.querySelectorAll('body *');
  for (const el of elements) {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none') {
      const urls = bg.match(/url\(["']?([^"')]+)["']?\)/g) || [];
      for (const u of urls) {
        const match = u.match(/url\(["']?([^"')]+)["']?\)/);
        if (match) {
          const src = match[1];
          if (!src.startsWith('data:')) {
            const tag = el.tagName.toLowerCase();
            const desc = el.className ? `${tag}.${String(el.className).split(' ')[0]}` : tag;
            addImage(src, { type: 'background-image', element: desc });
          }
        }
      }
    }
  }

  // OG and meta images
  const metaSelectors = [
    { sel: 'meta[property="og:image"]', attr: 'content', type: 'og:image' },
    { sel: 'meta[name="twitter:image"]', attr: 'content', type: 'twitter:image' },
    { sel: 'meta[property="og:image:secure_url"]', attr: 'content', type: 'og:image:secure_url' },
    { sel: 'link[rel="image_src"]', attr: 'href', type: 'image_src' },
  ];
  for (const { sel, attr, type } of metaSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const val = el.getAttribute(attr);
      if (val) addImage(val, { type });
    }
  }

  return { images, total: images.length };
}

/**
 * Extract inline SVGs and external SVG references.
 * Classify as icon vs illustration by size. Detect currentColor usage.
 * @param {{ limit: number }} args
 */
function extractSvgsInBrowser({ limit }) {
  const svgs = [];

  // Inline SVGs
  const inlineSvgs = document.querySelectorAll('svg');
  for (const svg of inlineSvgs) {
    if (svgs.length >= limit) break;

    const rect = svg.getBoundingClientRect();
    const w = rect.width || parseInt(svg.getAttribute('width')) || 0;
    const h = rect.height || parseInt(svg.getAttribute('height')) || 0;
    const viewBox = svg.getAttribute('viewBox') || null;
    const markup = svg.outerHTML;
    const usesCurrentColor = markup.includes('currentColor');
    const classification = (w <= 48 && h <= 48) ? 'icon' : (w <= 200 && h <= 200) ? 'small' : 'illustration';

    // Minify: collapse whitespace
    const minified = markup.replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();

    svgs.push({
      type: 'inline',
      width: Math.round(w),
      height: Math.round(h),
      viewBox,
      classification,
      usesCurrentColor,
      markup: minified.length <= 5000 ? minified : minified.slice(0, 5000) + '…',
      markupLength: minified.length,
    });
  }

  // External SVG references (<img src="*.svg">, CSS url(*.svg), <use href="*.svg">)
  const externalSeen = new Set();

  for (const img of document.querySelectorAll('img[src$=".svg"], img[src*=".svg?"]')) {
    if (svgs.length >= limit) break;
    if (externalSeen.has(img.src)) continue;
    externalSeen.add(img.src);
    svgs.push({
      type: 'external',
      src: img.src,
      alt: img.alt || null,
      width: img.naturalWidth || img.width || null,
      height: img.naturalHeight || img.height || null,
    });
  }

  for (const use of document.querySelectorAll('use[href], use[xlink\\:href]')) {
    if (svgs.length >= limit) break;
    const href = use.getAttribute('href') || use.getAttribute('xlink:href');
    if (href && href.includes('.svg') && !externalSeen.has(href)) {
      externalSeen.add(href);
      svgs.push({ type: 'external-use', src: href });
    }
  }

  return { svgs, total: svgs.length };
}

/**
 * Extract favicon and icon references from the page.
 */
function extractFaviconInBrowser() {
  const icons = [];
  const seen = new Set();

  function addIcon(src, meta) {
    if (!src || seen.has(src)) return;
    seen.add(src);
    icons.push({ src, ...meta });
  }

  // link[rel] icon variants
  const iconRels = ['icon', 'shortcut icon', 'apple-touch-icon', 'apple-touch-icon-precomposed', 'mask-icon'];
  for (const link of document.querySelectorAll('link[rel][href]')) {
    const rel = link.getAttribute('rel').toLowerCase();
    if (iconRels.some(r => rel.includes(r))) {
      addIcon(link.href, {
        type: rel,
        sizes: link.getAttribute('sizes') || null,
        mimeType: link.getAttribute('type') || null,
      });
    }
  }

  // msapplication-TileImage
  const tileImg = document.querySelector('meta[name="msapplication-TileImage"]');
  if (tileImg) {
    addIcon(tileImg.getAttribute('content'), { type: 'msapplication-TileImage' });
  }

  // msapplication-config (browserconfig.xml)
  const browserConfig = document.querySelector('meta[name="msapplication-config"]');
  if (browserConfig) {
    addIcon(browserConfig.getAttribute('content'), { type: 'msapplication-config' });
  }

  // Web app manifest
  const manifestLink = document.querySelector('link[rel="manifest"]');
  const manifestUrl = manifestLink ? manifestLink.href : null;

  // Default /favicon.ico
  addIcon(new URL('/favicon.ico', document.location.origin).href, { type: 'default-favicon' });

  return { icons, manifestUrl, total: icons.length };
}

/**
 * Map layout structure: display type, direction, template, gap, alignment per container.
 * Returns a compressed layout tree.
 * @param {{ maxDepth: number }} args
 */
function extractLayoutInBrowser({ maxDepth }) {
  function getLayoutInfo(el, depth) {
    const cs = getComputedStyle(el);
    const display = cs.display;
    const position = cs.position;

    // Only include meaningful layout containers
    const isLayoutContainer = ['flex', 'grid', 'inline-flex', 'inline-grid'].includes(display) ||
      (display === 'block' && el.children.length > 1);

    if (!isLayoutContainer && depth > 0) return null;
    if (depth > 0 && el.offsetParent === null && position !== 'fixed' && position !== 'sticky') return null;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && depth > 0) return null;

    const tag = el.tagName.toLowerCase();
    const className = el.className ? String(el.className).trim().split(/\s+/).slice(0, 3).join(' ') : '';
    const id = el.id ? `#${el.id}` : '';
    const label = `${tag}${id}${className ? '.' + className.replace(/\s+/g, '.') : ''}`;

    const info = {
      el: label.slice(0, 60),
      display,
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    };

    if (display === 'flex' || display === 'inline-flex') {
      info.direction = cs.flexDirection;
      info.wrap = cs.flexWrap !== 'nowrap' ? cs.flexWrap : undefined;
      info.justify = cs.justifyContent !== 'normal' ? cs.justifyContent : undefined;
      info.align = cs.alignItems !== 'normal' ? cs.alignItems : undefined;
      if (cs.gap !== 'normal' && cs.gap !== '0px') info.gap = cs.gap;
    } else if (display === 'grid' || display === 'inline-grid') {
      info.columns = cs.gridTemplateColumns !== 'none' ? cs.gridTemplateColumns.slice(0, 80) : undefined;
      info.rows = cs.gridTemplateRows !== 'none' ? cs.gridTemplateRows.slice(0, 80) : undefined;
      if (cs.gap !== 'normal' && cs.gap !== '0px') info.gap = cs.gap;
    }

    if (position !== 'static') info.position = position;

    if (depth < maxDepth) {
      const children = [];
      for (const child of el.children) {
        if (children.length >= 8) { children.push('…'); break; }
        const childInfo = getLayoutInfo(child, depth + 1);
        if (childInfo) children.push(childInfo);
      }
      if (children.length > 0) info.children = children;
    }

    return info;
  }

  const tree = getLayoutInfo(document.body, 0);
  return { layout: tree };
}

/**
 * Detect repeated visual patterns — groups of elements with same class structure.
 * @param {{ minOccurrences: number }} args
 */
function extractComponentsInBrowser({ minOccurrences }) {
  // Generate a structural signature for an element
  function signature(el) {
    const tag = el.tagName.toLowerCase();
    const classes = [...el.classList].sort().join('.');
    const childSigs = [...el.children].slice(0, 5).map(c => {
      const t = c.tagName.toLowerCase();
      const cls = [...c.classList].sort().join('.');
      return `${t}${cls ? '.' + cls : ''}`;
    }).join('>');
    return `${tag}${classes ? '.' + classes : ''}[${childSigs}]`;
  }

  const sigMap = new Map(); // sig -> [el, ...]

  for (const el of document.querySelectorAll('body *')) {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    if (el.children.length === 0) continue; // leaf nodes only as children

    const sig = signature(el);
    if (!sigMap.has(sig)) sigMap.set(sig, []);
    sigMap.get(sig).push(el);
  }

  const components = [];
  for (const [sig, els] of sigMap.entries()) {
    if (els.length < minOccurrences) continue;

    const first = els[0];
    const rect = first.getBoundingClientRect();
    const sample = first.outerHTML;

    components.push({
      signature: sig.slice(0, 120),
      count: els.length,
      tag: first.tagName.toLowerCase(),
      classes: [...first.classList].join(' ') || null,
      sampleDimensions: { w: Math.round(rect.width), h: Math.round(rect.height) },
      sampleHtml: sample.length <= 500 ? sample : sample.slice(0, 500) + '…',
    });
  }

  // Sort by count descending
  components.sort((a, b) => b.count - a.count);

  return { components: components.slice(0, 40), total: components.length };
}

/**
 * Extract all CSS media query breakpoints from stylesheets.
 * Detect framework breakpoints (Tailwind, Bootstrap, MUI).
 * @param {{}} args
 */
function extractBreakpointsInBrowser() {
  const breakpoints = [];
  const seen = new Set();

  // Known framework breakpoint signatures
  const FRAMEWORK_PATTERNS = {
    tailwind: {
      sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536,
    },
    bootstrap: {
      sm: 576, md: 768, lg: 992, xl: 1200, xxl: 1400,
    },
    mui: {
      xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536,
    },
  };

  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule instanceof CSSMediaRule) {
          const mediaText = rule.conditionText || rule.media.mediaText;
          // Extract px values
          const matches = mediaText.matchAll(/(\d+(?:\.\d+)?)(px|em|rem)/g);
          for (const m of matches) {
            const raw = `${m[1]}${m[2]}`;
            if (!seen.has(raw)) {
              seen.add(raw);
              const px = m[2] === 'px' ? parseFloat(m[1]) :
                m[2] === 'em' || m[2] === 'rem' ? Math.round(parseFloat(m[1]) * 16) : null;
              breakpoints.push({
                value: raw,
                px,
                query: mediaText.slice(0, 120),
              });
            }
          }
        }
      }
    } catch { /* cross-origin */ }
  }

  // Sort by px value
  breakpoints.sort((a, b) => (a.px || 0) - (b.px || 0));

  // Detect framework
  const detectedPx = new Set(breakpoints.map(b => b.px));
  const detectedFrameworks = [];
  for (const [framework, bps] of Object.entries(FRAMEWORK_PATTERNS)) {
    const values = Object.values(bps).filter(v => v > 0);
    const matches = values.filter(v => detectedPx.has(v)).length;
    if (matches >= Math.ceil(values.length * 0.6)) {
      detectedFrameworks.push(framework);
    }
  }

  // Current viewport
  const viewport = { width: window.innerWidth, height: window.innerHeight };

  return { breakpoints, detectedFrameworks, viewport, total: breakpoints.length };
}

/**
 * Detect technology stack: JS frameworks, CSS frameworks, build tools, analytics, CMS.
 * Uses global variables, DOM attributes, class names, script URLs, and meta tags.
 */
function detectStackInBrowser() {
  const stack = {};

  // --- JS Frameworks ---
  const frameworks = [];

  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || window.React || document.querySelector('[data-reactroot], [data-reactid]')) {
    const entry = { name: 'React' };
    if (window.React && window.React.version) entry.version = window.React.version;
    frameworks.push(entry);
  }

  const nextDataEl = document.getElementById('__NEXT_DATA__');
  if (window.__NEXT_DATA__ || nextDataEl) {
    const entry = { name: 'Next.js' };
    try {
      const d = JSON.parse(nextDataEl ? nextDataEl.textContent : '{}');
      if (d.buildId) entry.buildId = d.buildId;
    } catch {}
    frameworks.push(entry);
  }

  if (window.Vue || window.__VUE__ || document.querySelector('[data-v-]')) {
    const entry = { name: 'Vue.js' };
    if (window.Vue && window.Vue.version) entry.version = window.Vue.version;
    frameworks.push(entry);
  }

  if (window.__NUXT__ || window.$nuxt) {
    frameworks.push({ name: 'Nuxt.js' });
  }

  const ngEl = document.querySelector('[ng-version]');
  if (ngEl || window.angular || (window.ng && window.ng.version)) {
    const entry = { name: 'Angular' };
    if (ngEl) entry.version = ngEl.getAttribute('ng-version');
    frameworks.push(entry);
  }

  if (window.__svelte || document.querySelector('[class*="svelte-"]')) {
    frameworks.push({ name: 'Svelte' });
  }

  if (window.Ember) {
    const entry = { name: 'Ember.js' };
    if (window.Ember.VERSION) entry.version = window.Ember.VERSION;
    frameworks.push(entry);
  }

  const jqVersion = (window.jQuery && window.jQuery.fn && window.jQuery.fn.jquery) ||
                    (window.$ && window.$.fn && window.$.fn.jquery);
  if (jqVersion) {
    frameworks.push({ name: 'jQuery', version: jqVersion });
  }

  if (frameworks.length) stack.frameworks = frameworks;

  // --- CSS Frameworks (class-based detection) ---
  const allClasses = new Set();
  for (const el of document.querySelectorAll('[class]')) {
    if (typeof el.className === 'string') {
      for (const c of el.className.split(/\s+/)) if (c) allClasses.add(c);
    }
  }

  const cssFrameworks = [];

  const twPattern = /^(text-[a-z]|bg-[a-z]|p-\d|px-\d|py-\d|pt-\d|pb-\d|m-\d|mx-\d|my-\d|mt-\d|mb-\d|w-\d|h-\d|flex$|grid$|items-|justify-|rounded|border-?[a-z]|shadow|gap-\d|space-[xy]|font-[a-z]|opacity-)/;
  const twMatches = [...allClasses].filter(c => twPattern.test(c)).length;
  if (twMatches >= 10) cssFrameworks.push({ name: 'Tailwind CSS' });

  const bsPrefixes = ['container', 'row', 'col', 'btn', 'navbar', 'card', 'modal', 'badge', 'alert', 'd-flex', 'd-grid'];
  const bsMatches = bsPrefixes.filter(p => allClasses.has(p) || [...allClasses].some(c => c === p || c.startsWith(p + '-'))).length;
  if (bsMatches >= 3) cssFrameworks.push({ name: 'Bootstrap' });

  if ([...allClasses].some(c => c.startsWith('Mui') || c.startsWith('css-') && document.querySelector('[class*="Mui"]'))) {
    cssFrameworks.push({ name: 'Material UI (MUI)' });
  }

  if ([...allClasses].some(c => c.startsWith('chakra-') || c.startsWith('css-') && window.chakra)) {
    cssFrameworks.push({ name: 'Chakra UI' });
  }

  if (cssFrameworks.length) stack.cssFrameworks = cssFrameworks;

  // --- Build Tools ---
  const scriptSrcs = [...document.scripts].map(s => s.src).filter(Boolean);
  const buildTools = [];

  if (window.__webpack_require__ || window.webpackJsonp || scriptSrcs.some(s => /[./]chunk\.[a-f0-9]+\.js/.test(s))) {
    buildTools.push({ name: 'Webpack' });
  }
  if (scriptSrcs.some(s => s.includes('/@vite/') || s.includes('?v=') && s.includes('@vite'))) {
    buildTools.push({ name: 'Vite' });
  }
  if (scriptSrcs.some(s => s.includes('/_next/static/'))) {
    // Already noted via Next.js framework
  }
  if (document.querySelector('script[type="module"]') && !buildTools.length) {
    buildTools.push({ name: 'ES Modules (bundler unknown)' });
  }

  if (buildTools.length) stack.buildTools = buildTools;

  // --- Analytics & Tracking ---
  const analytics = [];
  if (window.ga || window.gtag || window.dataLayer) analytics.push('Google Analytics / GTM');
  if (window.fbq || window._fbq) analytics.push('Facebook Pixel');
  if (window.mixpanel) analytics.push('Mixpanel');
  if (window.amplitude) analytics.push('Amplitude');
  if (window.posthog) analytics.push('PostHog');
  if (window.heap) analytics.push('Heap');
  if (window.Intercom) analytics.push('Intercom');
  if (window.analytics && window.analytics.identify) analytics.push('Segment');
  if (window.rudderanalytics) analytics.push('RudderStack');
  if (window.hj) analytics.push('Hotjar');
  if (window.Clarity) analytics.push('Microsoft Clarity');

  if (analytics.length) stack.analytics = analytics;

  // --- CMS / Platform ---
  const cms = [];
  const generatorMeta = document.querySelector('meta[name="generator"]');
  if (generatorMeta) {
    const gen = generatorMeta.content || '';
    const g = gen.toLowerCase();
    if (g.includes('wordpress')) cms.push({ name: 'WordPress', detail: gen });
    else if (g.includes('drupal')) cms.push({ name: 'Drupal', detail: gen });
    else if (g.includes('joomla')) cms.push({ name: 'Joomla', detail: gen });
    else if (g.includes('shopify')) cms.push({ name: 'Shopify', detail: gen });
    else if (g.includes('squarespace')) cms.push({ name: 'Squarespace' });
    else if (g.includes('wix')) cms.push({ name: 'Wix' });
    else if (gen) cms.push({ name: 'CMS', generator: gen });
  }
  if (window.Shopify && !cms.some(c => c.name === 'Shopify')) cms.push({ name: 'Shopify' });
  if (window.wp && !cms.some(c => c.name === 'WordPress')) cms.push({ name: 'WordPress' });

  if (cms.length) stack.cms = cms;

  // --- External Script Domains (CDN / third-party) ---
  const extDomains = [...new Set(
    scriptSrcs
      .map(s => { try { return new URL(s).hostname; } catch { return null; } })
      .filter(h => h && h !== window.location.hostname)
  )].slice(0, 20);
  if (extDomains.length) stack.externalScriptDomains = extDomains;

  // --- Page Meta ---
  const meta = { title: document.title };
  const descEl = document.querySelector('meta[name="description"]');
  if (descEl) meta.description = descEl.content;
  const viewportEl = document.querySelector('meta[name="viewport"]');
  if (viewportEl) meta.viewport = viewportEl.content;
  const robotsEl = document.querySelector('meta[name="robots"]');
  if (robotsEl) meta.robots = robotsEl.content;
  stack.meta = meta;

  return stack;
}

module.exports = {
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
  detectStackInBrowser,
};
