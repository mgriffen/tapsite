#!/usr/bin/env node

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { getProfileFilter } = require('./profiles');
const { version } = require('../package.json');

const instructions = `tapsite is a headless-browser web intelligence toolkit. Use it to inspect, extract from, audit, or compare live web pages — it runs real Chromium, evaluates JS, and handles auth.

REACH FOR TAPSITE WHEN:
- Extracting anything from a rendered page (design tokens, content, tables, forms, metadata, links, images, SVGs, icons)
- Auditing a page (a11y, WCAG contrast, perf/Web Vitals, SEO metadata, security headers/CSP, PWA readiness)
- Detecting tech (framework stack, third-party scripts, web components, GraphQL, WASM, AI/ML libs, canvas libs, i18n)
- Comparing sites or tracking a site over time (tapsite_diff_pages)
- Crawling or migrating (tapsite_crawl, tapsite_harvest)
- Driving an authenticated browser session (login_manual → inspect → interact → extract)

SKIP TAPSITE FOR:
- Simple HTTP fetches of static JSON/HTML where no JS execution is needed (use WebFetch)
- Reading docs for a library or API (use context7)
- Google search / discovery (use WebSearch)

PREFER COMPOSITE WORKFLOWS over chaining single extractors:
- tapsite_teardown — competitive design breakdown (colors + fonts + spacing + shadows + components + stack + perf + a11y in one call)
- tapsite_audit — pre-launch scorecard (a11y, contrast, perf, SEO metadata, dark mode, forms, security)
- tapsite_designsystem — W3C design tokens + CSS vars exported to disk
- tapsite_harvest — multi-page migration asset inventory (crawls + extracts content/images/forms/fonts)
- tapsite_diff_pages — cross-site or temporal comparison with regression highlighting
- tapsite_export / tapsite_export_design_report — Markdown + HTML + JSON + screenshots to disk

AUTH SESSIONS:
For login-required sites: tapsite_login_manual (headed browser for MFA) → tapsite_login_check → then run extractors against the authenticated session. Close with tapsite_close when done.

OUTPUT:
Large results write to disk under output/<workflow>-<timestamp>/. The tool response returns paths + summary.

CUSTOM EXTRACTION:
If no extractor fits, tapsite_extract_schema_suggest analyzes the DOM for repeated patterns and returns a CSS selector schema you can refine and pass to tapsite_extract_custom.`;

const server = new McpServer({ name: 'tapsite', version }, { instructions });

const allowTool = getProfileFilter(process.argv);

require('./tools/session')(server);
require('./tools/extraction')(server, allowTool);
require('./tools/network')(server, allowTool);
require('./tools/multipage')(server, allowTool);
require('./tools/export')(server, allowTool);
require('./tools/workflows')(server, allowTool);

function checkForUpdates() {
  const currentVersion = require('../package.json').version;
  fetch('https://registry.npmjs.org/tapsite/latest', { signal: AbortSignal.timeout(5000) })
    .then(r => r.json())
    .then(data => {
      if (data.version && data.version !== currentVersion) {
        process.stderr.write(
          `\n[tapsite] Update available: ${currentVersion} → ${data.version}\n` +
          `[tapsite] Run: git pull && docker compose build\n\n`
        );
      }
    })
    .catch(() => {}); // silently ignore network errors
}

async function main() {
  checkForUpdates();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);

async function shutdown() {
  const { closeBrowser } = require('./browser');
  await closeBrowser();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
