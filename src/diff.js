const {
  extractColorsInBrowser,
  extractFontsInBrowser,
  extractSpacingInBrowser,
  extractComponentsInBrowser,
  extractBreakpointsInBrowser,
  extractA11yInBrowser,
  extractPerfInBrowser,
  extractMetadataInBrowser,
  extractContrastInBrowser,
} = require('./extractors');

const EXTRACTOR_MAP = {
  colors:      { fn: extractColorsInBrowser,      args: { limit: 50 } },
  fonts:       { fn: extractFontsInBrowser,        args: undefined },
  spacing:     { fn: extractSpacingInBrowser,      args: { sampleSize: 200 } },
  components:  { fn: extractComponentsInBrowser,   args: { minOccurrences: 2 } },
  breakpoints: { fn: extractBreakpointsInBrowser,  args: undefined },
  a11y:        { fn: extractA11yInBrowser,         args: { standard: 'aa' } },
  perf:        { fn: extractPerfInBrowser,         args: undefined },
  metadata:    { fn: extractMetadataInBrowser,     args: undefined },
  contrast:    { fn: extractContrastInBrowser,     args: { sampleSize: 200, standard: 'aa' } },
};

const DEFAULT_EXTRACTORS = ['colors', 'fonts', 'spacing', 'a11y', 'perf', 'metadata', 'components', 'breakpoints'];

function setDiff(beforeItems, afterItems) {
  const beforeSet = new Set(beforeItems);
  const afterSet = new Set(afterItems);
  return {
    added: afterItems.filter(x => !beforeSet.has(x)),
    removed: beforeItems.filter(x => !afterSet.has(x)),
    unchanged: beforeItems.filter(x => afterSet.has(x)).length,
  };
}

function diffColors(before, after) {
  const bHexes = (before.colors || []).map(c => c.hex);
  const aHexes = (after.colors || []).map(c => c.hex);
  return { ...setDiff(bHexes, aHexes), deltas: {} };
}

function diffFonts(before, after) {
  const bFams = (before.families || []).map(f => f.value);
  const aFams = (after.families || []).map(f => f.value);
  return { ...setDiff(bFams, aFams), deltas: {} };
}

function diffSpacing(before, after) {
  const bVals = (before.spacing || []).map(s => s.value);
  const aVals = (after.spacing || []).map(s => s.value);
  const base = before.inferredBase === after.inferredBase
    ? 'same'
    : { before: before.inferredBase, after: after.inferredBase };
  return { ...setDiff(bVals, aVals), deltas: { inferredBase: base } };
}

function diffComponents(before, after) {
  const bNames = (before.components || []).map(c => c.name);
  const aNames = (after.components || []).map(c => c.name);
  return { ...setDiff(bNames, aNames), deltas: {} };
}

function diffBreakpoints(before, after) {
  const bVals = (before.breakpoints || []).map(b => b.value);
  const aVals = (after.breakpoints || []).map(b => b.value);
  return { ...setDiff(bVals, aVals), deltas: {} };
}

function diffA11y(before, after) {
  const scoreDelta = (after.score ?? 0) - (before.score ?? 0);
  const bMsgs = (before.issues || []).map(i => i.message);
  const aMsgs = (after.issues || []).map(i => i.message);
  return { ...setDiff(bMsgs, aMsgs), deltas: { score: scoreDelta } };
}

function diffPerf(before, after) {
  const bTiming = before.timing || {};
  const aTiming = after.timing || {};
  const bDom = before.dom || {};
  const aDom = after.dom || {};
  return {
    added: [],
    removed: [],
    unchanged: 0,
    deltas: {
      ttfbMs: (aTiming.ttfbMs ?? null) !== null && (bTiming.ttfbMs ?? null) !== null
        ? aTiming.ttfbMs - bTiming.ttfbMs : null,
      loadMs: (aTiming.loadMs ?? null) !== null && (bTiming.loadMs ?? null) !== null
        ? aTiming.loadMs - bTiming.loadMs : null,
      nodeCount: (aDom.nodeCount ?? null) !== null && (bDom.nodeCount ?? null) !== null
        ? aDom.nodeCount - bDom.nodeCount : null,
    },
  };
}

function diffMetadata(before, after) {
  const fields = ['title', 'description'];
  const deltas = {};
  for (const f of fields) {
    deltas[f] = (before[f] || '') === (after[f] || '')
      ? 'same'
      : { before: before[f] || '', after: after[f] || '' };
  }
  const bOG = JSON.stringify(before.openGraph || {});
  const aOG = JSON.stringify(after.openGraph || {});
  deltas.openGraph = bOG === aOG ? 'same' : { before: before.openGraph, after: after.openGraph };
  return { added: [], removed: [], unchanged: 0, deltas };
}

function diffContrast(before, after) {
  const bWorst = (before.worstPairs || []).map(p => `${p.text}|${p.bg}`);
  const aWorst = (after.worstPairs || []).map(p => `${p.text}|${p.bg}`);
  const bSet = new Set(bWorst);
  const aSet = new Set(aWorst);
  return {
    added: aWorst.filter(x => !bSet.has(x)),
    removed: bWorst.filter(x => !aSet.has(x)),
    unchanged: bWorst.filter(x => aSet.has(x)).length,
    deltas: {
      passing: (after.passing ?? 0) - (before.passing ?? 0),
      failing: (after.failing ?? 0) - (before.failing ?? 0),
    },
  };
}

function diffGeneric(before, after) {
  return {
    added: [],
    removed: [],
    unchanged: 0,
    deltas: { raw: { before, after } },
  };
}

const DIFF_FNS = {
  colors: diffColors,
  fonts: diffFonts,
  spacing: diffSpacing,
  components: diffComponents,
  breakpoints: diffBreakpoints,
  a11y: diffA11y,
  perf: diffPerf,
  metadata: diffMetadata,
  contrast: diffContrast,
};

function diffExtractorResult(extractorName, before, after) {
  const fn = DIFF_FNS[extractorName] || diffGeneric;
  return fn(before, after);
}

module.exports = { diffExtractorResult, EXTRACTOR_MAP, DEFAULT_EXTRACTORS };
