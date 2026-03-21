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

module.exports = {
  extractColorsInBrowser,
  extractFontsInBrowser,
  extractCssVarsInBrowser,
  extractSpacingInBrowser,
};
