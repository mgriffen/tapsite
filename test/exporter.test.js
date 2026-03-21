import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import config from '../src/config.js';
import { createRunDir, screenshotPath, exportJSON, exportMarkdown, exportHTML, exportCSV } from '../src/exporter.js';

const tmpDir = path.join(os.tmpdir(), 'cbrowser-test-export');
const originalOutputDir = config.OUTPUT_DIR;

// Fixture data matching inspector v1 output shape
const fixtureResults = [
  {
    title: 'Test Page',
    url: 'https://example.com',
    navItems: [
      { text: 'Home', href: '/' },
      { text: 'About', href: '/about' },
    ],
    headings: [
      { level: 1, text: 'Main Heading' },
      { level: 2, text: 'Subheading' },
    ],
    buttons: ['Submit', 'Cancel'],
    formFields: [
      { type: 'text', name: 'username', label: 'Username' },
      { type: 'password', name: 'password', label: 'Password' },
    ],
    tables: [
      {
        caption: 'Users',
        headers: ['Name', 'Role'],
        rows: [
          ['Alice', 'Admin'],
          ['Bob', 'User'],
        ],
        rowCount: 2,
      },
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

    it('includes navigation items', () => {
      const filePath = exportMarkdown(runDir, fixtureResults);
      const md = fs.readFileSync(filePath, 'utf-8');
      expect(md).toContain('[Home](/)');
      expect(md).toContain('[About](/about)');
    });

    it('includes headings with levels', () => {
      const filePath = exportMarkdown(runDir, fixtureResults);
      const md = fs.readFileSync(filePath, 'utf-8');
      expect(md).toContain('# Main Heading');
      expect(md).toContain('## Subheading');
    });

    it('includes buttons', () => {
      const filePath = exportMarkdown(runDir, fixtureResults);
      const md = fs.readFileSync(filePath, 'utf-8');
      expect(md).toContain('`Submit`');
      expect(md).toContain('`Cancel`');
    });

    it('includes form fields table', () => {
      const filePath = exportMarkdown(runDir, fixtureResults);
      const md = fs.readFileSync(filePath, 'utf-8');
      expect(md).toContain('| text | username | Username |');
    });

    it('includes table data', () => {
      const filePath = exportMarkdown(runDir, fixtureResults);
      const md = fs.readFileSync(filePath, 'utf-8');
      expect(md).toContain('| Name | Role |');
      expect(md).toContain('| Alice | Admin |');
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

    it('includes page data', () => {
      const filePath = exportHTML(runDir, fixtureResults);
      const html = fs.readFileSync(filePath, 'utf-8');
      expect(html).toContain('Test Page');
      expect(html).toContain('https://example.com');
    });

    it('escapes HTML special characters', () => {
      const xssResults = [{
        title: '<script>alert("xss")</script>',
        url: 'https://example.com',
        navItems: [{ text: 'Test & "Quotes"', href: '/test' }],
        headings: [],
        tables: [],
        formFields: [],
      }];
      const filePath = exportHTML(runDir, xssResults);
      const html = fs.readFileSync(filePath, 'utf-8');
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>alert');
      expect(html).toContain('Test &amp; &quot;Quotes&quot;');
    });

    it('includes navigation links', () => {
      const filePath = exportHTML(runDir, fixtureResults);
      const html = fs.readFileSync(filePath, 'utf-8');
      expect(html).toContain('Home');
      expect(html).toContain('About');
    });
  });

  describe('exportCSV', () => {
    it('creates CSV files for tables with headers', () => {
      const files = exportCSV(runDir, fixtureResults);
      expect(files).toHaveLength(1);
      expect(path.basename(files[0])).toBe('table-p1-t1.csv');
    });

    it('writes correct CSV content', () => {
      const files = exportCSV(runDir, fixtureResults);
      const csv = fs.readFileSync(files[0], 'utf-8');
      expect(csv).toContain('"Name","Role"');
      expect(csv).toContain('"Alice","Admin"');
      expect(csv).toContain('"Bob","User"');
    });

    it('returns empty array when no tables', () => {
      const noTables = [{ title: 'No Tables', url: '/', tables: [] }];
      const files = exportCSV(runDir, noTables);
      expect(files).toHaveLength(0);
    });

    it('escapes double quotes in CSV', () => {
      const quoteResults = [{
        title: 'Test',
        url: '/',
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
