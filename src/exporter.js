const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Create a timestamped output directory for this run.
 */
function createRunDir() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = path.join(config.OUTPUT_DIR, `run-${timestamp}`);
  fs.mkdirSync(path.join(runDir, 'screenshots'), { recursive: true });
  return runDir;
}

/**
 * Save a screenshot for a page result.
 */
function screenshotPath(runDir, index) {
  return path.join(runDir, 'screenshots', `page-${index + 1}.png`);
}

/**
 * Export all page results as JSON.
 */
function exportJSON(runDir, results) {
  const filePath = path.join(runDir, 'results.json');
  fs.writeFileSync(filePath, JSON.stringify(results, null, 2));
  return filePath;
}

/**
 * Export all page results as a Markdown report.
 */
function exportMarkdown(runDir, results) {
  const lines = ['# Dashboard Inspection Report', ''];
  lines.push(`**Date:** ${new Date().toISOString()}`, '');
  lines.push(`**Pages inspected:** ${results.length}`, '');
  lines.push('---', '');

  for (const [i, page] of results.entries()) {
    lines.push(`## Page ${i + 1}: ${page.title || '(no title)'}`, '');
    lines.push(`**URL:** ${page.url}`, '');
    lines.push(`![Screenshot](screenshots/page-${i + 1}.png)`, '');

    if (page.navItems?.length) {
      lines.push('### Navigation', '');
      for (const nav of page.navItems) {
        lines.push(`- [${nav.text}](${nav.href})`);
      }
      lines.push('');
    }

    if (page.headings?.length) {
      lines.push('### Headings', '');
      for (const h of page.headings) {
        lines.push(`- ${'#'.repeat(h.level)} ${h.text}`);
      }
      lines.push('');
    }

    if (page.buttons?.length) {
      lines.push('### Buttons', '');
      for (const b of page.buttons) {
        lines.push(`- \`${b}\``);
      }
      lines.push('');
    }

    if (page.formFields?.length) {
      lines.push('### Form Fields', '');
      lines.push('| Type | Name | Label |');
      lines.push('|------|------|-------|');
      for (const f of page.formFields) {
        lines.push(`| ${f.type} | ${f.name || ''} | ${f.label || ''} |`);
      }
      lines.push('');
    }

    if (page.tables?.length) {
      lines.push('### Tables', '');
      for (const t of page.tables) {
        if (t.caption) lines.push(`**${t.caption}**`);
        if (t.headers.length) {
          lines.push(`Columns: ${t.headers.join(', ')}`);
        }
        lines.push('');
      }
    }

    lines.push('---', '');
  }

  const filePath = path.join(runDir, 'report.md');
  fs.writeFileSync(filePath, lines.join('\n'));
  return filePath;
}

module.exports = { createRunDir, screenshotPath, exportJSON, exportMarkdown };
