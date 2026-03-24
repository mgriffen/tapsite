#!/usr/bin/env node

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const server = new McpServer({ name: 'tapsite', version: '3.0.0' });

require('./tools/session')(server);
require('./tools/extraction')(server);
require('./tools/network')(server);
require('./tools/multipage')(server);
require('./tools/export')(server);
require('./tools/workflows')(server);

async function main() {
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
