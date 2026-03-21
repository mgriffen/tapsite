import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import config from '../src/config.js';
import { createRunDir, screenshotPath, exportJSON, exportMarkdown, exportHTML, exportCSV } from '../src/exporter.js';

const tmpDir = path.join(os.tmpdir(), 'cbrowser-test-export');
const originalOutputDir = config.OUTPUT_DIR;

// Fixture data matching inspector v2 output shape
// { title, url, compressedDOM, elements, inspectedAt }
const fixtureResults = [
  {
    title: 'Test Page',
    url: 'https://example.com',
    inspectedAt: '2026-03-21T00:00:00.000Z',
    compressedDOM: [
      'heading(h1) "Main Heading"',
      'heading(h2) "Subheading"',
      'nav:',
      '  [1] link "Home" -> /',
      '  [2] link "About" -> /about',
      '[3] button "Submit"',
      '[4] button "Cancel"',
      'form action="/login":',
      '  [5] input[text] name="username" placeholder="Username"',
      '  [6] input[password] name="password"',
    ].join('\n'),
    elements: [
      { index: 1, tag: 'a', text: 'Home', href: '/', selector: 'nav > a:nth-of-type(1)', boundingBox: { x: 0, y: 0, width: 60, height: 24 } },
      { index: 2, tag: 'a', text: 'About', href: '/about', selector: 'nav > a:nth-of-type(2)', boundingBox: { x: 70, y: 0, width: 60, height: 24 } },
      { index: 3, tag: 'button', text: 'Submit', href: null, selector: 'button:nth-of-type(1)', boundingBox: { x: 0, y: 50, width: 80, height: 32 } },
      { index: 4, tag: 'button', text: 'Cancel', href: null, selector: 'button:nth-of-type(2)', boundingBox: { x: 90, y: 50, width: 80, height: 32 } },
      { index: 5, tag: 'input', text: null, name: 'username', placeholder: 'Username', href: null, type: 'text', selector: 'input:nth-of-type(1)', boundingBox: { x: 0, y: 100, width: 200, height: 32 } },
      { index: 6, tag: 'input', text: null, name: 'password', placeholder: null, href: null, type: 'password', selector: 'input:nth-of-type(2)', boundingBox: { x: 0, y: 140, width: 200, height: 32 } },
    ],
  },
];

describe('exporter', () => {
  let runDir;

  beforeEach(() => {
    config.OUTPUT_DIR = tmpDir;
    fs.mkdirSync(tmpDir, { recursive: true });
    runDir = createRunDir();
  });

  afterEach(() => {
    config.OUTPUT_DIR = originalOutputDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('createRunDir', () => {
    it('creates a timestamped directory', () => {
      expect(fs.existsSync(runDir)).toBe(true);
      expect(path.basename(runDir)).toMatch(/^run-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
    });

    it('creates a screenshots subdirectory', () => {
      expect(fs.existsSync(path.join(runDir, 'screenshots'))).toBe(true);
    });
  });

  describe('screenshotPath', () => {
    it('returns correct path for index 0', () => {
      const p = screenshotPath(runDir, 0);
      expect(p).toBe(path.join(runDir, 'screenshots', 'page-1.png'));
    });

    it('returns correct path for index 2', () => {
      const p = screenshotPath(runDir, 2);
      expect(p).toBe(path.join(runDir, 'screenshots', 'page-3.png'));
    });
  });

  describe('exportJSON', () => {
    it('writes valid JSON', () => {
      const filePath = exportJSON(runDir, fixtureResults);
      expect(fs.existsSync(filePath)).toBe(true);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(data).toEqual(fixtureResults);
    });

    it('returns path ending in results.json', () => {
      const filePath = exportJSON(runDir, fixtureResults);
      expect(path.basename(filePath)).toBe('results.json');
    });
  });

  describe('exportMarkdown', () => {
    it('writes a markdown file', () => {
      const filePath = exportMarkdown(runDir, fixtureResults);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(path.basename(filePath)).toBe('report.md');
    });

    it('includes page title and URL', () => {
      const filePath = exportMarkdown(runDir, fixtureResults);
      const md = fs.readFileSync(filePath, 'utf-8');
      expect(md).toContain('Test Page');
      expect(md).toContain('https://example.com');
    });

    it('includes pages inspected count', () => {
      const filePath = exportMarkdown(runDir, fixtureResults);
      const md = fs.readFileSync(filePath, 'utf-8');
      expect(md).toContain('Pages inspected:** 1');
    });

    it('includes compressed DOM in a fenced code block', () => {
      const filePath = exportMarkdown(runDir, fixtureResults);
      const md = fs.readFileSync(filePath, 'utf-8');
      expect(md).toContain('### Page Structure');
      expect(md).toContain('```');
      expect(md).toContain('heading(h1) "Main Heading"');
    });

    it('includes interactive elements table', () => {
      const filePath = exportMarkdown(runDir, fixtureResults);
      const md = fs.readFileSync(filePath, 'utf-8');
      expect(md).toContain('### Interactive Elements');
      expect(md).toContain('| # | Tag | Text / Label | Href |');
      // Link row
      expect(md).toContain('| 1 | `a` | Home | / |');
      // Button row (no href)
      expect(md).toContain('| 3 | `button` | Submit |  |');
      // Input row uses placeholder fallback
      expect(md).toContain('| 5 | `input` | Username |  |');
    });

    it('uses name fallback when text and placeholder are absent', () => {
      const filePath = exportMarkdown(runDir, fixtureResults);
      const md = fs.readFileSync(filePath, 'utf-8');
      // element 6 has no text/placeholder but has name="password"
      expect(md).toContain('| 6 | `input` | password |  |');
    });

    it('handles empty results', () => {
      const filePath = exportMarkdown(runDir, []);
      const md = fs.readFileSync(filePath, 'utf-8');
      expect(md).toContain('Pages inspected:** 0');
    });
  });

  describe('exportHTML', () => {
    it('writes an HTML file', () => {
      const filePath = exportHTML(runDir, fixtureResults);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(path.basename(filePath)).toBe('report.html');
    });

    it('contains valid HTML structure', () => {
      const filePath = exportHTML(runDir, fixtureResults);
      const html = fs.readFileSync(filePath, 'utf-8');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });

    it('includes page title and URL', () => {
      const filePath = exportHTML(runDir, fixtureResults);
      const html = fs.readFileSync(filePath, 'utf-8');
      expect(html).toContain('Test Page');
      expect(html).toContain('https://example.com');
    });

    it('includes a <pre> block with compressed DOM', () => {
      const filePath = exportHTML(runDir, fixtureResults);
      const html = fs.readFileSync(filePath, 'utf-8');
      expect(html).toContain('Page Structure');
      expect(html).toContain('<pre class="dom">');
      expect(html).toContain('heading(h1)');
    });

    it('includes interactive elements table', () => {
      const filePath = exportHTML(runDir, fixtureResults);
      const html = fs.readFileSync(filePath, 'utf-8');
      expect(html).toContain('Interactive Elements');
      expect(html).toContain('<th>#</th>');
      expect(html).toContain('<th>Tag</th>');
      expect(html).toContain('Home');
      expect(html).toContain('Submit');
    });

    it('escapes HTML special characters in compressedDOM', () => {
      const xssResults = [{
        title: '<script>alert("xss")</script>',
        url: 'https://example.com',
        inspectedAt: '2026-01-01T00:00:00.000Z',
        compressedDOM: 'text: "<script>alert(1)</script>"',
        elements: [],
      }];
      const filePath = exportHTML(runDir, xssResults);
      const html = fs.readFileSync(filePath, 'utf-8');
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>alert');
    });

    it('escapes HTML special characters in title', () => {
      const xssResults = [{
        title: '<script>alert("xss")</script>',
        url: 'https://example.com',
        inspectedAt: '2026-01-01T00:00:00.000Z',
        compressedDOM: '',
        elements: [],
      }];
      const filePath = exportHTML(runDir, xssResults);
      const html = fs.readFileSync(filePath, 'utf-8');
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>alert');
    });
  });

  describe('exportCSV', () => {
    it('returns empty array when no tables in v2 data', () => {
      // v2 data has no .tables property — exportCSV should gracefully skip
      const files = exportCSV(runDir, fixtureResults);
      expect(files).toHaveLength(0);
    });

    it('returns empty array when results is empty', () => {
      const files = exportCSV(runDir, []);
      expect(files).toHaveLength(0);
    });

    it('still exports CSV if pages include a legacy tables field', () => {
      // exportCSV is shape-agnostic: it just checks for pg.tables
      const withTables = [{
        title: 'Test',
        url: 'https://example.com',
        inspectedAt: '2026-01-01T00:00:00.000Z',
        compressedDOM: '',
        elements: [],
        tables: [{
          caption: 'Users',
          headers: ['Name', 'Role'],
          rows: [['Alice', 'Admin'], ['Bob', 'User']],
          rowCount: 2,
        }],
      }];
      const files = exportCSV(runDir, withTables);
      expect(files).toHaveLength(1);
      expect(path.basename(files[0])).toBe('table-p1-t1.csv');
      const csv = fs.readFileSync(files[0], 'utf-8');
      expect(csv).toContain('"Name","Role"');
      expect(csv).toContain('"Alice","Admin"');
    });

    it('escapes double quotes in CSV', () => {
      const quoteResults = [{
        title: 'Test',
        url: '/',
        inspectedAt: '2026-01-01T00:00:00.000Z',
        compressedDOM: '',
        elements: [],
        tables: [{
          headers: ['Name'],
          rows: [['She said "hello"']],
          rowCount: 1,
        }],
      }];
      const files = exportCSV(runDir, quoteResults);
      const csv = fs.readFileSync(files[0], 'utf-8');
      expect(csv).toContain('""hello""');
    });
  });
});
