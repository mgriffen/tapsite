# tapsite

Web intelligence toolkit — an MCP server + CLI built with Node.js and Playwright. Designed for authenticated dashboard inspection, design system extraction, and UI analysis. Reuses browser sessions across tool calls so MFA-protected sites only need one manual login.

## Setup (new machine)

Run these commands from the repo root:

```bash
npm install
npx playwright install chromium
npx playwright install-deps chromium
```

Then add the MCP server to the global Claude config:

```bash
cat > ~/.claude/mcp.json << 'EOF'
{
  "mcpServers": {
    "tapsite": {
      "command": "node",
      "args": ["REPO_PATH/src/mcp-server.js"]
    }
  }
}
EOF
```

Replace `REPO_PATH` with the absolute path to this repo.

Recommended: set transcript cleanup in `~/.claude/settings.json`:

```json
"cleanupPeriodDays": 1
```

This prevents credentials from lingering on disk in session transcripts.

## Credential safety

**Never pass credentials through the chat.** Use `tapsite_login_manual` to open a headed browser, log in manually (including MFA), then use `tapsite_login_check` to confirm the session. This keeps credentials completely off Anthropic's servers and out of local transcripts.

## Project structure

- `src/mcp-server.js` — MCP server entry point (all 43 tool definitions)
- `src/extractors.js` — browser-context extraction functions (run inside `page.evaluate()`; no Node.js APIs)
- `src/exporter.js` — file export helpers: JSON, Markdown, HTML visual report, CSV tables
- `src/inspector.js` — legacy DOM extraction used by `tapsite_inspect` (nav, headings, buttons, forms, tables, links)
- `src/browser.js` — persistent Chromium context management (used by CLI only)
- `src/cli.js` — standalone CLI (login, inspect, session commands)
- `src/config.js` — paths and defaults

## Key details

- Uses Playwright persistent browser context — session cookies survive across runs
- `profiles/` stores browser state (cookies, localStorage) — gitignored
- `output/` stores export results — gitignored
- Headless by default in MCP mode; headed mode used for `tapsite_login_manual`

## Memory hygiene

Update memory files incrementally during sessions — don't batch everything to the end.
Memory lives at `~/.claude/projects/-home-griffen-projects-tapsite/memory/`.

- After completing a phase or significant task → update `project_status.md`
- When Griffen gives feedback or corrects an approach → update `feedback_workflow.md`
- When a new project direction or decision is made → update `project_status.md`
- When something new is learned about Griffen's preferences or environment → update `user_profile.md`

A Stop hook will surface a reminder at session end, but don't wait for it — update as things happen.

## Security

- **Hidden element filtering**: `isHiddenElement()` is inlined in `extractContentInBrowser`, `extractFormsInBrowser`, `extractA11yInBrowser`, and link extractors. Skips `display:none`, `visibility:hidden`, `opacity:0`, zero-size, and clip-hidden elements to block invisible prompt injection text.
- **Output sanitization**: `sanitizeForLLM()` in `mcp-server.js` scans all text returned to the LLM for injection patterns (instruction overrides, role hijacking, exfiltration, tool manipulation). Flags matches inline as `[INJECTION_DETECTED]`.
- Both defenses are applied at the extraction layer (browser context) and the return layer (Node.js) for defense in depth.
