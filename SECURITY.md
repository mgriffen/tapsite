# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in tapsite, please report it privately:

**Email:** gr1ff3n.dev@gmail.com
**Subject line:** `[tapsite security] <brief description>`

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

**Do not** open a public GitHub issue for security vulnerabilities.

## Threat Model

tapsite is an MCP server that controls a real browser via Playwright. It extracts structured data from web pages and returns it to an LLM. This creates a unique attack surface: **untrusted web content flows through the tool and back to the LLM as trusted context.**

### Actors

| Actor | Trust Level | Capability |
|-------|-------------|------------|
| **LLM (Claude)** | Semi-trusted | Decides which tools to call and with what parameters. Can be influenced by prompt injection in web content. |
| **Web pages** | Untrusted | Serve arbitrary HTML, CSS, JS. Can embed invisible text designed to manipulate the LLM. |
| **MCP client user** | Trusted | Configures the server, provides URLs, approves tool calls. |
| **Network** | Untrusted | MITM possible on HTTP; HTTPS enforced by default (`ignoreHTTPSErrors: false`). |

### Attack Scenarios

1. **Prompt injection via web content** — A page embeds hidden text like "ignore previous instructions" in invisible elements, hoping it flows into the LLM context and changes its behavior.

2. **SSRF via URL parameters** — The LLM (or a manipulated LLM) passes `file://`, `javascript:`, or internal network URLs to navigation or download tools, attempting to exfiltrate local files or scan internal services.

3. **Credential leakage** — Login credentials passed through MCP tool parameters appear in transport logs and session transcripts.

4. **Resource exhaustion** — Unbounded crawls, network captures, or download operations consume disk space, memory, or time.

5. **Data exfiltration via extraction** — Hidden form fields, auth headers, or CSRF tokens extracted from pages and returned to the LLM could leak to logs or third parties.

## Security Architecture

### Defense Layer 1: Hidden Element Filtering (Browser Context)

All content extraction functions include an `isHiddenElement()` check that runs inside `page.evaluate()`. It filters elements that are:

- `display: none`
- `visibility: hidden` or `collapse`
- `opacity: 0`
- Zero-size with `overflow: hidden`
- Clipped via `clip: rect(0,0,0,0)` or `clip-path: inset(100%)`
- Positioned offscreen with dimensions < 2px

This blocks the most common prompt injection vector: invisible text embedded in the DOM.

Applied in: `extractContentInBrowser`, `extractFormsInBrowser`, `extractA11yInBrowser`, link extractors, `extractInteractiveElements` (inspector).

### Defense Layer 2: Prompt Injection Sanitizer (Node.js)

`sanitizeForLLM()` in `src/sanitizer.js` scans all text returned to the LLM for injection patterns:

- Direct instruction overrides ("ignore previous instructions")
- System prompt leaking ("reveal your system prompt")
- Role hijacking ("you are now a", "new instructions:")
- Exfiltration attempts ("send to http://", "curl", "fetch(")
- Tool manipulation ("run this command:", "IMPORTANT:", "CRITICAL:")

Matches are flagged inline as `[INJECTION_DETECTED: ...]` with a visible warning header. Content is not silently dropped — the user and LLM can see what was detected.

Applied at: every text return path (`summarizeResult`, `formatIndexResult`, `tapsite_run_js` output).

### Defense Layer 3: URL Validation

`requireSafeUrl()` in `src/helpers.js` blocks non-`http:`/`https:` URL schemes. Applied to:

- All navigation (`navigateIfNeeded`, direct `page.goto` calls)
- All download operations (images, SVGs, favicons, manifest icons)

This prevents `file://`, `javascript:`, `data:`, and other dangerous schemes from being used for SSRF or local file access.

### Defense Layer 4: Input Validation (Zod Schemas)

All tool inputs are validated with Zod schemas:

- CSS selectors: `.max(500)` length limit; `querySelector()` wrapped in try-catch
- Crawl bounds: `maxPages` 1-100, `maxDepth` 0-10
- Network capture duration: 1-60 seconds
- Download limits: images/SVGs max 200 per operation
- Filter strings: `.max(500)` length limits
- HTTP methods: enum validation (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)

### Defense Layer 5: Sensitive Data Protection

- **Auth headers redacted**: `Authorization`, `Cookie`, `Set-Cookie`, `X-Auth-Token`, `X-API-Key`, `X-CSRF-Token` are replaced with `[REDACTED]` in network capture output.
- **Hidden form field values not extracted**: Only `hidden: true` and `csrf: true` flags are returned — actual token values are never exposed.
- **JSON on disk sanitized**: `summarizeResult()` applies recursive `sanitizeForLLM()` to all data before writing JSON files.
- **Markdown export sanitized**: `compressedDOM` content is run through `sanitizeForLLM()` before embedding.

### Defense Layer 6: Resource Limits

- Crawl operations: 5-minute overall timeout, 50 MB total output cap
- Network capture: 60-second maximum duration
- Download operations: hard caps on file counts (200 images, 200 SVGs)
- DOM output: `MAX_DOM_LENGTH` (8000 chars), `MAX_ELEMENTS` (200) in config

### Browser Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| `ignoreHTTPSErrors` | `false` | Enforce TLS certificate validation |
| `acceptDownloads` | `false` | Prevent file downloads to disk |
| Persistent context | `profiles/default/` | Session cookies survive across runs (gitignored) |
| Headless mode | Default for MCP | Headed mode only for `tapsite_login_manual` |

## What tapsite Does NOT Protect Against

- **Malicious MCP client**: If the MCP client itself is compromised, it can send arbitrary tool calls. tapsite assumes the MCP transport is trusted.
- **Browser exploits**: If a page exploits a Chromium vulnerability to escape the browser sandbox, tapsite cannot prevent that. Keep Playwright/Chromium updated.
- **Targeted prompt injection**: Sophisticated injection that evades regex-based pattern matching. The sanitizer catches common patterns but is not a complete defense against adversarial content.
- **Credential theft via headed browser**: When using `tapsite_login_manual`, the user types credentials into a real browser. Malicious pages could use phishing techniques (fake login forms, overlays).

## Recommended Deployment Practices

1. **Use `tapsite_login_manual`** for all authentication — never pass credentials through MCP tool parameters.
2. **Set `cleanupPeriodDays: 1`** in Claude settings to minimize credential exposure in session transcripts.
3. **Keep Playwright updated** — run `npx playwright install chromium` periodically for security patches.
4. **Docker deployments** are headless-only — `tapsite_login_manual` (headed mode) is not available in containers. Pre-authenticate by mounting a `profiles/` directory with existing session cookies.
5. **Review extraction output** before sharing — extracted data may contain sensitive information from the target site despite sanitization.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 3.x     | Yes       |
| < 3.0   | No        |
