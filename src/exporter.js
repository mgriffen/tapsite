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
 * Export all page results as a Markdown report (v2 inspector shape).
 * Expects items with { title, url, compressedDOM, elements, inspectedAt }.
 */
function exportMarkdown(runDir, results) {
  const lines = ['# Page Inspection Report', ''];
  lines.push(`**Date:** ${new Date().toISOString()}`, '');
  lines.push(`**Pages inspected:** ${results.length}`, '');
  lines.push('---', '');

  for (const [i, page] of results.entries()) {
    lines.push(`## Page ${i + 1}: ${page.title || '(no title)'}`, '');
    lines.push(`**URL:** ${page.url}`, '');
    lines.push(`**Inspected at:** ${page.inspectedAt || ''}`, '');
    lines.push(`![Screenshot](screenshots/page-${i + 1}.png)`, '');

    if (page.compressedDOM) {
      lines.push('### Page Structure', '');
      lines.push('```');
      lines.push(page.compressedDOM);
      lines.push('```', '');
    }

    if (page.elements?.length) {
      lines.push('### Interactive Elements', '');
      lines.push(`| # | Tag | Text / Label | Href |`);
      lines.push(`|---|-----|--------------|------|`);
      for (const el of page.elements) {
        const text = (el.text || el.placeholder || el.name || '').replace(/\|/g, '\\|');
        const href = el.href ? el.href.replace(/\|/g, '\\|') : '';
        lines.push(`| ${el.index} | \`${el.tag}\` | ${text} | ${href} |`);
      }
      lines.push('');
    }

    lines.push('---', '');
  }

  const filePath = path.join(runDir, 'report.md');
  fs.writeFileSync(filePath, lines.join('\n'));
  return filePath;
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Export all page results as a visual HTML report (v2 inspector shape).
 * Expects items with { title, url, compressedDOM, elements, inspectedAt }.
 */
function exportHTML(runDir, results) {
  const date = new Date().toISOString();
  let sections = '';

  for (const [i, pg] of results.entries()) {
    let html = `<section class="page">
      <h2>Page ${i + 1}: ${escapeHtml(pg.title || '(no title)')}</h2>
      <p class="url"><a href="${escapeHtml(pg.url)}">${escapeHtml(pg.url)}</a></p>
      <p class="meta">Inspected at: ${escapeHtml(pg.inspectedAt || '')}</p>
      <img src="screenshots/page-${i + 1}.png" alt="Screenshot of ${escapeHtml(pg.url)}">`;

    if (pg.compressedDOM) {
      html += `<h3>Page Structure</h3><pre class="dom">${escapeHtml(pg.compressedDOM)}</pre>`;
    }

    if (pg.elements?.length) {
      html += `<h3>Interactive Elements <span class="count">${pg.elements.length}</span></h3>
      <table><thead><tr><th>#</th><th>Tag</th><th>Text / Label</th><th>Href</th></tr></thead><tbody>`;
      for (const el of pg.elements) {
        const text = el.text || el.placeholder || el.name || '';
        const href = el.href ? `<a href="${escapeHtml(el.href)}">${escapeHtml(el.href.slice(0, 60))}</a>` : '';
        html += `<tr><td>${el.index}</td><td><code>${escapeHtml(el.tag)}</code></td><td>${escapeHtml(text)}</td><td>${href}</td></tr>`;
      }
      html += '</tbody></table>';
    }

    html += '</section>';
    sections += html;
  }

  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Page Inspection Report</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 960px; margin: 0 auto; padding: 2rem; color: #222; }
    h1 { font-size: 1.6rem; }
    h2 { font-size: 1.3rem; border-bottom: 2px solid #eee; padding-bottom: .4rem; margin-top: 2.5rem; }
    h3 { font-size: 1rem; color: #555; margin-top: 1.2rem; display: flex; align-items: center; gap: .4rem; }
    .url { font-size: .85rem; color: #666; }
    .meta { font-size: .8rem; color: #999; margin-top: -.5rem; }
    img { max-width: 100%; border: 1px solid #ddd; border-radius: 4px; margin: 1rem 0; }
    table { border-collapse: collapse; width: 100%; font-size: .9rem; margin: .5rem 0; }
    th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
    th { background: #f5f5f5; }
    code { font-family: ui-monospace, monospace; font-size: .8rem; background: #f3f4f6; padding: .1rem .3rem; border-radius: 3px; }
    pre.dom { background: #f8f8f8; border: 1px solid #e5e7eb; border-radius: 6px; padding: 1rem; font-size: .78rem; font-family: ui-monospace, monospace; white-space: pre; overflow-x: auto; max-height: 400px; overflow-y: auto; }
    .count { font-size: .72rem; font-weight: 400; background: #f3f4f6; color: #6b7280; padding: .1rem .4rem; border-radius: 999px; }
    footer { color: #aaa; font-size: .8rem; margin-top: 3rem; border-top: 1px solid #eee; padding-top: 1rem; }
  </style>
</head>
<body>
  <h1>Page Inspection Report</h1>
  <p><strong>Date:</strong> ${date}</p>
  <p><strong>Pages inspected:</strong> ${results.length}</p>
  ${sections}
  <footer>Generated by tapsite</footer>
</body>
</html>`;

  const filePath = path.join(runDir, 'report.html');
  fs.writeFileSync(filePath, fullHtml);
  return filePath;
}

/**
 * Export table data from all pages as CSV files.
 * Returns array of written file paths.
 */
function exportCSV(runDir, results) {
  const files = [];
  for (const [pi, pg] of results.entries()) {
    if (!pg.tables?.length) continue;
    for (const [ti, table] of pg.tables.entries()) {
      if (!table.headers?.length) continue;
      const rows = [table.headers, ...(table.rows || [])];
      const csv = rows.map(row =>
        row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')
      ).join('\n');
      const filename = `table-p${pi + 1}-t${ti + 1}.csv`;
      const filePath = path.join(runDir, filename);
      fs.writeFileSync(filePath, csv);
      files.push(filePath);
    }
  }
  return files;
}

module.exports = { createRunDir, screenshotPath, exportJSON, exportMarkdown, exportHTML, exportCSV };
