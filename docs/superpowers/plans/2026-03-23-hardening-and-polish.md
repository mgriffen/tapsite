# tapsite Hardening & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the highest-severity reliability, security, and UX gaps identified in the product critique, without adding new features.

**Architecture:** Seven focused tasks across server lifecycle (graceful shutdown), security (SSRF protection, per-tool timeouts), agent UX (workflow descriptions, error taxonomy), and testing (tool integration tests). Each task is independently committable and testable.

**Tech Stack:** Node.js, Playwright, vitest, @modelcontextprotocol/sdk

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/server.js` | Modify | Add SIGINT/SIGTERM shutdown handlers |
| `src/helpers.js` | Modify | Add `withTimeout()` wrapper, SSRF blocklist in `requireSafeUrl()`, error taxonomy |
| `src/tools/workflows.js` | Modify | Add extractor lists to workflow tool descriptions |
| `src/tools/extraction.js` | Modify | Wrap `page.evaluate()` calls with timeout |
| `src/tools/session.js` | Modify | Wrap `page.evaluate()` calls with timeout |
| `src/tools/network.js` | Modify | Wrap `page.evaluate()` calls with timeout |
| `src/tools/multipage.js` | Modify | Wrap `page.evaluate()` calls with timeout |
| `src/tools/export.js` | Modify | Wrap `page.evaluate()` calls with timeout |
| `src/config.js` | Modify | Add `EVAL_TIMEOUT_MS` constant |
| `test/helpers.test.js` | Modify | Add tests for SSRF blocklist, `withTimeout()` |
| `test/server.test.js` | Create | Integration tests: MCP server starts, tool list, tool execution against fixture |
| `test/fixtures/simple.html` | Check | Existing fixture for integration tests |
| `.github/workflows/ci.yml` | Modify | Add `npm audit` step |

---

### Task 1: Graceful Shutdown

Server currently has no signal handlers. When Claude Code kills the MCP process, Chromium can orphan and the persistent profile in `profiles/default/` can corrupt.

**Files:**
- Modify: `src/server.js`

- [ ] **Step 1: Write the shutdown handler**

Add signal handlers after `main()`. These close the browser context cleanly before exiting.

In `src/server.js`, replace:

```js
main().catch(console.error);
```

with:

```js
main().catch(console.error);

async function shutdown() {
  const { closeBrowser } = require('./browser');
  await closeBrowser();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

- [ ] **Step 2: Verify server starts and stops cleanly**

Run:
```bash
node src/server.js &
SERVER_PID=$!
sleep 2
kill $SERVER_PID
wait $SERVER_PID 2>/dev/null
echo "Exit code: $?"
```

Expected: process exits with code 0, no orphaned Chromium process.

- [ ] **Step 3: Commit**

```bash
git add src/server.js
git commit -m "fix: add graceful shutdown handlers for SIGINT/SIGTERM"
```

---

### Task 2: SSRF Protection for Private IPs

`requireSafeUrl()` blocks `file://` and `javascript://` but allows `http://192.168.1.1`, `http://127.0.0.1`, `http://169.254.169.254` (AWS metadata endpoint). This is a real SSRF vector if tapsite runs in cloud/Docker.

**Files:**
- Modify: `src/helpers.js`
- Modify: `test/helpers.test.js`

- [ ] **Step 1: Write failing tests for blocked IPs**

Add to `test/helpers.test.js` inside a new `describe('requireSafeUrl')` block:

```js
import { requireSafeUrl } from '../src/helpers.js';

describe('requireSafeUrl', () => {
  it('allows normal HTTP URLs', () => {
    expect(() => requireSafeUrl('https://example.com')).not.toThrow();
  });

  it('blocks file:// scheme', () => {
    expect(() => requireSafeUrl('file:///etc/passwd')).toThrow('Blocked URL');
  });

  it('blocks javascript: scheme', () => {
    expect(() => requireSafeUrl('javascript:alert(1)')).toThrow('Blocked URL');
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
```

- [ ] **Step 2: Run tests to verify failures**

Run: `npx vitest run test/helpers.test.js`

Expected: localhost, 10.x, 172.16.x, 192.168.x, 169.254.x, ::1, and 0.0.0.0 tests FAIL (currently allowed).

- [ ] **Step 3: Implement the SSRF blocklist**

In `src/helpers.js`, replace the `requireSafeUrl` function with:

```js
function requireSafeUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid URL: ${urlStr}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme "${parsed.protocol}" — only http: and https: are allowed`);
  }
  const hostname = parsed.hostname;
  // Block loopback
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1' || hostname === '0.0.0.0') {
    throw new Error(`Blocked private/loopback address "${hostname}"`);
  }
  // Block private and link-local IPv4 ranges
  const ipv4 = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0) {
      throw new Error(`Blocked private/internal IP "${hostname}"`);
    }
  }
  return parsed;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/helpers.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `npm test`

Expected: 119 + new tests all PASS. No regressions.

- [ ] **Step 6: Commit**

```bash
git add src/helpers.js test/helpers.test.js
git commit -m "security: block private/loopback IPs in requireSafeUrl (SSRF protection)"
```

---

### Task 3: Per-Tool Timeout for `page.evaluate()`

A malicious or slow page can hang `page.evaluate()` indefinitely, blocking the entire MCP server. Wrap all evaluate calls with a timeout.

**Files:**
- Modify: `src/config.js`
- Modify: `src/helpers.js`
- Modify: `test/helpers.test.js`
- Modify: `src/tools/extraction.js`
- Modify: `src/tools/session.js`
- Modify: `src/tools/network.js`
- Modify: `src/tools/multipage.js`
- Modify: `src/tools/export.js`
- Modify: `src/tools/workflows.js`

- [ ] **Step 1: Add timeout constant to config**

In `src/config.js`, add:

```js
EVAL_TIMEOUT_MS: 30000,
```

- [ ] **Step 2: Write the `safeEvaluate` helper and its test**

Add to `test/helpers.test.js`:

```js
import { safeEvaluate } from '../src/helpers.js';

describe('safeEvaluate', () => {
  it('returns result when evaluate completes in time', async () => {
    const mockPage = {
      evaluate: async (fn, arg) => fn(arg),
    };
    const result = await safeEvaluate(mockPage, (x) => x * 2, 5);
    expect(result).toBe(10);
  });

  it('throws on timeout', async () => {
    const mockPage = {
      evaluate: () => new Promise(() => {}), // never resolves
    };
    await expect(safeEvaluate(mockPage, () => {}, null, 50)).rejects.toThrow('timed out');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/helpers.test.js`

Expected: FAIL — `safeEvaluate` not exported.

- [ ] **Step 4: Implement `safeEvaluate` in helpers.js**

Add to `src/helpers.js` before the `module.exports`:

```js
async function safeEvaluate(page, fn, arg, timeoutMs) {
  const timeout = timeoutMs || config.EVAL_TIMEOUT_MS;
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`page.evaluate() timed out after ${timeout}ms`)), timeout);
  });
  try {
    return await Promise.race([
      page.evaluate(fn, arg),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
```

Add `safeEvaluate` to the `module.exports` object.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/helpers.test.js`

Expected: PASS.

- [ ] **Step 6: Replace `page.evaluate()` calls in tool modules**

In each tool module file, replace `browser.page.evaluate(extractFn, args)` calls with `safeEvaluate(browser.page, extractFn, args)`.

Import pattern — add to each file's require block:

```js
const { safeEvaluate } = require('../helpers');
```

Files to update (search for `browser.page.evaluate` in each):

- `src/tools/extraction.js` — all `browser.page.evaluate()` calls
- `src/tools/session.js` — `inspectPageV2` call in `tapsite_inspect`
- `src/tools/network.js` — `detectStackInBrowser` call
- `src/tools/multipage.js` — evaluate calls in crawl and diff
- `src/tools/export.js` — evaluate calls in export tools
- `src/tools/workflows.js` — all evaluate calls in teardown, audit, harvest, designsystem

Pattern: find-and-replace `await browser.page.evaluate(` with `await safeEvaluate(browser.page,` in each file. The function signature `(fn, arg)` is identical.

Note: `src/tools/multipage.js` has some inline `page.evaluate(() => ...)` calls (e.g., link extraction in crawl). These use arrow functions — `safeEvaluate` handles them the same way since the second argument to `page.evaluate` is optional.

For calls with no argument like `await browser.page.evaluate(detectStackInBrowser)`, call as `await safeEvaluate(browser.page, detectStackInBrowser)` — the `arg` parameter defaults to `undefined`.

- [ ] **Step 7: Run full test suite**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 8: Verify server loads**

Run: `node -e "require('./src/server.js')"`

Expected: no errors (process hangs on stdin — that's correct for MCP stdio transport, Ctrl+C to exit).

- [ ] **Step 9: Commit**

```bash
git add src/config.js src/helpers.js test/helpers.test.js src/tools/extraction.js src/tools/session.js src/tools/network.js src/tools/multipage.js src/tools/export.js src/tools/workflows.js
git commit -m "reliability: add 30s timeout to all page.evaluate() calls via safeEvaluate"
```

---

### Task 4: Workflow Tool Descriptions

The workflow tools (`tapsite_teardown`, `tapsite_audit`, `tapsite_harvest`, `tapsite_designsystem`) don't tell the agent which extractors they run. An agent can't decide between `tapsite_teardown` and calling individual extractors without reading source code.

**Files:**
- Modify: `src/tools/workflows.js`

- [ ] **Step 1: Update tool descriptions**

Replace the description strings (second argument to `server.tool()`) for each workflow tool:

**tapsite_teardown** — replace:
```
'Competitive design teardown: extracts full design system, tech stack, performance, and accessibility in one call.'
```
with:
```
'Competitive design teardown — runs colors, fonts, CSS vars, spacing, shadows, components, breakpoints, animations, icons, stack detection, perf, a11y, contrast, and dark mode in one call. Returns a combined summary.'
```

**tapsite_audit** — replace:
```
'Pre-launch quality check: accessibility, performance, SEO, contrast, dark mode, and forms.'
```
with:
```
'Pre-launch quality audit with scorecard — runs a11y, contrast, perf, metadata (SEO), dark mode, and forms. Returns pass/fail per category with an overall score out of 100.'
```

**tapsite_harvest** — replace:
```
'Migration asset inventory: crawls site for content, images, SVGs, favicons, fonts, links, and forms.'
```
with:
```
'Migration asset inventory — crawls up to maxPages pages and extracts content, images, SVGs, forms, fonts, and links per page. Returns per-page counts and a link map. Output written to output/harvest-{ts}/.'
```

**tapsite_designsystem** — replace:
```
'Full design token extraction: colors, fonts, spacing, shadows, CSS vars, breakpoints, animations, icons. Exports as W3C tokens + CSS.'
```
with:
```
'Design system extraction — runs colors, fonts, spacing, shadows, CSS vars, breakpoints, animations, icons, and components. Exports W3C design-tokens.json, design-tokens.css, and raw-data.json to output/design-system-{ts}/.'
```

- [ ] **Step 2: Verify server loads**

Run: `node -e "require('./src/server.js')"`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/workflows.js
git commit -m "docs: add extractor lists to workflow tool descriptions for agent discoverability"
```

---

### Task 5: Navigation Error Logging

`navigateIfNeeded()` in `src/helpers.js` catches all navigation errors silently with an empty `catch {}`. When a page 404s or times out, there's zero diagnostic output anywhere. This makes debugging extraction failures difficult.

This task logs errors to stderr (which doesn't interfere with MCP stdio on stdin/stdout). A future improvement could surface errors in tool responses, but that's a larger change requiring all callers to check return values.

**Files:**
- Modify: `src/helpers.js`

- [ ] **Step 1: Update `navigateIfNeeded` to log errors to stderr**

In `src/helpers.js`, replace:

```js
async function navigateIfNeeded(url, waitMs = 1500) {
  if (!url) return;
  requireSafeUrl(url);
  try {
    await browser.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch {}
  await browser.page.waitForTimeout(waitMs);
}
```

with:

```js
async function navigateIfNeeded(url, waitMs = 1500) {
  if (!url) return;
  requireSafeUrl(url);
  try {
    const response = await browser.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    if (response && response.status() >= 400) {
      console.error(`[tapsite] Navigation warning: ${url} returned HTTP ${response.status()}`);
    }
  } catch (err) {
    console.error(`[tapsite] Navigation error for ${url}: ${err.message}`);
  }
  await browser.page.waitForTimeout(waitMs);
}
```

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: all tests PASS (no tests call `navigateIfNeeded` directly — it requires a real browser).

- [ ] **Step 3: Commit**

```bash
git add src/helpers.js
git commit -m "fix: log navigation errors to stderr instead of swallowing silently"
```

---

### Task 6: Add `npm audit` to CI

CI currently runs tests but never checks for known vulnerabilities in dependencies.

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add audit step**

In `.github/workflows/ci.yml`, add after the `npm test` step:

```yaml
      - name: Security audit
        run: npm audit --omit=dev
```

The `--omit=dev` flag skips devDependencies (vitest) since those never run in production.

- [ ] **Step 2: Verify CI config is valid YAML**

Run: `node -e "require('fs').readFileSync('.github/workflows/ci.yml', 'utf8')" && echo "valid"`

Expected: `valid` (no parse error).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add npm audit for production dependency security checks"
```

---

### Task 7: MCP Server Integration Test

119 tests exist but none test the actual MCP protocol — server startup, tool listing, or tool execution. This is the biggest testing gap.

**Files:**
- Create: `test/server.test.js`
- Check: `test/fixtures/` (existing fixtures)

- [ ] **Step 1: Verify existing fixture exists**

Run: `ls test/fixtures/`

We need a simple HTML file. `test/fixtures/content.html` should already exist from Phase 0B.

- [ ] **Step 2: Write integration test file**

Create `test/server.test.js`:

```js
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

    // Register all tool modules
    require('../src/tools/session')(server);
    require('../src/tools/extraction')(server);
    require('../src/tools/network')(server);
    require('../src/tools/multipage')(server);
    require('../src/tools/export')(server);
    require('../src/tools/workflows')(server);

    // Create in-memory transport pair
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

  it('lists all 43 tools', async () => {
    const result = await client.listTools();
    expect(result.tools.length).toBe(43);
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

  it('tapsite_login rejects when TAPSITE_ALLOW_AUTO_LOGIN is unset', async () => {
    delete process.env.TAPSITE_ALLOW_AUTO_LOGIN;
    const result = await client.callTool({
      name: 'tapsite_login',
      arguments: { url: 'https://example.com', username: 'test', password: 'test' },
    });
    expect(result.content[0].text).toContain('disabled by default');
  });

  it('tapsite_close succeeds even when no browser is open', async () => {
    const result = await client.callTool({
      name: 'tapsite_close',
      arguments: {},
    });
    expect(result.content[0].text).toBeDefined();
  });
});
```

- [ ] **Step 3: Run integration test**

Run: `npx vitest run test/server.test.js`

Expected: all tests PASS. The `InMemoryTransport` class is provided by the MCP SDK — if it's not available at that import path, check `@modelcontextprotocol/sdk` exports and adjust the import. The SDK may export it as `@modelcontextprotocol/sdk/inMemory.js` or similar — check `node_modules/@modelcontextprotocol/sdk/` for the correct path.

- [ ] **Step 4: Run full test suite**

Run: `npm test`

Expected: all tests PASS (old + new).

- [ ] **Step 5: Commit**

```bash
git add test/server.test.js
git commit -m "test: add MCP server integration tests — tool listing, descriptions, login gate"
```

---

## Verification Checklist

After all 7 tasks are committed, run these checks:

- [ ] `npm test` — all tests pass (119 existing + new tests)
- [ ] `node -e "require('./src/server.js')"` — server loads without errors
- [ ] `node -e "const h = require('./src/helpers'); h.requireSafeUrl('http://192.168.1.1')"` — throws SSRF error
- [ ] `node -e "const h = require('./src/helpers'); h.requireSafeUrl('https://example.com')"` — succeeds
- [ ] `git log --oneline -7` — 7 clean commits, one per task
