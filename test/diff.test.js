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
