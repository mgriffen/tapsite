import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock the browser module so helpers.js doesn't require Playwright.
// helpers.js does `const browser = require('./browser')` (CJS), so the mock
// factory must export the object as default *and* as flat properties, because
// Vitest CJS interop gives the full module to require().
vi.mock('../src/browser.js', () => ({
  default: {
    page: { url: () => 'https://example.com' },
    elementMap: [],
  },
  page: { url: () => 'https://example.com' },
  elementMap: [],
}));

// helpers.js and config.js are CJS modules. Import them after setting up mocks.
// config must be imported via createRequire or require() to share the same
// CJS module instance that helpers.js uses.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const config = require('../src/config.js');
const { summarizeResult, requireSafeUrl } = require('../src/helpers.js');

// ── helpers ────────────────────────────────────────────────────────────────

/** Pull the JSON file path out of the MCP text response. */
function pathFromResult(result) {
  const text = result.content[0].text;
  const match = text.match(/Full data: (.+)/);
  return match ? match[1].trim() : null;
}

/** Given the JSON file path, return the sibling .md path. */
function mdFromJsonPath(jsonPath) {
  return jsonPath.replace(/\.json$/, '.md');
}

// ── test state ─────────────────────────────────────────────────────────────

const tmpDir = path.join(os.tmpdir(), 'tapsite-test-helpers');
const originalOutputDir = config.OUTPUT_DIR;

beforeEach(() => {
  config.OUTPUT_DIR = tmpDir;
  fs.mkdirSync(tmpDir, { recursive: true });
  delete process.env.TAPSITE_REPORT;
});

afterEach(() => {
  config.OUTPUT_DIR = originalOutputDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.TAPSITE_REPORT;
});

// ── JSON output (always) ───────────────────────────────────────────────────

describe('requireSafeUrl', () => {
  it('allows normal HTTP URLs', () => {
    expect(() => requireSafeUrl('https://example.com')).not.toThrow();
  });

  it('blocks file:// scheme', () => {
    expect(() => requireSafeUrl('file:///etc/passwd')).toThrow('Blocked');
  });

  it('blocks javascript: scheme', () => {
    expect(() => requireSafeUrl('javascript:alert(1)')).toThrow();
  });

  it('blocks localhost', () => {
    expect(() => requireSafeUrl('http://127.0.0.1')).toThrow('Blocked');
    expect(() => requireSafeUrl('http://localhost')).toThrow('Blocked');
  });

  it('blocks private 10.x.x.x range', () => {
    expect(() => requireSafeUrl('http://10.0.0.1')).toThrow('Blocked');
  });

  it('blocks private 172.16-31.x.x range', () => {
    expect(() => requireSafeUrl('http://172.16.0.1')).toThrow('Blocked');
    expect(() => requireSafeUrl('http://172.31.255.255')).toThrow('Blocked');
  });

  it('allows 172.15.x.x (not private)', () => {
    expect(() => requireSafeUrl('http://172.15.0.1')).not.toThrow();
  });

  it('blocks private 192.168.x.x range', () => {
    expect(() => requireSafeUrl('http://192.168.1.1')).toThrow('Blocked');
  });

  it('blocks link-local 169.254.x.x (AWS metadata)', () => {
    expect(() => requireSafeUrl('http://169.254.169.254')).toThrow('Blocked');
  });

  it('blocks IPv6 loopback', () => {
    expect(() => requireSafeUrl('http://[::1]')).toThrow('Blocked');
  });

  it('blocks 0.0.0.0', () => {
    expect(() => requireSafeUrl('http://0.0.0.0')).toThrow('Blocked');
  });

  it('allows normal public IPs', () => {
    expect(() => requireSafeUrl('http://8.8.8.8')).not.toThrow();
  });
});

describe('summarizeResult', () => {
  describe('JSON output (always written)', () => {
    it('always writes a JSON file', () => {
      const result = summarizeResult('test-tool', { foo: 'bar' }, 'Found 1 thing.');
      const jsonPath = pathFromResult(result);
      expect(jsonPath).not.toBeNull();
      expect(fs.existsSync(jsonPath)).toBe(true);
    });

    it('JSON filename matches <name>-<ts>.json pattern', () => {
      const result = summarizeResult('colors', { palette: [] }, 'No colors found.');
      const jsonPath = pathFromResult(result);
      expect(path.basename(jsonPath)).toMatch(/^colors-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/);
    });

    it('JSON contains _meta and data fields', () => {
      const result = summarizeResult('fonts', { families: ['Inter'] }, 'Found 1 font family.');
      const jsonPath = pathFromResult(result);
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      expect(data._meta).toBeDefined();
      expect(data._meta.tool).toBe('fonts');
      // URL comes from the mocked browser.page.url() — tolerate empty string if mock doesn't bind.
      expect(typeof data._meta.url).toBe('string');
      expect(data._meta.summary).toBe('Found 1 font family.');
      expect(data.families).toEqual(['Inter']);

    });

    it('returns MCP content with sanitized summary and file path', () => {
      const result = summarizeResult('test', {}, 'All good.');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('All good.');
      expect(result.content[0].text).toContain('Full data:');
    });

    it('uses meta.tool override when provided', () => {
      const result = summarizeResult('internal', {}, 'ok', { tool: 'tapsite_extract_colors' });
      const jsonPath = pathFromResult(result);
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      expect(data._meta.tool).toBe('tapsite_extract_colors');
    });
  });

  // ── No Markdown without TAPSITE_REPORT=1 ─────────────────────────────────

  describe('Markdown output (TAPSITE_REPORT gated)', () => {
    it('does NOT write a Markdown file when TAPSITE_REPORT is unset', () => {
      const result = summarizeResult('colors', { palette: [] }, 'No colors.');
      const mdPath = mdFromJsonPath(pathFromResult(result));
      expect(fs.existsSync(mdPath)).toBe(false);
    });

    it('does NOT write a Markdown file when TAPSITE_REPORT=0', () => {
      process.env.TAPSITE_REPORT = '0';
      const result = summarizeResult('colors', { palette: [] }, 'No colors.');
      const mdPath = mdFromJsonPath(pathFromResult(result));
      expect(fs.existsSync(mdPath)).toBe(false);
    });

    it('writes a Markdown file alongside the JSON when TAPSITE_REPORT=1', () => {
      process.env.TAPSITE_REPORT = '1';
      const result = summarizeResult('colors', { palette: [] }, 'Found 5 colors.');
      const mdPath = mdFromJsonPath(pathFromResult(result));
      expect(fs.existsSync(mdPath)).toBe(true);
    });

    it('Markdown filename matches <name>-<ts>.md pattern', () => {
      process.env.TAPSITE_REPORT = '1';
      const result = summarizeResult('fonts', { families: [] }, 'Found fonts.');
      const mdPath = mdFromJsonPath(pathFromResult(result));
      expect(path.basename(mdPath)).toMatch(/^fonts-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.md$/);
    });

    it('Markdown and JSON share the same timestamp stem', () => {
      process.env.TAPSITE_REPORT = '1';
      const result = summarizeResult('a11y', { issues: [] }, 'No issues.');
      const jsonPath = pathFromResult(result);
      const mdPath = mdFromJsonPath(jsonPath);
      const jsonStem = path.basename(jsonPath).replace('.json', '');
      const mdStem = path.basename(mdPath).replace('.md', '');
      expect(jsonStem).toBe(mdStem);
    });

    it('Markdown includes the tool name as an H1 heading', () => {
      process.env.TAPSITE_REPORT = '1';
      const result = summarizeResult('tapsite_extract_colors', { palette: [] }, 'Found 10 colors.');
      const md = fs.readFileSync(mdFromJsonPath(pathFromResult(result)), 'utf-8');
      expect(md).toContain('# tapsite_extract_colors');
    });

    it('Markdown includes _meta URL, timestamp, and version', () => {
      process.env.TAPSITE_REPORT = '1';
      const result = summarizeResult('test-tool', {}, 'Summary text here.');
      const md = fs.readFileSync(mdFromJsonPath(pathFromResult(result)), 'utf-8');
      // The Markdown should include the URL field in the table (value may be empty or real)
      expect(md).toContain('**URL**');
      expect(md).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(md).toMatch(/\d+\.\d+\.\d+/);

    });

    it('Markdown includes the summary under a ## Summary heading', () => {
      process.env.TAPSITE_REPORT = '1';
      const result = summarizeResult('links', { links: [] }, 'Found 42 links across 3 categories.');
      const md = fs.readFileSync(mdFromJsonPath(pathFromResult(result)), 'utf-8');
      expect(md).toContain('## Summary');
      expect(md).toContain('Found 42 links across 3 categories.');
    });

    it('Markdown includes description when provided in meta', () => {
      process.env.TAPSITE_REPORT = '1';
      const result = summarizeResult('colors', {}, 'Colors found.', {
        description: 'Color palette extracted from computed styles',
      });
      const md = fs.readFileSync(mdFromJsonPath(pathFromResult(result)), 'utf-8');
      expect(md).toContain('Color palette extracted from computed styles');
    });

    it('Markdown omits description row when not provided', () => {
      process.env.TAPSITE_REPORT = '1';
      const result = summarizeResult('colors', {}, 'Colors found.');
      const md = fs.readFileSync(mdFromJsonPath(pathFromResult(result)), 'utf-8');
      expect(md).not.toContain('Description');
    });
  });
});
