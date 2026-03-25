#!/usr/bin/env node

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { getProfileFilter } = require('./profiles');

const server = new McpServer({ name: 'tapsite', version: '4.5.0' });

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
