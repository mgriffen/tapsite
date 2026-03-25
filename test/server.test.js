import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');

let server;
let client;
let transport;

describe('MCP Server Integration', () => {
  beforeAll(async () => {
    server = new McpServer({ name: 'tapsite-test', version: '3.0.0' });

    require('../src/tools/session')(server);
    require('../src/tools/extraction')(server);
    require('../src/tools/network')(server);
    require('../src/tools/multipage')(server);
    require('../src/tools/export')(server);
    require('../src/tools/workflows')(server);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    transport = { client: clientTransport, server: serverTransport };

    client = new Client({ name: 'test-client', version: '1.0.0' });

    await server.connect(transport.server);
    await client.connect(transport.client);
  });

  afterAll(async () => {
    const browser = require('../src/browser');
    await browser.closeBrowser();
    await client?.close();
    await server?.close();
  });

  it('lists all 52 tools', async () => {
    const result = await client.listTools();
    expect(result.tools.length).toBe(52);
  });

  it('all tools have descriptions', async () => {
    const result = await client.listTools();
    for (const tool of result.tools) {
      expect(tool.description, `${tool.name} missing description`).toBeTruthy();
    }
  });

  it('all tool names start with tapsite_', async () => {
    const result = await client.listTools();
    for (const tool of result.tools) {
      expect(tool.name).toMatch(/^tapsite_/);
    }
  });


  it('tapsite_close succeeds even when no browser is open', async () => {
    const result = await client.callTool({
      name: 'tapsite_close',
      arguments: {},
    });
    expect(result.content[0].text).toBeDefined();
  });

  it('tapsite_diff_pages accepts url1 required, url2 and extractors optional', async () => {
    const result = await client.listTools();
    const diff = result.tools.find(t => t.name === 'tapsite_diff_pages');
    expect(diff).toBeDefined();
    const schema = diff.inputSchema;
    expect(schema.properties.url1).toBeDefined();
    expect(schema.properties.url2).toBeDefined();
    expect(schema.properties.extractors).toBeDefined();
    expect(schema.required).toContain('url1');
    expect(schema.required).not.toContain('url2');
  });
});
