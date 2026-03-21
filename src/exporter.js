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
        if (t.headers?.length) {
          lines.push(`| ${t.headers.join(' | ')} |`);
          lines.push(`| ${t.headers.map(() => '---').join(' | ')} |`);
          if (t.rows?.length) {
            for (const row of t.rows) {
              lines.push(`| ${row.join(' | ')} |`);
            }
          }
        }
        if (t.rowCount > (t.rows?.length || 0)) {
          lines.push(`*${t.rowCount - (t.rows?.length || 0)} more rows omitted*`);
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
 * Export all page results as a visual HTML report.
 */
function exportHTML(runDir, results) {
  const date = new Date().toISOString();
  let sections = '';

  for (const [i, pg] of results.entries()) {
    let html = `<section class="page">
      <h2>Page ${i + 1}: ${escapeHtml(pg.title || '(no title)')}</h2>
      <p class="url"><a href="${escapeHtml(pg.url)}">${escapeHtml(pg.url)}</a></p>
      <img src="screenshots/page-${i + 1}.png" alt="Screenshot of ${escapeHtml(pg.url)}">`;

    if (pg.navItems?.length) {
      html += `<h3>Navigation</h3><ul>${pg.navItems.map(n =>
        `<li><a href="${escapeHtml(n.href)}">${escapeHtml(n.text)}</a></li>`).join('')}</ul>`;
    }

    if (pg.headings?.length) {
      html += `<h3>Headings</h3><ul>${pg.headings.map(h =>
        `<li><code>h${h.level}</code> ${escapeHtml(h.text)}</li>`).join('')}</ul>`;
    }

    if (pg.tables?.length) {
      for (const t of pg.tables) {
        html += `<h3>Table${t.caption ? ': ' + escapeHtml(t.caption) : ''}</h3>`;
        if (t.headers?.length) {
          html += `<table><thead><tr>${t.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`;
          if (t.rows?.length) {
            html += `<tbody>${t.rows.map(r =>
              `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
          }
          html += '</table>';
        }
      }
    }

    if (pg.formFields?.length) {
      html += `<h3>Form Fields</h3><table><thead><tr><th>Type</th><th>Name</th><th>Label</th></tr></thead><tbody>`;
      html += pg.formFields.map(f =>
        `<tr><td>${escapeHtml(f.type)}</td><td>${escapeHtml(f.name || '')}</td><td>${escapeHtml(f.label || '')}</td></tr>`
      ).join('');
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
  <title>Dashboard Inspection Report</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 960px; margin: 0 auto; padding: 2rem; color: #222; }
    h1 { font-size: 1.6rem; }
    h2 { font-size: 1.3rem; border-bottom: 2px solid #eee; padding-bottom: .4rem; margin-top: 2.5rem; }
    h3 { font-size: 1rem; color: #555; margin-top: 1.2rem; }
    .url { font-size: .85rem; color: #666; }
    img { max-width: 100%; border: 1px solid #ddd; border-radius: 4px; margin: 1rem 0; }
    table { border-collapse: collapse; width: 100%; font-size: .9rem; margin: .5rem 0; }
    th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
    th { background: #f5f5f5; }
    footer { color: #aaa; font-size: .8rem; margin-top: 3rem; border-top: 1px solid #eee; padding-top: 1rem; }
  </style>
</head>
<body>
  <h1>Dashboard Inspection Report</h1>
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
