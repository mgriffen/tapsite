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
    const config = require('../src/config.js');
    config.OUTPUT_DIR = tmpDir;
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
    snapshots.saveSnapshot('https://example.com/page', 'colors', data2);
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
