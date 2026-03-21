# cbrowser

Authenticated dashboard browser — an MCP server + CLI tool built with Node.js and Playwright. Used to inspect, screenshot, and extract data from internal web dashboards that require login (FTTH Tracker, Sonic DSL, etc.).

## Setup (new machine)

Run these commands from the repo root:

```bash
npm install
npx playwright install chromium
npx playwright install-deps chromium
```

Then add the MCP server to the global Claude config:

```bash
cat > ~/.claude/.mcp.json << 'EOF'
{
  "mcpServers": {
    "cbrowser": {
      "command": "node",
      "args": ["REPO_PATH/src/mcp-server.js"]
    }
  }
}
EOF
```

Replace `REPO_PATH` with the absolute path to this repo (e.g. `/home/griffen/projects/cbrowser`).

Recommended: set transcript cleanup in `~/.claude/settings.json`:

```json
"cleanupPeriodDays": 1
```

This prevents credentials from lingering on disk in session transcripts.

## Credential safety

**Never pass credentials through the chat.** Use `cbrowser_login_manual` to open a headed browser, log in manually (including MFA), then use `cbrowser_login_check` to confirm the session. This keeps credentials completely off Anthropic's servers and out of local transcripts.

## Project structure

- `src/mcp-server.js` — MCP server entry point (all tools defined here)
- `src/cli.js` — standalone CLI (login, inspect, session commands)
- `src/browser.js` — persistent Chromium context management
- `src/inspector.js` — DOM extraction (nav, headings, buttons, forms, tables, links, frames, body text)
- `src/exporter.js` — Markdown report + JSON + screenshot export
- `src/config.js` — paths and defaults

## Key details

- Uses Playwright persistent browser context — session cookies survive across runs
- `profiles/` stores browser state (cookies, localStorage) — gitignored
- `output/` stores export results — gitignored
- Headless by default in MCP mode; headed mode used for `cbrowser_login_manual`
