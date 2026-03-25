/**
 * Shared extraction functions for page.evaluate().
 * All functions run in browser context — no Node.js APIs.
 */

/**
 * Hidden element detection helper — must be inlined in each browser-context
 * function that needs it (page.evaluate serializes functions, losing outer scope).
 * This is the canonical implementation; paste it inside extractors that filter hidden content.
 *
 * function isHiddenElement(el) { ... }
 */
const HIDDEN_ELEMENT_CHECK = `
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
`.trim();

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

// --- Phase 5: Content Extraction ---

/**
 * Extract all page metadata: meta tags, OpenGraph, Twitter Cards, JSON-LD,
 * RSS/Atom feeds, canonical URL, manifest, theme-color.
 */
function extractMetadataInBrowser() {
  const result = {};

  // Standard meta tags
  const meta = {};
  for (const el of document.querySelectorAll('meta[name]')) {
    const name = el.getAttribute('name');
    const content = el.getAttribute('content');
    if (name && content) meta[name] = content;
  }
  if (Object.keys(meta).length) result.meta = meta;

  // OpenGraph
  const og = {};
  for (const el of document.querySelectorAll('meta[property^="og:"]')) {
    const key = el.getAttribute('property').replace('og:', '');
    og[key] = el.getAttribute('content');
  }
  if (Object.keys(og).length) result.openGraph = og;

  // Twitter Cards
  const twitter = {};
  for (const el of document.querySelectorAll('meta[name^="twitter:"]')) {
    const key = el.getAttribute('name').replace('twitter:', '');
    twitter[key] = el.getAttribute('content');
  }
  if (Object.keys(twitter).length) result.twitterCard = twitter;

  // JSON-LD / schema.org
  const jsonLd = [];
  for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { jsonLd.push(JSON.parse(el.textContent)); } catch {}
  }
  if (jsonLd.length) result.jsonLd = jsonLd;

  // Feeds (RSS / Atom)
  const feeds = [];
  for (const el of document.querySelectorAll('link[rel="alternate"]')) {
    const type = el.getAttribute('type') || '';
    if (type.includes('rss') || type.includes('atom')) {
      feeds.push({ type, title: el.getAttribute('title') || '', href: el.getAttribute('href') || '' });
    }
  }
  if (feeds.length) result.feeds = feeds;

  // Canonical URL
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) result.canonical = canonical.getAttribute('href');

  // Manifest
  const manifest = document.querySelector('link[rel="manifest"]');
  if (manifest) result.manifest = manifest.getAttribute('href');

  // Title
  result.title = document.title || '';

  // Lang
  if (document.documentElement.lang) result.lang = document.documentElement.lang;

  return result;
}

/**
 * Extract main page content as clean markdown. Detects article containers,
 * strips chrome (nav/header/footer/sidebar/ads), preserves heading hierarchy,
 * lists, links, inline formatting, and optionally images.
 * @param {{ selector?: string, includeImages?: boolean }} args
 */
function extractContentInBrowser({ selector, includeImages }) {
  // Hidden element filter — prevents extraction of invisible prompt injection text
  function isHiddenElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return true;
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
    if (parseFloat(cs.opacity) === 0) return true;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && cs.overflow === 'hidden') return true;
    if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(100%)') return true;
    return false;
  }

  // Find content root
  let root;
  if (selector) {
    try { root = document.querySelector(selector); } catch { return { content: '', error: 'Invalid CSS selector' }; }
  } else {
    root = document.querySelector('article') ||
           document.querySelector('main') ||
           document.querySelector('[role="main"]') ||
           document.querySelector('.post-content, .article-body, .entry-content, .content-body, #content, .content') ||
           document.body;
  }
  if (!root) root = document.body;

  // Tags to skip entirely
  const SKIP_TAGS = new Set(['nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript', 'iframe', 'form', 'button']);
  // Classes/ids that suggest chrome (nav, ads, sidebar)
  const SKIP_PATTERN = /\b(nav|navigation|sidebar|widget|banner|ad|ads|advertisement|promo|cookie|popup|modal|overlay|comment|share|social|related|recommended|newsletter|subscribe|follow|breadcrumb|pagination|pager|menu|toolbar|topbar|bottombar|footer|header|navbox|navmenu|side-bar|related-posts|related-articles|post-list|card-list|link-list|further-reading|see-also|toc-sidebar|in-article-cards)\b/i;

  function shouldSkip(el) {
    if (SKIP_TAGS.has(el.tagName.toLowerCase())) return true;
    const cls = el.className && typeof el.className === 'string' ? el.className : '';
    const id = el.id || '';
    if (SKIP_PATTERN.test(cls) || SKIP_PATTERN.test(id)) return true;
    // Skip hidden elements — prevents extraction of invisible prompt injection text
    if (isHiddenElement(el)) return true;
    return false;
  }

  function nodeToMd(node, depth) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent.replace(/\s+/g, ' ');
      return t === ' ' ? '' : t;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (shouldSkip(node)) return '';

    const tag = node.tagName.toLowerCase();
    const children = () => [...node.childNodes].map(c => nodeToMd(c, depth + 1)).join('');

    if (tag === 'h1') return `\n\n# ${children().trim()}\n\n`;
    if (tag === 'h2') return `\n\n## ${children().trim()}\n\n`;
    if (tag === 'h3') return `\n\n### ${children().trim()}\n\n`;
    if (tag === 'h4') return `\n\n#### ${children().trim()}\n\n`;
    if (tag === 'h5') return `\n\n##### ${children().trim()}\n\n`;
    if (tag === 'h6') return `\n\n###### ${children().trim()}\n\n`;
    if (tag === 'p') return `\n\n${children().trim()}\n\n`;
    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n\n---\n\n';
    if (tag === 'strong' || tag === 'b') return `**${children()}**`;
    if (tag === 'em' || tag === 'i') return `_${children()}_`;
    if (tag === 'code') return `\`${children()}\``;
    if (tag === 'pre') return `\n\n\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n`;
    if (tag === 'blockquote') return `\n\n> ${children().trim().replace(/\n/g, '\n> ')}\n\n`;
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      const text = children().trim();
      if (!text) return '';
      return href ? `[${text}](${href})` : text;
    }
    if (tag === 'img' && includeImages) {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '';
      return src ? `\n\n![${alt}](${src})\n\n` : '';
    }
    if (tag === 'ul') {
      return '\n\n' + [...node.children].map(li => `- ${nodeToMd(li, depth + 1).trim()}`).join('\n') + '\n\n';
    }
    if (tag === 'ol') {
      return '\n\n' + [...node.children].map((li, i) => `${i + 1}. ${nodeToMd(li, depth + 1).trim()}`).join('\n') + '\n\n';
    }
    if (tag === 'li') return children();
    if (tag === 'table') {
      // Simple table: first row = header
      const rows = [...node.querySelectorAll('tr')];
      if (!rows.length) return '';
      const lines = rows.map((row, i) => {
        const cells = [...row.querySelectorAll('th, td')].map(c => c.textContent.trim().replace(/\|/g, '\\|'));
        const line = '| ' + cells.join(' | ') + ' |';
        if (i === 0) return line + '\n|' + cells.map(() => '---|').join('');
        return line;
      });
      return '\n\n' + lines.join('\n') + '\n\n';
    }
    return children();
  }

  const raw = nodeToMd(root, 0);
  // Collapse 3+ blank lines to 2
  const md = raw.replace(/\n{3,}/g, '\n\n').trim();
  return { content: md };
}

/**
 * Detailed form analysis: fields, validation rules, action, method, fieldsets,
 * select options, hidden fields, CSRF tokens.
 */
function extractFormsInBrowser() {
  // Hidden element filter — flags hidden forms (may contain injection payloads)
  function isHiddenElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return true;
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
    if (parseFloat(cs.opacity) === 0) return true;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && cs.overflow === 'hidden') return true;
    if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(100%)') return true;
    return false;
  }

  const CSRF_NAMES = /csrf|_token|authenticity_token|__requestverificationtoken|nonce/i;

  function getLabel(field) {
    // Explicit label
    if (field.id) {
      const lbl = document.querySelector(`label[for="${field.id}"]`);
      if (lbl) return lbl.textContent.trim();
    }
    // Wrapping label
    const parent = field.closest('label');
    if (parent) return parent.textContent.trim().replace(field.value || '', '').trim();
    // aria-label
    return field.getAttribute('aria-label') || field.getAttribute('aria-labelledby') || '';
  }

  function fieldInfo(el) {
    const tag = el.tagName.toLowerCase();
    const info = {
      tag,
      type: el.type || tag,
      name: el.name || undefined,
      id: el.id || undefined,
      label: getLabel(el) || undefined,
      placeholder: el.placeholder || undefined,
      required: el.required || undefined,
      disabled: el.disabled || undefined,
    };
    // Validation attrs
    if (el.pattern) info.pattern = el.pattern;
    if (el.minLength > 0) info.minLength = el.minLength;
    if (el.maxLength > 0 && el.maxLength < 524288) info.maxLength = el.maxLength;
    if (el.min !== '') info.min = el.min;
    if (el.max !== '') info.max = el.max;
    // Hidden fields: flag presence but don't expose values (may contain tokens/secrets)
    if (el.type === 'hidden') {
      info.hidden = true;
      if (CSRF_NAMES.test(el.name || '')) info.csrf = true;
    }
    // Checkboxes/radio
    if (el.type === 'checkbox' || el.type === 'radio') info.checked = el.checked;
    // Select options
    if (tag === 'select') {
      info.options = [...el.options].slice(0, 20).map(o => ({ value: o.value, label: o.text.trim(), selected: o.selected || undefined }));
      if (el.multiple) info.multiple = true;
    }
    // Clean up undefineds
    Object.keys(info).forEach(k => info[k] === undefined && delete info[k]);
    return info;
  }

  const forms = [...document.querySelectorAll('form')].map(form => {
    const result = {
      id: form.id || undefined,
      name: form.name || undefined,
      action: form.action || undefined,
      method: (form.method || 'get').toUpperCase(),
      enctype: form.enctype !== 'application/x-www-form-urlencoded' ? form.enctype : undefined,
      hidden: isHiddenElement(form) || undefined,
    };

    // Fieldsets
    const fieldsets = [...form.querySelectorAll('fieldset')].map(fs => ({
      legend: fs.querySelector('legend')?.textContent.trim() || undefined,
      fields: [...fs.querySelectorAll('input, select, textarea')].map(fieldInfo),
    }));
    if (fieldsets.length) result.fieldsets = fieldsets;

    // All fields (flat, for forms without fieldsets or in addition)
    const allFields = [...form.querySelectorAll('input, select, textarea')].map(fieldInfo);
    result.fields = allFields;

    // Summarize CSRF tokens
    const csrfFields = allFields.filter(f => f.csrf);
    if (csrfFields.length) result.csrfTokens = csrfFields.map(f => f.name);

    // Clean up undefineds
    Object.keys(result).forEach(k => result[k] === undefined && delete result[k]);
    return result;
  });

  return { forms };
}

// --- Phase 7: Advanced ---

/**
 * Extract CSS @keyframes, transition properties, and animation assignments.
 * Detect JS and CSS animation libraries.
 */
function extractAnimationsInBrowser() {
  const keyframes = [];
  const transitions = [];
  const animatedElements = [];
  const seen = new Set();

  // Parse @keyframes and transitions from stylesheets
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule instanceof CSSKeyframesRule) {
          keyframes.push({
            name: rule.name,
            steps: [...rule.cssRules].map(step => ({
              selector: step.keyText,
              properties: [...step.style].reduce((acc, p) => {
                acc[p] = step.style.getPropertyValue(p);
                return acc;
              }, {}),
            })),
          });
        }
      }
    } catch { /* cross-origin */ }
  }

  // Scan elements for computed animation and transition values
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const anim = cs.animationName;
    const animDuration = cs.animationDuration;
    const trans = cs.transition;
    const tag = el.tagName.toLowerCase();
    const cls = el.className ? String(el.className).split(' ')[0] : null;
    const label = cls ? `${tag}.${cls}` : tag;

    if (anim && anim !== 'none') {
      const sig = `anim:${anim}:${animDuration}`;
      if (!seen.has(sig)) {
        seen.add(sig);
        animatedElements.push({
          element: label,
          name: anim,
          duration: animDuration,
          timing: cs.animationTimingFunction,
          delay: cs.animationDelay,
          iterationCount: cs.animationIterationCount,
          fillMode: cs.animationFillMode,
        });
      }
    }

    if (trans && trans !== 'none' && trans !== 'all 0s ease 0s') {
      const sig = `trans:${trans}:${tag}`;
      if (!seen.has(sig)) {
        seen.add(sig);
        transitions.push({ element: label, transition: trans });
      }
    }

    if (animatedElements.length + transitions.length >= 100) break;
  }

  // Detect JS animation libraries via globals
  const jsLibraries = [];
  if (window.gsap || window.TweenMax || window.TweenLite) {
    const entry = { name: 'GSAP' };
    if (window.gsap && window.gsap.version) entry.version = window.gsap.version;
    jsLibraries.push(entry);
  }
  if (window.__framer_importFromPackage__ || (window.FramerMotion)) jsLibraries.push({ name: 'Framer Motion' });
  if (window.anime) {
    const entry = { name: 'anime.js' };
    if (window.anime.version) entry.version = window.anime.version;
    jsLibraries.push(entry);
  }
  if (window.Velocity) jsLibraries.push({ name: 'Velocity.js' });
  if (window.lottie || window.bodymovin) jsLibraries.push({ name: 'Lottie' });
  if (window.ScrollMagic) jsLibraries.push({ name: 'ScrollMagic' });
  if (window.AOS) jsLibraries.push({ name: 'AOS' });
  if (window.WOW) jsLibraries.push({ name: 'WOW.js' });
  if (window.Popmotion) jsLibraries.push({ name: 'Popmotion' });

  // Detect CSS animation libraries via attributes/classes
  const cssLibraries = [];
  if (document.querySelector('[class*="animate__"]')) cssLibraries.push('Animate.css');
  if (document.querySelector('[data-aos]')) cssLibraries.push('AOS');
  if (document.querySelector('[data-wow]') || document.querySelector('.wow')) cssLibraries.push('WOW.js');

  return {
    keyframes: keyframes.slice(0, 50),
    totalKeyframes: keyframes.length,
    animatedElements: animatedElements.slice(0, 30),
    transitions: transitions.slice(0, 30),
    totalTransitions: transitions.length,
    jsLibraries,
    cssLibraries,
  };
}

/**
 * Accessibility audit: missing alt text, form labels, button names, heading hierarchy,
 * landmark roles, color contrast, tab order, lang attribute, page title.
 * @param {{ standard: string }} args — "aa" or "aaa"
 */
function extractA11yInBrowser({ standard = 'aa' }) {
  // Hidden element filter — prevents hidden text from appearing in heading structure
  function isHiddenElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return true;
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
    if (parseFloat(cs.opacity) === 0) return true;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && cs.overflow === 'hidden') return true;
    if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(100%)') return true;
    return false;
  }

  const issues = [];
  let score = 100;

  function addIssue(severity, category, message, snippet) {
    issues.push({ severity, category, message, snippet: snippet ? snippet.slice(0, 200) : undefined });
    if (severity === 'error') score -= 10;
    else if (severity === 'warning') score -= 3;
  }

  // 1. Images without alt
  for (const img of document.querySelectorAll('img')) {
    if (!img.hasAttribute('alt')) {
      const src = (img.getAttribute('src') || '').split('/').pop().slice(0, 50);
      addIssue('error', 'alt-text', `Image missing alt attribute: ${src}`, img.outerHTML);
    }
  }

  // 2. Form fields without labels
  const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (el.tagName === 'INPUT' && SKIP_INPUT_TYPES.has(el.type)) continue;
    const hasLabel = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const hasAria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
    const hasTitle = el.title;
    const wrapped = el.closest('label');
    if (!hasLabel && !hasAria && !hasTitle && !wrapped) {
      addIssue('error', 'form-label', `Form field missing label: <${el.tagName.toLowerCase()} type="${el.type || ''}" name="${el.name || ''}">`, el.outerHTML);
    }
  }

  // 3. Buttons without accessible name
  for (const btn of document.querySelectorAll('button, [role="button"]')) {
    const text = btn.textContent.trim();
    const ariaLabel = btn.getAttribute('aria-label') || btn.getAttribute('aria-labelledby');
    const title = btn.title;
    const hasImg = btn.querySelector('img[alt]');
    if (!text && !ariaLabel && !title && !hasImg) {
      addIssue('error', 'button-name', 'Button has no accessible name', btn.outerHTML);
    }
  }

  // 4. Links without accessible name
  for (const a of document.querySelectorAll('a[href]')) {
    const text = a.textContent.trim();
    const ariaLabel = a.getAttribute('aria-label') || a.getAttribute('aria-labelledby');
    const hasAltImg = a.querySelector('img[alt]');
    if (!text && !ariaLabel && !hasAltImg) {
      addIssue('warning', 'link-name', 'Link has no accessible name', a.outerHTML);
    }
  }

  // 5. Heading hierarchy
  const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')];
  const h1s = headings.filter(h => h.tagName === 'H1');
  if (h1s.length === 0) {
    addIssue('error', 'heading-hierarchy', 'Page has no H1 heading', null);
  } else if (h1s.length > 1) {
    addIssue('warning', 'heading-hierarchy', `Page has ${h1s.length} H1 headings (should have exactly 1)`, null);
  }
  let prevLevel = 0;
  for (const h of headings) {
    const level = parseInt(h.tagName[1]);
    if (prevLevel && level > prevLevel + 1) {
      addIssue('warning', 'heading-hierarchy', `Heading level skipped: H${prevLevel} → H${level} ("${h.textContent.trim().slice(0, 60)}")`, null);
    }
    prevLevel = level;
  }

  // 6. Landmarks
  const hasMain = !!document.querySelector('main, [role="main"]');
  const hasNav = !!document.querySelector('nav, [role="navigation"]');
  const hasHeader = !!document.querySelector('header, [role="banner"]');
  const hasFooter = !!document.querySelector('footer, [role="contentinfo"]');
  if (!hasMain) addIssue('warning', 'landmarks', 'Page missing <main> landmark', null);
  if (!hasNav) addIssue('warning', 'landmarks', 'Page missing <nav> landmark', null);

  // 7. Color contrast (WCAG AA/AAA)
  function getLuminance(r, g, b) {
    return [r, g, b].reduce((acc, c, i) => {
      const s = c / 255;
      const lin = s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      return acc + lin * [0.2126, 0.7152, 0.0722][i];
    }, 0);
  }
  function parseRgb(str) {
    const m = str && str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
  }
  function contrastRatio(fg, bg) {
    const l1 = getLuminance(fg.r, fg.g, fg.b);
    const l2 = getLuminance(bg.r, bg.g, bg.b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  const contrastIssues = [];
  const checkedContrast = new Set();
  let contrastChecked = 0;

  for (const el of document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, a, span, li, td, th, button, label')) {
    if (!el.textContent.trim() || contrastChecked >= 200) break;
    const cs = getComputedStyle(el);
    const fg = parseRgb(cs.color);
    const bg = parseRgb(cs.backgroundColor);
    if (!fg || !bg) continue;
    if (cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent') continue;

    const key = `${cs.color}|${cs.backgroundColor}`;
    if (checkedContrast.has(key)) continue;
    checkedContrast.add(key);
    contrastChecked++;

    const ratio = contrastRatio(fg, bg);
    const fontSize = parseFloat(cs.fontSize);
    const isBold = parseInt(cs.fontWeight) >= 700;
    const isLargeText = fontSize >= 18 || (fontSize >= 14 && isBold);
    const threshold = standard === 'aaa' ? (isLargeText ? 4.5 : 7) : (isLargeText ? 3 : 4.5);

    if (ratio < threshold) {
      const tag = el.tagName.toLowerCase();
      const cls = el.className ? String(el.className).split(' ')[0] : null;
      const entry = {
        element: cls ? `${tag}.${cls}` : tag,
        color: cs.color,
        background: cs.backgroundColor,
        ratio: Math.round(ratio * 100) / 100,
        required: threshold,
        isLargeText,
      };
      contrastIssues.push(entry);
      if (contrastIssues.length <= 5) {
        addIssue('error', 'color-contrast', `Contrast ratio ${entry.ratio}:1 (required ${threshold}:1) on ${entry.element}`, null);
      }
    }
  }

  // 8. Positive tabindex (anti-pattern)
  const positiveTabindex = [...document.querySelectorAll('[tabindex]')]
    .filter(el => parseInt(el.getAttribute('tabindex')) > 0)
    .map(el => ({
      element: el.tagName.toLowerCase(),
      tabindex: el.getAttribute('tabindex'),
      text: el.textContent.trim().slice(0, 40),
    }));
  if (positiveTabindex.length > 0) {
    addIssue('warning', 'tab-order', `${positiveTabindex.length} element(s) use tabindex > 0 (disrupts natural tab order)`, null);
  }

  // 9. Lang attribute
  const lang = document.documentElement.getAttribute('lang');
  if (!lang) addIssue('warning', 'language', 'Page missing lang attribute on <html>', null);

  // 10. Page title
  if (!document.title || !document.title.trim()) {
    addIssue('error', 'page-title', 'Page missing <title>', null);
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    standard: standard.toUpperCase(),
    summary: {
      errors: issues.filter(i => i.severity === 'error').length,
      warnings: issues.filter(i => i.severity === 'warning').length,
    },
    issues: issues.slice(0, 50),
    contrastIssues: contrastIssues.slice(0, 20),
    landmarks: { hasMain, hasNav, hasHeader, hasFooter },
    headingStructure: headings.filter(h => !isHiddenElement(h)).map(h => ({ level: h.tagName.toLowerCase(), text: h.textContent.trim().slice(0, 80) })),
    tabOrderIssues: positiveTabindex,
    lang: lang || null,
  };
}

/**
 * Detect dark mode support: prefers-color-scheme media queries, class-toggle patterns.
 * Captures the current (light) color palette for comparison with dark palette.
 */
function detectDarkmodeInBrowser() {
  const detection = [];
  const darkmodeClasses = [];
  let hasDarkmodeMedia = false;

  // Scan stylesheets for prefers-color-scheme and dark class rules
  const darkClassPatterns = ['dark', 'theme-dark', 'dark-mode', 'darkmode', 'dark-theme'];
  const foundClasses = new Set();

  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule instanceof CSSMediaRule) {
          const media = rule.conditionText || rule.media.mediaText;
          if (media.includes('prefers-color-scheme')) {
            if (!hasDarkmodeMedia) {
              hasDarkmodeMedia = true;
              detection.push({ method: 'prefers-color-scheme', query: media.slice(0, 200) });
            }
          }
        }
        if (rule.selectorText) {
          for (const cls of darkClassPatterns) {
            if (!foundClasses.has(cls) && (
              rule.selectorText.includes(`.${cls}`) ||
              rule.selectorText.includes(`[data-theme="dark"]`) ||
              rule.selectorText.includes(`[data-color-scheme="dark"]`)
            )) {
              foundClasses.add(cls);
              darkmodeClasses.push(cls);
              detection.push({ method: 'class-toggle', class: cls });
            }
          }
        }
      }
    } catch { /* cross-origin */ }
  }

  // Check current theme attribute
  const htmlTheme = document.documentElement.getAttribute('data-theme') ||
    document.documentElement.getAttribute('data-color-scheme');

  // Capture current color palette (top 8 by frequency)
  function getTopColors() {
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
  }

  return {
    supported: hasDarkmodeMedia || darkmodeClasses.length > 0,
    hasDarkmodeMedia,
    darkmodeClasses,
    currentTheme: htmlTheme || null,
    detection,
    lightPalette: getTopColors(),
  };
}

/**
 * Performance metrics: navigation timing, Core Web Vitals (LCP, CLS),
 * resource waterfall summary by type, JS heap, DOM node count.
 */
function extractPerfInBrowser() {
  const result = {};

  // Navigation timing
  const navEntries = performance.getEntriesByType('navigation');
  if (navEntries.length > 0) {
    const nav = navEntries[0];
    result.timing = {
      ttfbMs: Math.round(nav.responseStart - nav.requestStart),
      domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
      loadMs: Math.round(nav.loadEventEnd),
    };
  }

  // DOM stats
  result.dom = {
    nodeCount: document.querySelectorAll('*').length,
    domSizeKB: Math.round(document.documentElement.innerHTML.length / 1024),
  };

  // JS heap (Chrome only)
  if (performance.memory) {
    result.memory = {
      usedMB: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024 * 10) / 10,
      totalMB: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024 * 10) / 10,
      limitMB: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024),
    };
  }

  // LCP
  const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
  if (lcpEntries.length > 0) {
    const lcp = lcpEntries[lcpEntries.length - 1];
    result.lcp = {
      startTimeMs: Math.round(lcp.startTime),
      size: lcp.size || null,
      element: lcp.element ? lcp.element.tagName.toLowerCase() : null,
      url: lcp.url || null,
    };
  }

  // CLS
  const clsEntries = performance.getEntriesByType('layout-shift');
  if (clsEntries.length > 0) {
    result.cls = Math.round(clsEntries.reduce((sum, e) => sum + e.value, 0) * 1000) / 1000;
  }

  // Resource summary by type
  const resources = performance.getEntriesByType('resource');
  const byType = {};
  for (const r of resources) {
    const t = r.initiatorType || 'other';
    if (!byType[t]) byType[t] = { count: 0, transferKB: 0, totalDurationMs: 0 };
    byType[t].count++;
    byType[t].transferKB += (r.transferSize || 0) / 1024;
    byType[t].totalDurationMs += r.duration;
  }
  for (const t of Object.values(byType)) {
    t.transferKB = Math.round(t.transferKB * 10) / 10;
    t.totalDurationMs = Math.round(t.totalDurationMs);
  }
  result.resources = { total: resources.length, byType };

  // Top 10 slowest resources
  result.slowestResources = [...resources]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 10)
    .map(r => ({
      url: r.name.length > 100 ? r.name.slice(0, 100) + '…' : r.name,
      type: r.initiatorType,
      durationMs: Math.round(r.duration),
      transferKB: Math.round((r.transferSize || 0) / 1024 * 10) / 10,
    }));

  return result;
}

/**
 * Extract box-shadow and text-shadow patterns as design tokens.
 * Groups shadows by value and classifies by depth/spread.
 * @param {{ sampleSize: number }} args
 */
function extractShadowsInBrowser({ sampleSize }) {
  const boxShadowMap = new Map();
  const textShadowMap = new Map();
  let sampled = 0;

  for (const el of document.querySelectorAll('body *')) {
    if (sampled >= sampleSize) break;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    sampled++;

    const cs = getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    const desc = el.className ? `${tag}.${String(el.className).split(' ')[0]}` : tag;

    // Box shadows
    const bs = cs.boxShadow;
    if (bs && bs !== 'none') {
      const entry = boxShadowMap.get(bs) || { value: bs, count: 0, samples: [] };
      entry.count++;
      if (entry.samples.length < 3) entry.samples.push(desc);
      boxShadowMap.set(bs, entry);
    }

    // Text shadows
    const ts = cs.textShadow;
    if (ts && ts !== 'none') {
      const entry = textShadowMap.get(ts) || { value: ts, count: 0, samples: [] };
      entry.count++;
      if (entry.samples.length < 3) entry.samples.push(desc);
      textShadowMap.set(ts, entry);
    }
  }

  function classifyShadow(value) {
    const parts = value.match(/-?\d+(\.\d+)?px/g) || [];
    const nums = parts.map(p => parseFloat(p));
    const blur = nums[2] || 0;
    const spread = nums[3] || 0;
    if (blur <= 2 && spread <= 0) return 'subtle';
    if (blur <= 8) return 'small';
    if (blur <= 20) return 'medium';
    return 'large';
  }

  const boxShadows = [...boxShadowMap.values()]
    .sort((a, b) => b.count - a.count)
    .map(s => ({ ...s, elevation: classifyShadow(s.value) }));

  const textShadows = [...textShadowMap.values()]
    .sort((a, b) => b.count - a.count);

  return {
    boxShadows,
    textShadows,
    totalBoxShadows: boxShadows.length,
    totalTextShadows: textShadows.length,
    elementsSampled: sampled,
  };
}

/**
 * Detect icon font usage: Font Awesome, Material Icons, Bootstrap Icons, Phosphor, Lucide, etc.
 * Extracts icon classes and maps them back to the icon library.
 */
function extractIconsInBrowser() {
  const ICON_PATTERNS = [
    { library: 'Font Awesome', pattern: /^fa[srldb]?\s+fa-[\w-]+$/i, classPrefix: /^fa[srldb]?$|^fa-/, linkPattern: /font-?awesome/i },
    { library: 'Material Icons', pattern: /^material-icons(-\w+)?$/i, classPrefix: /^material-icons/, linkPattern: /material.*icons/i },
    { library: 'Material Symbols', pattern: /^material-symbols(-\w+)?$/i, classPrefix: /^material-symbols/, linkPattern: /material.*symbols/i },
    { library: 'Bootstrap Icons', pattern: /^bi\s+bi-[\w-]+$/i, classPrefix: /^bi-/, linkPattern: /bootstrap-icons/i },
    { library: 'Phosphor Icons', pattern: /^ph(-\w+)?\s+ph-[\w-]+$/i, classPrefix: /^ph-/, linkPattern: /phosphor/i },
    { library: 'Remix Icons', pattern: /^ri-[\w-]+$/i, classPrefix: /^ri-/, linkPattern: /remixicon/i },
    { library: 'Lucide', pattern: /^lucide-[\w-]+$/i, classPrefix: /^lucide-/, linkPattern: /lucide/i },
    { library: 'Heroicons', classPrefix: /^heroicon-/, linkPattern: /heroicons/i },
    { library: 'Tabler Icons', classPrefix: /^ti-|^tabler-/, linkPattern: /tabler/i },
    { library: 'Ionicons', classPrefix: /^ion-/, linkPattern: /ionicons/i },
  ];

  const detectedLibraries = new Set();
  const iconMap = new Map(); // className -> { library, count }
  const iconElements = [];

  // Check stylesheet links for icon libraries
  for (const link of document.querySelectorAll('link[href]')) {
    const href = link.href.toLowerCase();
    for (const p of ICON_PATTERNS) {
      if (p.linkPattern && p.linkPattern.test(href)) {
        detectedLibraries.add(p.library);
      }
    }
  }

  // Check script sources
  for (const script of document.querySelectorAll('script[src]')) {
    const src = script.src.toLowerCase();
    for (const p of ICON_PATTERNS) {
      if (p.linkPattern && p.linkPattern.test(src)) {
        detectedLibraries.add(p.library);
      }
    }
  }

  // Scan elements with icon-related classes
  for (const el of document.querySelectorAll('[class]')) {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    const classList = [...el.classList];

    for (const p of ICON_PATTERNS) {
      const iconClasses = classList.filter(c => p.classPrefix && p.classPrefix.test(c));
      if (iconClasses.length > 0) {
        detectedLibraries.add(p.library);
        const iconName = iconClasses.find(c => c !== 'fa' && c !== 'fas' && c !== 'far' && c !== 'fal' && c !== 'fab' && c !== 'bi' && !c.match(/^material-(icons|symbols)/)) || iconClasses[0];
        const key = `${p.library}:${iconName}`;
        const entry = iconMap.get(key) || { library: p.library, className: iconName, count: 0 };
        entry.count++;
        iconMap.set(key, entry);
      }
    }

    // Detect Material Icons by content (they use ligatures)
    if (classList.some(c => /^material-icons/.test(c) || /^material-symbols/.test(c))) {
      const text = el.textContent.trim();
      if (text && text.length < 40) {
        const key = `Material:${text}`;
        const entry = iconMap.get(key) || { library: 'Material Icons', iconName: text, className: classList.join(' '), count: 0 };
        entry.count++;
        iconMap.set(key, entry);
      }
    }
  }

  // Also detect if using <i> elements with pseudo-content (common icon font pattern)
  let pseudoIconCount = 0;
  for (const el of document.querySelectorAll('i:empty, span:empty')) {
    if (el.offsetParent === null) continue;
    const before = getComputedStyle(el, '::before');
    const content = before.getPropertyValue('content');
    if (content && content !== 'none' && content !== 'normal' && content !== '""') {
      const fontFamily = before.getPropertyValue('font-family').toLowerCase();
      if (fontFamily.includes('icon') || fontFamily.includes('awesome') || fontFamily.includes('material') ||
          fontFamily.includes('glyphicon') || fontFamily.includes('icomoon')) {
        pseudoIconCount++;
        if (!detectedLibraries.size) {
          const cleanFont = fontFamily.replace(/['"]/g, '').trim();
          detectedLibraries.add(`Custom (${cleanFont})`);
        }
      }
    }
  }

  const icons = [...iconMap.values()].sort((a, b) => b.count - a.count);

  return {
    libraries: [...detectedLibraries],
    icons: icons.slice(0, 100),
    totalUniqueIcons: icons.length,
    totalIconElements: icons.reduce((sum, i) => sum + i.count, 0) + pseudoIconCount,
    pseudoContentIcons: pseudoIconCount,
  };
}

/**
 * Check WCAG contrast ratios between text and background colors on the page.
 * @param {{ sampleSize: number, standard: string }} args
 */
function extractContrastInBrowser({ sampleSize, standard }) {
  function parseRgb(str) {
    if (!str || str === 'transparent' || str === 'rgba(0, 0, 0, 0)') return null;
    const match = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) return { r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]) };
    return null;
  }

  function relativeLuminance(rgb) {
    const [rs, gs, bs] = [rgb.r, rgb.g, rgb.b].map(v => {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  function contrastRatio(rgb1, rgb2) {
    const l1 = relativeLuminance(rgb1);
    const l2 = relativeLuminance(rgb2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function rgbToHex(rgb) {
    return '#' + [rgb.r, rgb.g, rgb.b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function getEffectiveBg(el) {
    let current = el;
    while (current && current !== document.body) {
      const bg = parseRgb(getComputedStyle(current).backgroundColor);
      if (bg && (bg.r !== 0 || bg.g !== 0 || bg.b !== 0 || getComputedStyle(current).backgroundColor !== 'rgba(0, 0, 0, 0)')) {
        return bg;
      }
      current = current.parentElement;
    }
    // Default to white background
    return { r: 255, g: 255, b: 255 };
  }

  const isAA = standard === 'aa';
  const normalThreshold = isAA ? 4.5 : 7.0;
  const largeThreshold = isAA ? 3.0 : 4.5;

  const pairMap = new Map();
  const issues = [];
  let sampled = 0;

  for (const el of document.querySelectorAll('body *')) {
    if (sampled >= sampleSize) break;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    const text = el.textContent.trim();
    if (!text || el.children.length > 0) continue; // leaf text nodes only

    sampled++;
    const cs = getComputedStyle(el);
    const fg = parseRgb(cs.color);
    const bg = getEffectiveBg(el);
    if (!fg || !bg) continue;

    const ratio = contrastRatio(fg, bg);
    const fontSize = parseFloat(cs.fontSize);
    const fontWeight = parseInt(cs.fontWeight) || 400;
    const isLargeText = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
    const threshold = isLargeText ? largeThreshold : normalThreshold;
    const passes = ratio >= threshold;

    const key = `${rgbToHex(fg)}|${rgbToHex(bg)}`;
    if (!pairMap.has(key)) {
      pairMap.set(key, {
        foreground: rgbToHex(fg),
        background: rgbToHex(bg),
        ratio: Math.round(ratio * 100) / 100,
        passes,
        isLargeText: false,
        count: 0,
        samples: [],
      });
    }

    const entry = pairMap.get(key);
    entry.count++;
    if (isLargeText) entry.isLargeText = true;
    if (!passes && entry.samples.length < 3) {
      const tag = el.tagName.toLowerCase();
      const desc = el.className ? `${tag}.${String(el.className).split(' ')[0]}` : tag;
      entry.samples.push({ element: desc, text: text.slice(0, 50), fontSize: `${fontSize}px` });
    }

    if (!passes) {
      issues.push({
        foreground: rgbToHex(fg),
        background: rgbToHex(bg),
        ratio: Math.round(ratio * 100) / 100,
        required: threshold,
        element: el.tagName.toLowerCase(),
        text: text.slice(0, 60),
        fontSize: `${fontSize}px`,
      });
    }
  }

  const pairs = [...pairMap.values()].sort((a, b) => a.ratio - b.ratio);
  const failing = pairs.filter(p => !p.passes);
  const passing = pairs.filter(p => p.passes);

  return {
    standard: standard.toUpperCase(),
    totalPairs: pairs.length,
    passing: passing.length,
    failing: failing.length,
    worstPairs: failing.slice(0, 10),
    allPairs: pairs.slice(0, 50),
    issues: issues.slice(0, 20),
    elementsSampled: sampled,
  };
}

function extractWebComponentsInBrowser() {
  const componentMap = new Map();

  document.querySelectorAll('*').forEach(el => {
    const tag = el.tagName.toLowerCase();
    if (!tag.includes('-')) return;

    if (!componentMap.has(tag)) {
      const shadowRoot = el.shadowRoot;
      componentMap.set(tag, {
        tag,
        count: 0,
        hasShadowRoot: shadowRoot !== null,
        shadowMode: shadowRoot ? 'open' : 'closed-or-none',
        observedAttributes: [],
        attributes: new Set(),
        hasSlots: shadowRoot ? shadowRoot.querySelectorAll('slot').length > 0 : false,
        hasStyles: shadowRoot ? shadowRoot.querySelectorAll('style').length > 0 : false,
        childElementCounts: [],
      });
      try {
        const obs = el.constructor.observedAttributes;
        if (Array.isArray(obs)) componentMap.get(tag).observedAttributes = [...obs];
      } catch {}
    }

    const entry = componentMap.get(tag);
    entry.count++;
    entry.childElementCounts.push(el.children.length);

    const skip = new Set(['class', 'id', 'style', 'slot']);
    for (const attr of el.attributes) {
      if (!skip.has(attr.name)) entry.attributes.add(attr.name);
    }
  });

  const libraries = [];
  if (window.Lit || window.litElementVersions) libraries.push('Lit');
  if (window.Stencil || document.querySelector('script[data-stencil]')) libraries.push('Stencil');
  if (window.Polymer) libraries.push('Polymer');
  if (window.FAST || document.querySelector('[data-fast]')) libraries.push('FAST');
  const tags = [...componentMap.keys()];
  if (window.shoelace || tags.some(t => t.startsWith('sl-'))) libraries.push('Shoelace');
  if (tags.some(t => t.startsWith('ion-'))) libraries.push('Ionic');
  if (tags.some(t => t.startsWith('vaadin-'))) libraries.push('Vaadin');
  if (tags.some(t => t.startsWith('mwc-') || t.startsWith('md-'))) libraries.push('Material Web');

  const components = [...componentMap.values()].map(c => ({
    tag: c.tag,
    count: c.count,
    hasShadowRoot: c.hasShadowRoot,
    shadowMode: c.shadowMode,
    observedAttributes: c.observedAttributes,
    attributes: [...c.attributes],
    hasSlots: c.hasSlots,
    hasStyles: c.hasStyles,
    childElementCount: c.childElementCounts.length
      ? Math.round(c.childElementCounts.reduce((a, b) => a + b, 0) / c.childElementCounts.length)
      : 0,
  }));

  return {
    components,
    totalCustomElements: components.length,
    totalInstances: components.reduce((sum, c) => sum + c.count, 0),
    libraries,
    templateElements: document.querySelectorAll('template').length,
  };
}

function extractThirdPartyInBrowser() {
  const vendorMap = {
    'googletagmanager.com': { vendor: 'Google Tag Manager', category: 'analytics' },
    'google-analytics.com': { vendor: 'Google Analytics', category: 'analytics' },
    'analytics.google.com': { vendor: 'Google Analytics', category: 'analytics' },
    'segment.com': { vendor: 'Segment', category: 'analytics' },
    'cdn.segment.com': { vendor: 'Segment', category: 'analytics' },
    'mixpanel.com': { vendor: 'Mixpanel', category: 'analytics' },
    'cdn.mxpnl.com': { vendor: 'Mixpanel', category: 'analytics' },
    'amplitude.com': { vendor: 'Amplitude', category: 'analytics' },
    'cdn.amplitude.com': { vendor: 'Amplitude', category: 'analytics' },
    'hotjar.com': { vendor: 'Hotjar', category: 'analytics' },
    'static.hotjar.com': { vendor: 'Hotjar', category: 'analytics' },
    'clarity.ms': { vendor: 'Microsoft Clarity', category: 'analytics' },
    'plausible.io': { vendor: 'Plausible', category: 'analytics' },
    'app.posthog.com': { vendor: 'PostHog', category: 'analytics' },
    'sentry-cdn.com': { vendor: 'Sentry', category: 'error-monitoring' },
    'browser.sentry-cdn.com': { vendor: 'Sentry', category: 'error-monitoring' },
    'sentry.io': { vendor: 'Sentry', category: 'error-monitoring' },
    'bugsnag.com': { vendor: 'Bugsnag', category: 'error-monitoring' },
    'd2wy8f7a9ursnm.cloudfront.net': { vendor: 'Bugsnag', category: 'error-monitoring' },
    'rollbar.com': { vendor: 'Rollbar', category: 'error-monitoring' },
    'www.datadoghq-browser-agent.com': { vendor: 'Datadog RUM', category: 'error-monitoring' },
    'optimizely.com': { vendor: 'Optimizely', category: 'ab-testing' },
    'cdn.optimizely.com': { vendor: 'Optimizely', category: 'ab-testing' },
    'app.launchdarkly.com': { vendor: 'LaunchDarkly', category: 'ab-testing' },
    'statsig.com': { vendor: 'Statsig', category: 'ab-testing' },
    'cdn.cookielaw.org': { vendor: 'OneTrust', category: 'consent' },
    'osano.com': { vendor: 'Osano', category: 'consent' },
    'consent.cookiebot.com': { vendor: 'Cookiebot', category: 'consent' },
    'js.stripe.com': { vendor: 'Stripe', category: 'payments' },
    'www.paypal.com': { vendor: 'PayPal', category: 'payments' },
    'pay.google.com': { vendor: 'Google Pay', category: 'payments' },
    'connect.facebook.net': { vendor: 'Meta Pixel', category: 'advertising' },
    'www.googleadservices.com': { vendor: 'Google Ads', category: 'advertising' },
    'pagead2.googlesyndication.com': { vendor: 'Google Ads', category: 'advertising' },
    'doubleclick.net': { vendor: 'DoubleClick', category: 'advertising' },
    'platform.twitter.com': { vendor: 'Twitter/X', category: 'social' },
    'platform.linkedin.com': { vendor: 'LinkedIn', category: 'social' },
    'cdn.jsdelivr.net': { vendor: 'jsDelivr', category: 'cdn' },
    'cdnjs.cloudflare.com': { vendor: 'cdnjs', category: 'cdn' },
    'unpkg.com': { vendor: 'unpkg', category: 'cdn' },
    'ajax.googleapis.com': { vendor: 'Google CDN', category: 'cdn' },
    'widget.intercom.io': { vendor: 'Intercom', category: 'chat' },
    'js.intercomcdn.com': { vendor: 'Intercom', category: 'chat' },
    'js.driftt.com': { vendor: 'Drift', category: 'chat' },
    'embed.tawk.to': { vendor: 'Tawk.to', category: 'chat' },
    'static.zdassets.com': { vendor: 'Zendesk', category: 'chat' },
    'fonts.googleapis.com': { vendor: 'Google Fonts', category: 'fonts' },
    'fonts.gstatic.com': { vendor: 'Google Fonts', category: 'fonts' },
    'use.typekit.net': { vendor: 'Adobe Fonts', category: 'fonts' },
  };

  const firstPartyHost = location.hostname;
  const seen = new Map();

  const addResource = (urlStr) => {
    try {
      const u = new URL(urlStr, location.origin);
      if (u.hostname === firstPartyHost || u.protocol === 'file:') return;
      const hostname = u.hostname;
      if (!seen.has(hostname)) {
        let match = vendorMap[hostname];
        if (!match) {
          for (const [pattern, info] of Object.entries(vendorMap)) {
            if (hostname.endsWith('.' + pattern) || hostname === pattern) {
              match = info;
              break;
            }
          }
        }
        if (!match) {
          const category = hostname.includes('cdn') ? 'cdn'
            : hostname.includes('analytics') ? 'analytics'
            : hostname.includes('track') ? 'analytics'
            : hostname.includes('ad') ? 'advertising'
            : hostname.includes('pay') ? 'payments'
            : 'unknown';
          match = { vendor: hostname, category };
        }
        seen.set(hostname, { ...match, hostname, resourceCount: 0, scriptSrcs: [] });
      }
      const entry = seen.get(hostname);
      entry.resourceCount++;
      if (urlStr.endsWith('.js') || u.pathname.endsWith('.js')) {
        entry.scriptSrcs.push(urlStr);
      }
    } catch {}
  };

  document.querySelectorAll('script[src]').forEach(el => addResource(el.src));
  document.querySelectorAll('link[href]').forEach(el => addResource(el.href));
  document.querySelectorAll('img[src]').forEach(el => addResource(el.src));
  document.querySelectorAll('iframe[src]').forEach(el => addResource(el.src));

  try {
    performance.getEntriesByType('resource').forEach(entry => addResource(entry.name));
  } catch {}

  const globals = [];
  if (window.ga || window.gtag || window.dataLayer) globals.push('Google Analytics/GTM');
  if (window.fbq) globals.push('Meta Pixel');
  if (window.Intercom) globals.push('Intercom');
  if (window.Sentry) globals.push('Sentry');
  if (window.Stripe) globals.push('Stripe');
  if (window.mixpanel) globals.push('Mixpanel');
  if (window.amplitude) globals.push('Amplitude');
  if (window.hj) globals.push('Hotjar');

  const vendors = [...seen.values()];
  const byCategory = {};
  for (const v of vendors) {
    byCategory[v.category] = (byCategory[v.category] || 0) + 1;
  }

  return {
    vendors,
    byCategory,
    totalThirdParty: vendors.length,
    confirmedGlobals: globals,
    firstPartyHost,
  };
}

function extractStorageInBrowser() {
  const cookieClassification = {
    '_ga': 'analytics', '_gid': 'analytics', '_gat': 'analytics',
    '__utma': 'analytics', '__utmb': 'analytics', '__utmc': 'analytics', '__utmz': 'analytics',
    '_fbp': 'advertising', '_fbc': 'advertising',
    '_hjid': 'analytics', '_hjSession': 'analytics',
    '__stripe_mid': 'payments', '__stripe_sid': 'payments',
    '_clck': 'analytics', '_clsk': 'analytics',
  };

  const sessionPatterns = ['session', 'token', 'csrf', 'auth', 'sid', 'jwt', 'login'];

  const cookies = document.cookie.split(';').filter(c => c.trim()).map(c => {
    const [key, ...rest] = c.trim().split('=');
    const name = key.trim();
    const value = rest.join('=').trim();
    let classification = cookieClassification[name] || 'unknown';
    if (classification === 'unknown' && sessionPatterns.some(p => name.toLowerCase().includes(p))) {
      classification = 'session';
    }
    return { name, valueLength: value.length, valuePreview: value.slice(0, 50), classification };
  });

  const cookiesByClass = {};
  for (const c of cookies) {
    cookiesByClass[c.classification] = (cookiesByClass[c.classification] || 0) + 1;
  }

  const enumerateStorage = (storage) => {
    const items = [];
    let totalSize = 0;
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        const value = storage.getItem(key);
        const len = value ? value.length : 0;
        totalSize += key.length + len;
        let inferredType = 'string';
        if (value) {
          try {
            const parsed = JSON.parse(value);
            inferredType = Array.isArray(parsed) ? 'json-array' : typeof parsed === 'object' ? 'json-object' : 'string';
          } catch {}
        }
        items.push({ key, valueLength: len, valuePreview: (value || '').slice(0, 100), inferredType });
      }
    } catch {}
    const totalSizeEstimate = totalSize < 1024 ? totalSize + ' B' : (totalSize / 1024).toFixed(1) + ' KB';
    return { items, total: items.length, totalSizeEstimate };
  };

  const local = enumerateStorage(localStorage);
  const session = enumerateStorage(sessionStorage);

  let indexedDBInfo = { databases: [], supported: false };
  try {
    if (window.indexedDB) {
      indexedDBInfo.supported = true;
      if (typeof indexedDB.databases === 'function') {
        indexedDBInfo.databases = '__async__';
      }
    }
  } catch {}

  return {
    cookies: { items: cookies, total: cookies.length, classified: cookiesByClass },
    localStorage: local,
    sessionStorage: session,
    indexedDB: indexedDBInfo,
  };
}

function extractPwaInBrowser() {
  const manifest = document.querySelector('link[rel="manifest"]');
  const manifestUrl = manifest ? manifest.href : null;

  const getMeta = (name) => {
    const el = document.querySelector(`meta[name="${name}"]`);
    return el ? el.content : null;
  };

  const themeColor = getMeta('theme-color');
  const appleCapable = getMeta('apple-mobile-web-app-capable');
  const appleStatusBar = getMeta('apple-mobile-web-app-status-bar-style');
  const appleTitle = getMeta('apple-mobile-web-app-title');
  const mobileWebAppCapable = getMeta('mobile-web-app-capable');
  const msTileColor = getMeta('msapplication-TileColor');
  const msConfig = getMeta('msapplication-config');

  const appleTouchIcons = [...document.querySelectorAll('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]')].map(el => ({
    href: el.href,
    sizes: el.getAttribute('sizes') || 'default',
  }));

  let serviceWorker = { registered: false, scope: null };
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      serviceWorker = { registered: true, scope: navigator.serviceWorker.controller.scriptURL };
    }
  } catch {}

  const capabilities = {
    serviceWorkerApi: 'serviceWorker' in navigator,
    pushApi: 'PushManager' in window,
    notificationApi: 'Notification' in window,
    cacheApi: 'caches' in window,
    backgroundSync: 'SyncManager' in window,
    periodicSync: 'PeriodicSyncManager' in window,
    badgeApi: 'setAppBadge' in navigator,
    shareApi: 'share' in navigator,
    shareTargetApi: 'ShareTarget' in window,
  };

  return {
    manifestUrl,
    themeColor,
    appleMeta: {
      capable: appleCapable,
      statusBarStyle: appleStatusBar,
      title: appleTitle,
      touchIcons: appleTouchIcons,
    },
    msMeta: { tileColor: msTileColor, config: msConfig },
    mobileWebAppCapable,
    serviceWorker,
    capabilities,
  };
}

function extractSecurityInBrowser() {
  const metaCsp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  const cspContent = metaCsp ? metaCsp.content : null;

  const referrerMeta = document.querySelector('meta[name="referrer"]');
  const referrerPolicy = referrerMeta ? referrerMeta.content : null;

  const scripts = [...document.querySelectorAll('script[src]')];
  const externalScripts = scripts.filter(s => {
    try { return new URL(s.src).origin !== location.origin; } catch { return false; }
  });
  const sriAudit = {
    total: externalScripts.length,
    withSri: externalScripts.filter(s => s.integrity).length,
    withoutSri: externalScripts.filter(s => !s.integrity).length,
    details: externalScripts.map(s => ({
      src: s.src,
      hasSri: !!s.integrity,
      integrity: s.integrity || null,
      crossorigin: s.crossOrigin || null,
    })),
  };

  const links = [...document.querySelectorAll('link[rel="stylesheet"][href]')];
  const externalLinks = links.filter(l => {
    try { return new URL(l.href).origin !== location.origin; } catch { return false; }
  });
  const styleSriAudit = {
    total: externalLinks.length,
    withSri: externalLinks.filter(l => l.integrity).length,
    withoutSri: externalLinks.filter(l => !l.integrity).length,
  };

  const iframes = [...document.querySelectorAll('iframe')].map(f => ({
    src: f.src || null,
    sandbox: f.sandbox ? [...f.sandbox].join(' ') : null,
    isSandboxed: f.hasAttribute('sandbox'),
  }));
  const unsandboxedIframes = iframes.filter(f => f.src && !f.isSandboxed);

  const forms = [...document.querySelectorAll('form[action]')];
  const insecureForms = forms.filter(f => {
    try { return new URL(f.action, location.origin).protocol === 'http:'; } catch { return false; }
  }).map(f => f.action);

  const allSrcs = [
    ...scripts.map(s => s.src),
    ...[...document.querySelectorAll('img[src], audio[src], video[src], source[src]')].map(e => e.src),
    ...[...document.querySelectorAll('link[href]')].map(e => e.href),
  ];
  const mixedContent = allSrcs.filter(src => {
    try {
      const u = new URL(src, location.origin);
      return u.protocol === 'http:' && location.protocol === 'https:';
    } catch { return false; }
  });

  const findings = [];
  if (!cspContent) findings.push({ issue: 'No meta CSP found', severity: 'medium' });
  if (sriAudit.withoutSri > 0) findings.push({ issue: `${sriAudit.withoutSri} external scripts without SRI`, severity: 'medium' });
  if (styleSriAudit.withoutSri > 0) findings.push({ issue: `${styleSriAudit.withoutSri} external stylesheets without SRI`, severity: 'low' });
  if (unsandboxedIframes.length > 0) findings.push({ issue: `${unsandboxedIframes.length} unsandboxed iframes`, severity: 'medium' });
  if (insecureForms.length > 0) findings.push({ issue: `${insecureForms.length} forms with insecure action URLs`, severity: 'high' });
  if (mixedContent.length > 0) findings.push({ issue: `${mixedContent.length} mixed content resources`, severity: 'high' });
  if (!referrerPolicy) findings.push({ issue: 'No referrer policy set', severity: 'low' });

  let score = 100;
  for (const f of findings) {
    if (f.severity === 'high') score -= 20;
    else if (f.severity === 'medium') score -= 10;
    else score -= 5;
  }
  score = Math.max(0, score);

  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';

  return {
    metaCsp: cspContent,
    referrerPolicy,
    sriAudit,
    styleSriAudit,
    iframes,
    unsandboxedIframes: unsandboxedIframes.length,
    insecureForms,
    mixedContent: mixedContent.length,
    findings,
    score,
    grade,
  };
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
};
