# tapsite Development Roadmap

> Generated 2026-03-21 | Opus 4.6 strategic planning session
> Living document — update as decisions are made and phases complete.

---

## Strategic Assessment

### What tapsite actually is — and what it isn't

tapsite is not a browser automation tool. Playwright MCP, Puppeteer MCP, BrowserMCP, and every other MCP browser server give an AI the ability to *drive* a browser — click, type, navigate. That's table stakes. Microsoft ships Playwright MCP for free and it works fine for that.

tapsite's actual value proposition is **web intelligence extraction** — the ability to look at a web page and produce structured, actionable intelligence about its design system, accessibility posture, technology stack, API surface, content structure, and visual assets. The 37 tools include browser automation as a means to an end, but the differentiator is what happens *after* navigation: the extractors.

This distinction matters because it determines positioning, competition, and where to invest development effort. tapsite competes with Playwright MCP on browser automation (and will lose — Microsoft has infinite resources). It has **no meaningful competition** on structured web intelligence extraction via MCP. That's the moat.

**Recommendation:** Stop calling tapsite a "web intelligence toolkit" generically. Start calling it **"the MCP server for web intelligence extraction"** — design systems, accessibility auditing, competitive analysis, and migration prep. The browser automation tools (navigate, act, scroll, screenshot) are plumbing. The extractors are the product.

### Honest assessment of the three proposed directions

#### Docker MCP Deployment — Right idea, wrong priority

Docker solves installation friction, which matters. But tapsite's installation is three commands (`npm install`, `npx playwright install chromium`, `npx playwright install-deps chromium`). That's not the adoption bottleneck.

The actual adoption bottleneck is **discoverability**: nobody knows tapsite exists. Dockerizing an unknown tool doesn't make it known. And Docker introduces a real problem: `tapsite_login_manual` (headed browser for MFA) breaks in standard containers. The VNC workaround is fragile and adds complexity that undermines the "zero-dependency" promise.

**Better sequencing:** Publish to npm first (`npx tapsite-mcp`). This is simpler, reaches the same audience, and doesn't break headed mode. Docker comes later, positioned for CI/server use cases where headless-only is acceptable.

#### Browser Extension — Right idea, wrong time

The Extension-as-MCP-server approach (option A) is architecturally compelling — it eliminates the auth problem entirely by inheriting the user's real browser session. But it's a different product with a different codebase, different distribution channel (Chrome Web Store), different security model, and different maintenance burden. Building it now, before the core product has traction, tests, or a distribution strategy, means splitting focus between two products that both have zero users.

**The timing test:** Would you build a mobile app before the web app has users? The extension should be built when there's user demand that validates the approach — not before.

**Better sequencing:** Ship the core well. Get users. Listen to what they actually want. If auth friction is the #1 complaint, build the extension. If it's something else, build that instead.

#### Open Source Growth — This is the actual bottleneck

The project has a showcase site, a README, and zero distribution. No npm package. No presence in MCP directories. No blog posts. No community. No tests (which means no confidence for contributors). No CI. No CONTRIBUTING.md.

Growth isn't a "direction" — it's the prerequisite for the other two directions mattering. An unused Docker image and an uninstalled extension don't create value.

### What I would do differently

The three proposed directions are all *outward-facing*: how to package, how to distribute, how to grow. But the project's *inward-facing* foundation isn't ready to support outward expansion:

1. **Zero tests.** You can't accept contributions, refactor confidently, or claim reliability without them. Every Docker build, every extension release, every npm publish will ship code that has never been automatically verified.

2. **2000-line monolith.** `mcp-server.js` contains tool definitions, browser lifecycle management, network capture logic, HTML template strings for design reports, and the sanitization layer — all in one file. This is fine for solo development but blocks contributions and parallel work.

3. **Inconsistent hidden element filtering.** The `isHiddenElement()` function is copy-pasted 4+ times with slight variations. The links extractor in `tapsite_extract_links` uses a different `isHidden` function. The crawl tool inlines yet another variant. Inspector v1 (still used by `tapsite_export`) has no hidden element filtering at all. This is a security gap in a project that lists security as a core commitment.

4. **Version/license mismatch.** `package.json` says v3.0.0 and ISC. `McpServer` constructor says v1.0.0. README says MIT. These signal "nobody reviews this project carefully."

5. **Inspector v1/v2 divergence.** `tapsite_export` still uses the legacy `inspectPage` (v1) which returns different data shapes and lacks hidden element filtering. This means the export tool — the one that produces human-facing reports — is using the older, less secure code path.

**My recommendation:** Before any outward-facing work, spend 2-3 sessions on foundation. Not because it's exciting, but because every outward-facing initiative will be more successful, more maintainable, and more credible with this foundation in place.

---

## Competitive Landscape

### Browser Automation MCP Servers (tapsite's neighbors, not its competitors)

| Tool | Stars | Type | What it does |
|------|-------|------|-------------|
| **Chrome DevTools MCP** (Google) | 30.7k | Puppeteer + Chrome | 29 tools: debugging, perf tracing, Lighthouse, network. Developer tool focus. |
| **Playwright MCP** (Microsoft) | 29.4k | Playwright a11y tree | 25+ tools: navigation, clicking, forms, network. Pure automation. |
| **BrowserMCP** | 6.1k | Chrome extension | Real browser session reuse. Privacy-focused. No extraction/analysis. |
| **Firecrawl MCP** | — | SaaS scraping | Clean markdown/JSON from URLs. Content extraction only. Freemium. |
| **Puppeteer MCP** | — | Puppeteer | Original reference browser MCP server. Being eclipsed by Playwright MCP. |
| **Browserbase** | — | Cloud API | Hosted headless browsers at scale. Anti-detection. Enterprise focus. |

### Web Intelligence Extraction (tapsite's actual category)

**tapsite owns this niche.** No other MCP server combines design system extraction, accessibility auditing, component detection, API schema inference, performance metrics, network analysis, and content extraction in a single package.

The closest single-purpose competitors:
- **a11y-mcp** (39 stars) — Axe-core a11y audits. Two tools only.
- **Deque axe MCP** — Enterprise a11y testing. Single-purpose, paid.
- **MCP Design Dev** (49 installs) — Figma design tokens. Not live-site analysis.

Chrome DevTools MCP has Lighthouse integration that overlaps with tapsite's a11y/perf tools, but it exposes raw Lighthouse data rather than LLM-optimized summaries. tapsite's `summarizeResult()` pattern — compact summary to context window, full data to disk — is a structural advantage for AI consumption.

This niche position is both an opportunity (unoccupied) and a risk (possibly unoccupied because demand is thin). The roadmap validates demand through distribution (Phase 1) before heavy feature investment (Phase 5+).

### MCP Ecosystem Context

The MCP ecosystem has exploded: 5,800+ registered servers, downloads from ~100k (Nov 2024) to 8M+ (Apr 2025). MCP Registry launched for server discovery. Formal governance with Working Groups and Spec Enhancement Proposals.

Major clients: Claude Desktop, Claude Code, Cursor, VS Code (via Copilot/Continue/Cline), Windsurf, ChatGPT, Gemini, Zed, Replit. MCP is now supported by all major AI platforms — it's the de facto standard for tool integration.

**Implication for tapsite:** Being discoverable in MCP directories (mcp.so, Smithery, Glama, MCP Registry) is table stakes. tapsite is currently in none of them. Phase 1B addresses this directly.

---

## Development Phases

### Phase 0: Foundation (2-3 sessions)

**Why this comes first:** Every subsequent phase ships faster, breaks less, and attracts contributors more effectively with this foundation in place. This is not optional infrastructure — it's the difference between a hobby project and a credible open source tool.

#### 0A: Hygiene & Refactor Prep
**Scope:** Fix the inconsistencies that signal neglect. Single session.
**Model:** Sonnet

- Fix version mismatch: `McpServer` constructor version → `3.0.0`
- Fix license: `package.json` license → `MIT` (matching README and LICENSE file)
- Add `"start": "node src/mcp-server.js"` script to package.json
- Add `"bin": { "tapsite-mcp": "src/mcp-server.js" }` for future npx support
- Ensure `src/mcp-server.js` has a proper shebang (`#!/usr/bin/env node`)
- Extract the navigation boilerplate into a helper:
  ```js
  async function navigateIfNeeded(url) {
    if (!url) return;
    try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
    await page.waitForTimeout(1500);
  }
  ```
- Unify `isHiddenElement` / `isHidden` / `isVisible` — one canonical implementation used everywhere
- Update `tapsite_export` to use `inspectPageV2` instead of legacy `inspectPage`

**Security assessment:** The `isHiddenElement` unification directly closes a security gap. Inspector v1 removal eliminates an unfiltered extraction path.

**Output quality:** No user-facing output changes. Internal consistency.

**Done when:** `node -e "require('./src/mcp-server.js')"` loads clean. All `isHidden*` variants are consolidated. Version/license match across files.

#### 0B: Test Foundation
**Scope:** Add a test framework and baseline tests. Single session.
**Model:** Sonnet (Opus review of test strategy before implementation)

- Add `vitest` as dev dependency (fast, zero-config, ESM/CJS compatible)
- Create `test/` directory with:
  - `test/unit/extractors.test.js` — test extractor functions with mock DOM (jsdom)
  - `test/unit/sanitizer.test.js` — test `sanitizeForLLM()` with known injection payloads
  - `test/unit/exporter.test.js` — test export functions with fixture data
  - `test/integration/server.test.js` — test that the MCP server starts and responds to tool list request
- Add `"test": "vitest run"` and `"test:watch": "vitest"` scripts
- Create `.github/workflows/ci.yml` — run tests on push and PR

**Security assessment:** The sanitizer tests are themselves a security artifact — they document the threat model and will catch regressions. Opus should review the test payloads for completeness.

**Output quality:** Tests are developer-facing output. They should be readable as documentation of what each component does.

**Done when:** `npm test` passes. CI runs on push. Sanitizer test suite covers all patterns in `INJECTION_PATTERNS`.

#### 0C: Refactor mcp-server.js
**Scope:** Break the monolith into cohesive modules. Single session.
**Model:** Sonnet

Target structure:
```
src/
  server.js          — McpServer setup + transport (entry point)
  browser.js         — ensureBrowser(), closeBrowser(), page state (replaces current browser.js)
  sanitizer.js       — sanitizeForLLM(), INJECTION_PATTERNS
  helpers.js         — navigateIfNeeded(), summarizeResult(), resolveElement(), indexPage()
  tools/
    session.js       — login, login_manual, login_check, navigate, inspect, screenshot, act, scroll, run_js, close
    extraction.js    — all extract_* tools
    network.js       — capture_network, extract_api_schema, detect_stack
    multipage.js     — crawl, diff_pages
    export.js        — export, export_design_report
  extractors.js      — unchanged (browser-context functions)
  exporter.js        — unchanged (file export helpers)
  inspector.js       — unchanged (DOM extraction)
  config.js          — unchanged
```

Each `tools/*.js` file exports a function that takes `server` and registers its tools. `server.js` imports them all:
```js
const server = new McpServer({ name: "tapsite", version: "3.0.0" });
require('./tools/session')(server);
require('./tools/extraction')(server);
// ...
```

**Security assessment:** `sanitizer.js` becomes independently testable and reviewable. No new attack surface.

**Output quality:** No user-facing changes. Developer experience improvement.

**Done when:** All existing tests still pass. `node src/server.js` starts correctly. No functional changes.

---

### Phase 1: Distribution (2 sessions)

#### 1A: npm Package
**Scope:** Make tapsite installable via npm/npx. Single session.
**Model:** Sonnet

- Finalize `package.json`: name, description, keywords, author, repository, files field
- Check npm for name availability (`tapsite` or `tapsite-mcp`)
- Add `"files"` field to package.json to control what gets published (exclude docs/, test/, .github/)
- Add `.npmignore` as backup
- Test with `npm pack` and inspect the tarball
- Publish to npm
- Update README installation instructions:
  ```bash
  # Quick start
  npx tapsite-mcp

  # Or install globally
  npm install -g tapsite-mcp
  ```
- Update `~/.claude/.mcp.json` example to use npx

**Security assessment:** npm publish exposes the package to supply chain attacks (typosquatting, account compromise). Enable 2FA on npm account. Add `npm audit` to CI.

**Output quality:** The npm listing (package.json description, keywords, README) is itself a product surface. Write it for discoverability.

**Done when:** `npx tapsite-mcp` starts the MCP server. Package appears on npmjs.com.

#### 1B: MCP Directory Listings
**Scope:** Submit to MCP directories. Single session (mostly non-code).
**Model:** N/A (manual submissions, but Sonnet can draft descriptions)

Submit to:
- [ ] [mcp.so](https://mcp.so) — community MCP directory
- [ ] [Smithery](https://smithery.ai) — MCP registry with install buttons
- [ ] [Glama](https://glama.ai/mcp/servers) — curated MCP server list
- [ ] [Awesome MCP Servers](https://github.com/punkpeye/awesome-mcp-servers) — GitHub list
- [ ] [mcp-get](https://mcp-get.com) — npm-based MCP installer

For each, prepare:
- One-paragraph description emphasizing extraction intelligence (not browser automation)
- Category: "Web Intelligence" or "Browser & Web"
- Icon/logo if required
- Installation command (`npx tapsite-mcp`)

**Done when:** Listed in at least 3 directories with correct installation instructions.

---

### Phase 2: Output Quality (2-3 sessions)

This phase addresses the dual-consumer standard honestly. Currently:
- **AI consumer:** Well-served by `summarizeResult()`. Compact summaries, full data on disk. This pattern is correct.
- **Human consumer:** Poorly served outside of the two export tools. A developer who runs `tapsite_extract_colors` gets a JSON file dropped in `output/extractions/`. No visual report, no terminal formatting, no self-documenting schema. The design report HTML is good but it's the *only* polished human output.

#### 2A: Extraction Output Upgrade
**Scope:** Make extraction JSON files self-documenting. Single session.
**Model:** Sonnet

For every extraction tool that uses `summarizeResult()`:
- Add a `_meta` field to the JSON output:
  ```json
  {
    "_meta": {
      "tool": "tapsite_extract_colors",
      "url": "https://example.com",
      "timestamp": "2026-03-21T...",
      "version": "3.1.0",
      "description": "Color palette extracted from computed styles and CSS custom properties"
    },
    "colors": [...],
    "palette": [...],
    "totalUnique": 42
  }
  ```
- Add a human-readable summary at the top of each JSON file (not just in the MCP response)

**Security assessment:** No new attack surface. The `_meta.url` field should be sanitized (it comes from `page.url()` which is safe, but defense in depth).

**Output quality:** A developer who opens `output/extractions/colors-2026-03-21T12-30-00.json` can immediately understand what they're looking at, when it was generated, and from what URL. This is table stakes for professional tooling.

**Done when:** Every extraction JSON includes `_meta`. A human can open any output file and understand it without context.

#### 2B: CLI Report Mode
**Scope:** Add a `--report` flag to the MCP server that generates a human-readable summary after each extraction. Single session.
**Model:** Sonnet

This is NOT a CLI rewrite. It's a lightweight addition:
- When `TAPSITE_REPORT=1` env var is set, `summarizeResult()` also writes a `<name>-<ts>.md` alongside the JSON
- The Markdown file is a human-readable mini-report with the summary data formatted for readability
- For color extractions: include a simple HTML file with color swatches (similar to the design report but standalone)
- For a11y: include a pass/fail summary formatted for pasting into a ticket

**Output quality:** This is the phase that makes tapsite output directly useful to humans who aren't Claude.

**Done when:** Every extraction tool produces both JSON (machine) and Markdown (human) output when report mode is enabled.

#### 2C: Export Tool Consolidation
**Scope:** Upgrade `tapsite_export` to use v2 inspector and modern extractors. Single session.
**Model:** Sonnet

- `tapsite_export` currently uses `inspectPage` (v1) — switch to `inspectPageV2`
- Add optional extraction types to `tapsite_export` (like `tapsite_crawl` already has)
- Ensure the HTML report template matches the quality level of `tapsite_export_design_report`

**Done when:** `tapsite_export` produces reports using the same code paths as all other tools.

---

### Phase 3: Docker (1-2 sessions)

**Prerequisite:** Phase 1A (npm) must be complete. Docker builds on a published package.

#### 3A: Dockerfile & Compose
**Scope:** Containerize for headless-only use. Single session.
**Model:** Sonnet

```dockerfile
FROM mcr.microsoft.com/playwright:v1.52.0-noble
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY src/ src/
EXPOSE 3000
CMD ["node", "src/server.js"]
```

Key decisions:
- Base image: Microsoft's Playwright image (includes Chromium, system deps)
- No volume mount for `profiles/` by default (headless = no persistent auth)
- `output/` mounted as volume for extraction results
- `docker-compose.yml` for easy `docker compose up`

Headed mode note: Document that `tapsite_login_manual` is not available in Docker. For authenticated extraction in containers, the workflow is:
1. Run tapsite locally, log in manually
2. Copy `profiles/` directory into the container via volume mount
3. Container uses the saved session cookies

**Security assessment:** Container runs as non-root. No capabilities beyond network access. `profiles/` volume contains session cookies — document that this is sensitive data.

**Output quality:** README includes Docker quick-start that a developer can copy-paste.

**Done when:** `docker run mgriffen/tapsite` starts the MCP server. `docker compose up` works with volume-mounted output.

---

### Phase 4: Security Hardening (1-2 sessions, Opus)

This is an Opus session. The goal is not to add features but to audit the existing security posture and close gaps.

#### 4A: Threat Model & Audit
**Scope:** Document the threat model. Audit existing defenses. Single Opus session.
**Model:** Opus

Deliverables:
1. `SECURITY.md` — threat model document covering:
   - Prompt injection via extracted web content (primary threat)
   - Session cookie theft via `profiles/` exposure
   - `tapsite_run_js` as an escape hatch (arbitrary JS execution in page context)
   - Exfiltration via network requests from page context
   - Supply chain attacks via npm dependencies

2. Audit `sanitizeForLLM()`:
   - Are the regex patterns sufficient? Test against known prompt injection datasets
   - Can patterns be bypassed with Unicode normalization, homoglyphs, or encoding tricks?
   - Should the sanitizer operate on HTML-decoded text?
   - Consider adding a structured output mode where extracted text is JSON-encoded (prevents injection in Markdown formatting)

3. Audit `isHiddenElement()`:
   - Missing checks: `text-indent: -9999px`, `transform: scale(0)`, `font-size: 0`, `color` matching `background-color`, `overflow: hidden` with tiny dimensions
   - The `position: absolute/fixed` offscreen check has a `width < 2 || height < 2` threshold — is this the right cutoff?

4. Audit `tapsite_run_js`:
   - This tool executes arbitrary JavaScript in page context. The result is passed through `sanitizeForLLM()` but the *execution itself* is unrestricted.
   - Consider: should this tool require explicit opt-in? Should there be a blocklist of dangerous operations?

5. Write `SECURITY.md` responsible disclosure policy

**Done when:** `SECURITY.md` exists with threat model. Audit findings are filed as GitHub issues. Critical gaps are fixed in the same session.

---

### Phase 5: Differentiation (2-3 sessions)

This phase doubles down on what makes tapsite unique. Instead of adding more browser automation features (where Microsoft will always win), deepen the extraction intelligence.

#### 5A: Extraction Presets
**Scope:** Bundled tool sequences for common workflows. Single session.
**Model:** Sonnet

Add a `tapsite_analyze` meta-tool that runs a preset combination of extractors:

```
tapsite_analyze(url, preset: "design-system")
  → runs: colors, fonts, css_vars, spacing, components, breakpoints, animations
  → produces: unified design system report

tapsite_analyze(url, preset: "competitive")
  → runs: stack, metadata, content, perf, a11y, breakpoints
  → produces: competitive intelligence brief

tapsite_analyze(url, preset: "migration")
  → runs: images, svgs, favicon, fonts, css_vars, forms, links
  → produces: asset inventory for site migration

tapsite_analyze(url, preset: "accessibility")
  → runs: a11y, content, forms, colors (for contrast), metadata (for lang/title)
  → produces: accessibility audit report
```

**Why:** Running 7 tools manually to get a design system report is tedious. The LLM has to figure out which tools to call and in what order. A preset encapsulates expert knowledge about what to extract together.

**Security assessment:** Presets run existing extractors — no new attack surface. The combined report should still pass through `sanitizeForLLM()`.

**Output quality:** Each preset produces a comprehensive, self-contained report (JSON + HTML + Markdown). This is where the dual-consumer standard really shines.

**Done when:** `tapsite_analyze` with 4 presets is available. Each produces all three output formats.

#### 5B: Diff Intelligence
**Scope:** Upgrade `tapsite_diff_pages` from a simple comparison to a proper change detection tool. Single session.
**Model:** Sonnet

Current `tapsite_diff_pages` compares two URLs. Upgrade to:
- Temporal diff: compare the same URL at two points in time (using cached extraction data)
- Design system diff: compare two sites' design systems (colors, fonts, spacing)
- A11y regression: compare accessibility scores over time
- Before/after: compare a page before and after a deployment

**Output quality:** Diff output should be structured for CI integration — exit codes, machine-readable summary, optional GitHub PR comment format.

#### 5C: Watch Mode
**Scope:** Periodic re-extraction for monitoring use cases. Single session.
**Model:** Sonnet

Add `tapsite_watch` that re-runs an extraction on a schedule and reports changes:
- Monitor a competitor's pricing page for content changes
- Track accessibility score over time
- Detect design system drift across a site

This is a lightweight cron-like feature, not a full monitoring platform. Store history in `output/watch/` and diff against previous runs.

**Security assessment:** Watch mode makes repeated requests to target URLs — add rate limiting to avoid being blocked or causing load. Document ethical use.

---

### Phase 6: Browser Extension (3-5 sessions, if validated)

**Prerequisite:** Phase 1 (distribution) complete with measurable adoption. At least one piece of user feedback requesting extension/auth simplification.

**Gate:** Do not start this phase unless there is evidence of user demand. If the auth workflow (`login_manual` → `login_check`) turns out to be a non-issue for actual users, skip this entirely.

#### 6A: Extension Architecture (Opus)
**Scope:** Design the extension. Opus architecture session.

Key decisions:
- Chrome Manifest V3 (service worker + content script)
- Extension-as-MCP-server via native messaging OR sidepanel companion UI
- Which tapsite tools map to extension APIs vs. which still need Playwright
- Permission model: which tabs can the extension access?
- How does the extension communicate extraction results back to the MCP client?

#### 6B-6D: Implementation sprints
**Scope:** Build the extension in focused sprints.

Detailed planning deferred until 6A architecture is complete. Expected: 2-3 Sonnet implementation sessions after Opus architecture.

---

## Multi-Agent Strategy

### What will actually work for this project

You described wanting Opus-as-orchestrator with Sonnet workers, worktrees for parallel development, and agent teams. I want to push back on the complexity of that setup for a project this size.

tapsite is ~4,600 lines of code across 7 files. Most changes are sequential — a refactor in Phase 0C must complete before Phase 1A can use the new structure. The overhead of orchestrating multiple agents on sequential work exceeds the time saved.

**Where parallelism actually helps:**

1. **Opus review + Sonnet implementation.** Use Opus for architecture decisions and security review (Phases 0B strategy, 4A audit, 6A design). Use Sonnet for everything else. This isn't parallelism — it's role allocation.

2. **Worktrees for independent features.** Phase 2A (extraction output upgrade) and Phase 2B (CLI report mode) are independent. Run them in parallel worktrees, then merge. Same for Phase 5A and 5B.

3. **Background validation.** While Sonnet implements Phase 0B (tests), run an Opus agent in a worktree to audit the sanitizer test payloads. This is genuine parallel value.

4. **CI as your always-on agent.** Once tests and CI exist (Phase 0B), every push gets automatic verification. This replaces the need for a dedicated "test runner" agent.

### Recommended workflow per session

```
1. Open session
2. Read CLAUDE.md + relevant issue(s)
3. If implementation: Sonnet, single worktree, focused scope
4. If architecture/security: Opus, main branch, review-only
5. Before commit: run `npm test` and `node -e "require('./src/server.js')"`
6. Commit with issue ref
7. Close issue(s)
8. Update project_status.md memory
```

### When to use worktrees

- Two independent features that don't touch the same files
- A security review that should not see or be distracted by in-progress feature code
- Testing a risky refactor while keeping main clean

### When NOT to use worktrees

- Sequential phases (0A → 0B → 0C)
- Single-file changes
- Bug fixes

### Hooks worth setting up

- **Pre-commit:** `node -e "require('./src/server.js')"` — catches syntax errors before commit
- **Post-commit:** `npm test` — catches regressions immediately
- **Stop hook:** Reminder to update `project_status.md` (already in place)

Do NOT use `type: "prompt"` or `type: "agent"` hooks — they make hidden model calls against your rate limit.

---

## Project Management

### Branch Convention

```
main              — stable, always passes CI
feature/<name>    — feature branches, PR into main
fix/<name>        — bug fixes
security/<name>   — security fixes (may skip normal review for urgency)
```

### Versioning

Follow semver. Current: 3.0.0.

- Phase 0 (foundation): 3.1.0 — internal changes, no user-facing API changes
- Phase 1 (npm publish): 3.1.0 published
- Phase 2 (output quality): 3.2.0 — new output formats, backward compatible
- Phase 3 (Docker): 3.2.0 containerized (no code changes)
- Phase 4 (security): 3.3.0 if changes affect tool behavior
- Phase 5 (presets): 4.0.0 — new `tapsite_analyze` tool is a feature addition
- Phase 6 (extension): separate package, own versioning

### Issue Templates

Create `.github/ISSUE_TEMPLATE/`:

**feature.yml:**
```yaml
name: Feature Request
description: Propose a new tool or capability
labels: [enhancement]
body:
  - type: textarea
    id: description
    attributes:
      label: Description
      description: What should this feature do?
    validations:
      required: true
  - type: textarea
    id: output
    attributes:
      label: Output specification
      description: "What should the tool return to the LLM? What should the human-readable output look like?"
    validations:
      required: true
  - type: dropdown
    id: security
    attributes:
      label: Security surface
      description: Does this feature process untrusted web content?
      options:
        - "Yes — needs sanitization review"
        - "No — internal/trusted data only"
    validations:
      required: true
```

**bug.yml** and **security.yml** — standard templates with reproduction steps and severity.

### Files to create

- `CONTRIBUTING.md` — how to add a tool (extractor in extractors.js → tool definition in tools/*.js → test in test/ → PR)
- `SECURITY.md` — threat model + responsible disclosure (security@tapsite.dev or a GitHub security advisory)
- `.github/workflows/ci.yml` — test + lint on push/PR
- `.github/FUNDING.yml` — GitHub Sponsors link (when ready)

---

## Growth & Visibility Strategy

### Positioning

**One-liner:** tapsite is an MCP server that extracts structured intelligence from web pages — design systems, accessibility audits, competitive analysis, and migration prep.

**Not:** "a browser tool" or "a web scraper" or "an automation framework."

**Key differentiator:** Every other MCP browser tool gives AI the ability to *click buttons*. tapsite gives AI the ability to *understand websites*.

### Channels (ordered by expected ROI)

1. **MCP directories** (Phase 1B) — zero effort, high discoverability for people actively looking for MCP tools
2. **Blog post / dev.to / Hashnode** — "How I built an MCP server for web intelligence extraction" — technical audience, SEO for "MCP server" queries
3. **Reddit** (r/ClaudeAI, r/LocalLLaMA, r/webdev) — show don't tell. Post a real extraction result (design system report from a well-known site)
4. **Twitter/X** — short demo videos showing tapsite extracting a design system in 30 seconds
5. **Hacker News** — "Show HN" when there's a compelling demo. One shot — make it count. Wait until Docker + presets are ready.
6. **YouTube** — 5-minute demo video. "Extract any website's design system with one command."

### Timing

- **Now (Phase 0-1):** Ship foundation + npm. Submit to MCP directories. Write blog post.
- **Phase 2-3 complete:** Reddit + Twitter push. "Extract design systems, audit accessibility, analyze competitors — all from Claude."
- **Phase 5 complete (presets):** Hacker News Show HN. This is when the story is most compelling: "One command, complete web intelligence."

### Monetization (when and whether)

**Not yet.** The project needs users before it needs revenue. Premature monetization (Pro tier, hosted version) will distract from growth and signal "this is a product, not a community tool."

**When to reconsider:**
- 500+ GitHub stars
- 100+ weekly npm downloads
- Recurring feature requests from companies
- Someone asks "can we pay for this?"

**Possible models when the time comes:**
- GitHub Sponsors (lowest friction, aligns with open source ethos)
- Hosted tapsite (run extractions without local Playwright install) — SaaS with usage-based pricing
- Pro tier with premium presets (competitive intelligence dashboards, continuous monitoring)
- Consulting/customization for specific verticals (agency design system extraction, e-commerce competitive analysis)

### Contributors

The CONTRIBUTING.md should make it easy to add a tool but not require contributors to understand the whole system. The refactored structure (Phase 0C) is critical for this — a contributor can add a new extractor and tool definition without touching browser lifecycle or sanitization code.

Low-hanging-fruit issues to attract first contributors:
- "Add extractor: Open Graph image dimensions" (small, well-scoped)
- "Add extractor: Schema.org structured data summary" (builds on existing metadata extractor)
- "Improve color extraction: detect CSS gradients" (focused enhancement)

Label these `good first issue` and write detailed specs in the issue body — the same format you use for your own development.

---

## First Sprint Recommendation

### Session: Phase 0A — Hygiene & Refactor Prep

**Model:** Sonnet 4.6 (implementation)
**Branch:** `feature/foundation-hygiene`
**Worktree:** No (sequential changes to shared files)
**Estimated scope:** ~30 minutes

**Open with this prompt:**

> Read CLAUDE.md and src/mcp-server.js. Then make these changes:
>
> 1. In the McpServer constructor, change version from "1.0.0" to "3.0.0"
> 2. In package.json, change license from "ISC" to "MIT"
> 3. In package.json, add script: "start": "node src/mcp-server.js"
> 4. Add a shebang line (#!/usr/bin/env node) to the top of src/mcp-server.js
> 5. Extract the navigation boilerplate that appears ~20 times in mcp-server.js into a helper function called `navigateIfNeeded(url)`. It should: return immediately if url is falsy, otherwise try page.goto with networkidle/30s timeout (catch and ignore errors), then waitForTimeout(1500). Replace all instances.
> 6. The `isHiddenElement` function is copy-pasted in extractors.js (extractContentInBrowser, extractFormsInBrowser, extractA11yInBrowser) and a different `isHidden` variant exists in the link extractor inside mcp-server.js. These all need to be identical. The canonical version is in the `HIDDEN_ELEMENT_CHECK` constant at the top of extractors.js. Replace all inline copies with that exact implementation. For the links extractor in mcp-server.js, inline the same function body.
> 7. In the `tapsite_export` tool handler, replace `inspectPage(page)` with `inspectPageV2(page)` — import inspectPageV2 if not already imported. The export flow will need minor adjustments since v2 returns different fields (compressedDOM, elements instead of navItems, headings, etc.) — adapt the exporter to handle both shapes or update it for v2.
>
> After all changes, verify: `node -e "require('./src/mcp-server.js')"` loads without errors.
> Do not create new files. Do not add tests yet. Do not refactor the file structure.
> Commit with message: "Fix version/license, extract navigation helper, unify hidden element checks"

**"Done" looks like:**
- `node -e "require('./src/mcp-server.js')"` — clean
- `git diff --stat` shows changes only in `src/mcp-server.js`, `src/extractors.js`, `package.json`, and possibly `src/exporter.js`
- No functional behavior changes (all tools work identically)
- Version, license, and hidden element filtering are consistent

**Next session after this:** Phase 0B (test foundation) — switch to Opus for test strategy review, then Sonnet for implementation.

---

## Phase Dependency Map

```
0A (hygiene) ──→ 0B (tests) ──→ 0C (refactor) ──→ 1A (npm publish)
                                                    ↓
                                              1B (MCP directories)
                                                    ↓
                                    ┌───────────────┼───────────────┐
                                    ↓               ↓               ↓
                              2A (output)     2B (reports)    3A (Docker)
                                    ↓               ↓
                                    └───────┬───────┘
                                            ↓
                                      2C (export consolidation)
                                            ↓
                                    4A (security audit — Opus)
                                            ↓
                                    ┌───────┼───────┐
                                    ↓       ↓       ↓
                                  5A      5B      5C
                                (presets) (diff) (watch)
                                    ↓
                              6A-6D (extension — if validated)
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| No users despite good tooling | Medium | High | Validate with MCP directory listings before heavy investment. If 0 installs after 30 days on npm, re-evaluate positioning. |
| Prompt injection bypass | Medium | Critical | Phase 4 audit. Continuous testing. Consider structured output mode (JSON-encoded text) as defense-in-depth. |
| Playwright version churn breaking Docker | Medium | Medium | Pin Playwright version in Dockerfile. Test on each Playwright major release. |
| Sole maintainer burnout | High | High | CONTRIBUTING.md + good-first-issue labels to distribute work. Don't commit to features before there's demand. |
| Browser extension scope creep | Medium | Medium | Hard gate: don't start Phase 6 without user demand evidence. |
| Rate limit exhaustion from Opus overuse | Medium | Low | Reserve Opus for Phases 0B (strategy), 4A (security), 6A (architecture). Everything else is Sonnet. |
| npm name squatting | Low | Medium | Check availability and publish in Phase 1A before announcing. |

---

## Appendix: Dual-Consumer Assessment of Existing Tools

Honest evaluation of how well each tool category serves both consumers today:

| Category | AI Consumer | Human Consumer | Gap |
|----------|------------|----------------|-----|
| Session tools | Good — compressed DOM, element indices | Poor — no standalone output | Humans can't see the DOM repr |
| Content extraction | Good — clean summaries | OK — Markdown on disk | Missing visual report |
| Design tokens | Good — compact summaries | Poor — raw JSON files | Need visual swatches, type samples |
| Visual assets | Good — counts and previews | OK — files saved to disk | Missing asset inventory report |
| Layout intelligence | Good — inline text repr | Poor — text tree only | Need visual layout diagram |
| Network intelligence | Good — endpoint summaries | Poor — raw JSON | Need API documentation format |
| Multi-page | Good — crawl summaries | OK — per-page JSON files | Missing cross-page comparison report |
| Advanced | Good — score + issues | OK — JSON with issues | Need formatted audit report |
| Export | Good — file paths returned | Good — HTML reports exist | Design report is well done; general export needs upgrade |

**Key insight:** The design report (`tapsite_export_design_report`) is the quality bar. Most other tools fall well below it for human consumption. Phase 2 exists to close this gap.
