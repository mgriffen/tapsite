# Diff Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `tapsite_diff_pages` to use real extractors with temporal diffing via snapshots.

**Architecture:** Three new modules — `src/snapshots.js` (snapshot I/O), `src/diff.js` (per-extractor diff logic + extractor name/args mapping), and a rewrite of the `tapsite_diff_pages` tool in `src/tools/multipage.js`. Snapshot storage enables temporal diffs; per-extractor error handling enables partial results.

**Tech Stack:** Node.js, Vitest, existing extractors from `src/extractors.js`

**Spec:** `docs/superpowers/specs/2026-03-24-diff-intelligence-design.md`

---

### Task 1: Snapshot Storage Module

**Files:**
- Create: `src/snapshots.js`
- Create: `test/snapshots.test.js`

- [ ] **Step 1: Write failing tests for snapshot I/O**

```js
// test/snapshots.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

describe('snapshots', () => {
  let tmpDir;
  let snapshots;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapsite-snap-'));
    // Override OUTPUT_DIR before loading snapshots
    const config = require('../src/config.js');
    config.OUTPUT_DIR = tmpDir;
    // Clear module cache so snapshots.js picks up new config
    delete require.cache[require.resolve('../src/snapshots.js')];
    snapshots = require('../src/snapshots.js');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saveSnapshot writes a JSON file and returns the path', () => {
    const data = { colors: [{ hex: '#ff0000' }] };
    const filePath = snapshots.saveSnapshot('https://example.com/pricing', 'colors', data);
    expect(fs.existsSync(filePath)).toBe(true);
    const contents = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(contents.url).toBe('https://example.com/pricing');
    expect(contents.extractor).toBe('colors');
    expect(contents.data).toEqual(data);
    expect(contents.timestamp).toBeDefined();
    expect(contents.version).toBeDefined();
  });

  it('loadLatestSnapshot returns null when no snapshots exist', () => {
    const result = snapshots.loadLatestSnapshot('https://example.com', 'colors');
    expect(result).toBeNull();
  });

  it('loadLatestSnapshot returns the most recent snapshot', () => {
    const data1 = { colors: [{ hex: '#111' }] };
    const data2 = { colors: [{ hex: '#222' }] };
    snapshots.saveSnapshot('https://example.com/page', 'colors', data1);
    // Ensure different timestamp
    const saved2 = snapshots.saveSnapshot('https://example.com/page', 'colors', data2);
    const latest = snapshots.loadLatestSnapshot('https://example.com/page', 'colors');
    expect(latest).not.toBeNull();
    expect(latest.data).toEqual(data2);
  });

  it('distinguishes snapshots for different URL paths on same domain', () => {
    snapshots.saveSnapshot('https://example.com/pricing', 'colors', { a: 1 });
    snapshots.saveSnapshot('https://example.com/about', 'colors', { b: 2 });
    const pricing = snapshots.loadLatestSnapshot('https://example.com/pricing', 'colors');
    const about = snapshots.loadLatestSnapshot('https://example.com/about', 'colors');
    expect(pricing.data).toEqual({ a: 1 });
    expect(about.data).toEqual({ b: 2 });
  });

  it('distinguishes snapshots for different extractors', () => {
    snapshots.saveSnapshot('https://example.com', 'colors', { c: 1 });
    snapshots.saveSnapshot('https://example.com', 'fonts', { f: 2 });
    const colors = snapshots.loadLatestSnapshot('https://example.com', 'colors');
    const fonts = snapshots.loadLatestSnapshot('https://example.com', 'fonts');
    expect(colors.data).toEqual({ c: 1 });
    expect(fonts.data).toEqual({ f: 2 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/snapshots.test.js`
Expected: FAIL — `src/snapshots.js` does not exist

- [ ] **Step 3: Implement `src/snapshots.js`**

```js
// src/snapshots.js
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');

const PKG_VERSION = require('../package.json').version;

function urlHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 8);
}

function snapshotDir(url) {
  const hostname = new URL(url).hostname;
  return path.join(config.OUTPUT_DIR, 'snapshots', hostname);
}

function saveSnapshot(url, extractorName, data) {
  const dir = snapshotDir(url);
  fs.mkdirSync(dir, { recursive: true });

  const ts = new Date().toISOString();
  const tsFile = ts.replace(/[:.]/g, '-').slice(0, 19);
  const hash = urlHash(url);
  const fileName = `${extractorName}-${hash}-${tsFile}.json`;
  const filePath = path.join(dir, fileName);

  const snapshot = {
    url,
    extractor: extractorName,
    timestamp: ts,
    version: PKG_VERSION,
    data,
  };

  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
  return filePath;
}

function loadLatestSnapshot(url, extractorName) {
  const dir = snapshotDir(url);
  if (!fs.existsSync(dir)) return null;

  const hash = urlHash(url);
  const prefix = `${extractorName}-${hash}-`;
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  const contents = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
  return { timestamp: contents.timestamp, data: contents.data };
}

module.exports = { saveSnapshot, loadLatestSnapshot };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/snapshots.test.js`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/snapshots.js test/snapshots.test.js
git commit -m "feat: add snapshot storage module for temporal diffs"
```

---

### Task 2: Diff Logic Module

**Files:**
- Create: `src/diff.js`
- Create: `test/diff.test.js`

- [ ] **Step 1: Write failing tests for extractor map and diff functions**

```js
// test/diff.test.js
import { describe, it, expect } from 'vitest';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { diffExtractorResult, EXTRACTOR_MAP } = require('../src/diff.js');

describe('EXTRACTOR_MAP', () => {
  it('maps all default extractor names', () => {
    const names = ['colors', 'fonts', 'spacing', 'components', 'breakpoints', 'a11y', 'perf', 'metadata', 'contrast'];
    for (const name of names) {
      expect(EXTRACTOR_MAP[name]).toBeDefined();
      expect(EXTRACTOR_MAP[name].fn).toBeTypeOf('function');
    }
  });
});

describe('diffExtractorResult', () => {
  describe('colors', () => {
    it('detects added and removed colors', () => {
      const before = { colors: [{ hex: '#ff0000' }, { hex: '#00ff00' }] };
      const after = { colors: [{ hex: '#00ff00' }, { hex: '#0000ff' }] };
      const diff = diffExtractorResult('colors', before, after);
      expect(diff.added).toEqual(['#0000ff']);
      expect(diff.removed).toEqual(['#ff0000']);
      expect(diff.unchanged).toBe(1);
    });

    it('handles empty arrays', () => {
      const diff = diffExtractorResult('colors', { colors: [] }, { colors: [{ hex: '#fff' }] });
      expect(diff.added).toEqual(['#fff']);
      expect(diff.removed).toEqual([]);
    });
  });

  describe('fonts', () => {
    it('detects added and removed font families', () => {
      const before = { families: [{ value: 'Arial' }, { value: 'Helvetica' }] };
      const after = { families: [{ value: 'Arial' }, { value: 'Inter' }] };
      const diff = diffExtractorResult('fonts', before, after);
      expect(diff.added).toEqual(['Inter']);
      expect(diff.removed).toEqual(['Helvetica']);
      expect(diff.unchanged).toBe(1);
    });
  });

  describe('spacing', () => {
    it('diffs spacing values and inferredBase', () => {
      const before = { spacing: [{ value: '8px' }, { value: '16px' }], inferredBase: '8px' };
      const after = { spacing: [{ value: '16px' }, { value: '24px' }], inferredBase: '8px' };
      const diff = diffExtractorResult('spacing', before, after);
      expect(diff.added).toEqual(['24px']);
      expect(diff.removed).toEqual(['8px']);
      expect(diff.deltas.inferredBase).toBe('same');
    });

    it('detects inferredBase change', () => {
      const before = { spacing: [], inferredBase: '8px' };
      const after = { spacing: [], inferredBase: '4px' };
      const diff = diffExtractorResult('spacing', before, after);
      expect(diff.deltas.inferredBase).toEqual({ before: '8px', after: '4px' });
    });
  });

  describe('components', () => {
    it('diffs component names', () => {
      const before = { components: [{ name: 'Button' }, { name: 'Card' }] };
      const after = { components: [{ name: 'Card' }, { name: 'Modal' }] };
      const diff = diffExtractorResult('components', before, after);
      expect(diff.added).toEqual(['Modal']);
      expect(diff.removed).toEqual(['Button']);
    });
  });

  describe('breakpoints', () => {
    it('diffs breakpoint values', () => {
      const before = { breakpoints: [{ value: 768 }, { value: 1024 }] };
      const after = { breakpoints: [{ value: 768 }, { value: 1280 }] };
      const diff = diffExtractorResult('breakpoints', before, after);
      expect(diff.added).toEqual([1280]);
      expect(diff.removed).toEqual([1024]);
    });
  });

  describe('a11y', () => {
    it('computes score delta and issue diffs', () => {
      const before = { score: 85, issues: [{ message: 'Missing alt text' }, { message: 'Low contrast' }] };
      const after = { score: 80, issues: [{ message: 'Missing alt text' }, { message: 'No lang attr' }] };
      const diff = diffExtractorResult('a11y', before, after);
      expect(diff.deltas.score).toBe(-5);
      expect(diff.added).toEqual(['No lang attr']);
      expect(diff.removed).toEqual(['Low contrast']);
      expect(diff.unchanged).toBe(1);
    });
  });

  describe('perf', () => {
    it('computes numeric deltas', () => {
      const before = { timing: { ttfbMs: 100, loadMs: 1200 }, dom: { nodeCount: 500 } };
      const after = { timing: { ttfbMs: 120, loadMs: 1400 }, dom: { nodeCount: 550 } };
      const diff = diffExtractorResult('perf', before, after);
      expect(diff.deltas.ttfbMs).toBe(20);
      expect(diff.deltas.loadMs).toBe(200);
      expect(diff.deltas.nodeCount).toBe(50);
    });

    it('handles missing timing gracefully', () => {
      const before = { timing: null, dom: { nodeCount: 500 } };
      const after = { timing: { ttfbMs: 100, loadMs: 1000 }, dom: { nodeCount: 600 } };
      const diff = diffExtractorResult('perf', before, after);
      expect(diff.deltas.nodeCount).toBe(100);
    });
  });

  describe('metadata', () => {
    it('detects field changes', () => {
      const before = { title: 'Old Title', description: 'Same desc', openGraph: { title: 'OG' } };
      const after = { title: 'New Title', description: 'Same desc', openGraph: { title: 'OG' } };
      const diff = diffExtractorResult('metadata', before, after);
      expect(diff.deltas.title).toEqual({ before: 'Old Title', after: 'New Title' });
      expect(diff.deltas.description).toBe('same');
      expect(diff.deltas.openGraph).toBe('same');
    });
  });

  describe('contrast', () => {
    it('computes count deltas and worstPairs diff', () => {
      const before = { passing: 10, failing: 3, totalPairs: 13, worstPairs: [{ text: '#000', bg: '#111' }, { text: '#222', bg: '#333' }] };
      const after = { passing: 12, failing: 1, totalPairs: 13, worstPairs: [{ text: '#222', bg: '#333' }] };
      const diff = diffExtractorResult('contrast', before, after);
      expect(diff.deltas.passing).toBe(2);
      expect(diff.deltas.failing).toBe(-2);
      expect(diff.removed).toEqual(['#000|#111']);
      expect(diff.added).toEqual([]);
      expect(diff.unchanged).toBe(1);
    });
  });

  describe('unknown extractor', () => {
    it('returns a generic diff', () => {
      const diff = diffExtractorResult('unknown', { a: 1 }, { a: 2 });
      expect(diff).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/diff.test.js`
Expected: FAIL — `src/diff.js` does not exist

- [ ] **Step 3: Implement `src/diff.js`**

```js
// src/diff.js
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

// Extractor name → browser function + default args
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

// --- Set diff helper ---
function setDiff(beforeItems, afterItems) {
  const beforeSet = new Set(beforeItems);
  const afterSet = new Set(afterItems);
  return {
    added: afterItems.filter(x => !beforeSet.has(x)),
    removed: beforeItems.filter(x => !afterSet.has(x)),
    unchanged: beforeItems.filter(x => afterSet.has(x)).length,
  };
}

// --- Per-extractor diff functions ---

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/diff.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/diff.js test/diff.test.js
git commit -m "feat: add per-extractor diff logic module"
```

---

### Task 3: Rewrite `tapsite_diff_pages`

**Files:**
- Modify: `src/tools/multipage.js:144-230`

- [ ] **Step 1: Update imports at top of `registerMultipageTools`**

At line 4 of `src/tools/multipage.js`, add `navigateIfNeeded` to the destructured import:

```js
// Change:
const { summarizeResult, requireSafeUrl, safeEvaluate } = require('../helpers');
// To:
const { summarizeResult, requireSafeUrl, navigateIfNeeded, safeEvaluate } = require('../helpers');
```

- [ ] **Step 2: Rewrite the `tapsite_diff_pages` tool registration**

Replace lines 144-228 in `src/tools/multipage.js` with:

```js
  server.tool(
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
              text: `📸 Baseline captured for ${url1}\n\nExtractors: ${names.join(', ')}\nSnapshots saved to output/snapshots/. Run this tool again later to see changes.`,
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
```

- [ ] **Step 3: Run full test suite to verify nothing broke**

Run: `npx vitest run`
Expected: All existing tests PASS (the diff tool registration changed but the MCP server test should still see the tool name)

- [ ] **Step 4: Commit**

```bash
git add src/tools/multipage.js
git commit -m "feat: rewrite tapsite_diff_pages with real extractors and temporal mode"
```

---

### Task 4: Integration Verification

**Files:**
- Modify: `test/server.test.js` (add diff tool schema check)

- [ ] **Step 1: Add a test verifying the upgraded diff tool schema**

Add to the existing `server.test.js` tool listing tests:

```js
it('tapsite_diff_pages accepts url1 required, url2 and extractors optional', async () => {
  const tools = await listTools();
  const diff = tools.find(t => t.name === 'tapsite_diff_pages');
  expect(diff).toBeDefined();
  const schema = diff.inputSchema;
  expect(schema.properties.url1).toBeDefined();
  expect(schema.properties.url2).toBeDefined();
  expect(schema.properties.extractors).toBeDefined();
  expect(schema.required).toContain('url1');
  expect(schema.required).not.toContain('url2');
});
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS including new integration test

- [ ] **Step 3: Commit**

```bash
git add test/server.test.js
git commit -m "test: add integration test for upgraded diff tool schema"
```

---

### Task 5: Version Bump and Final Verification

**Files:**
- Modify: `package.json` (version → 4.0.0)

- [ ] **Step 1: Bump version to 4.0.0**

In `package.json`, change `"version": "3.1.1"` to `"version": "4.0.0"`.

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Commit and push**

```bash
git add package.json
git commit -m "chore: bump version to 4.0.0 for diff intelligence release"
```
