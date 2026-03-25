# tapsite

The MCP server for web intelligence extraction. 55 tools that give AI agents the ability to *understand* websites — not just drive a browser, but extract structured intelligence about design systems, accessibility, performance, content, and more.

Other MCP browser tools let agents click buttons. tapsite lets agents extract a complete color palette, audit WCAG contrast ratios, diff two sites' design tokens, detect tech stacks, or pull structured data with custom CSS/XPath/regex selectors — all as structured JSON that agents can reason about.

## 55 Tools across 11 Categories

| Category | Tools | What it does |
|----------|-------|-------------|
| **Session** | 8 | Browser control — login with MFA, inspect, screenshot, interact, run JS |
| **Content Extraction** | 6 | Tables, links, metadata, forms, and clean Markdown with chunking |
| **Custom Extraction** | 2 | Bring your own CSS, XPath, or regex selectors — plus auto-schema suggestion |
| **Design Tokens** | 5 | Colors, fonts, CSS variables, spacing, shadows |
| **Visual Assets** | 4 | Images, SVGs, favicons — inventory and download |
| **Layout Intelligence** | 3 | Layout trees, component detection, responsive breakpoints |
| **Quality & Compliance** | 7 | Accessibility, contrast, performance, security headers, dark mode, PWA, i18n |
| **Technology Detection** | 10 | Frameworks, animations, icons, GraphQL, AI/ML, canvas, WASM, web components, third-party scripts, storage |
| **Network & API** | 2 | Traffic capture and API schema inference |
| **Multi-Page** | 2 | BFS crawl with per-page extraction, cross-site and temporal diffs |
| **Export** | 2 | Multi-format output: JSON, Markdown, HTML reports, CSV, screenshots, W3C design tokens |
| **Workflows** | 4 | Single-call presets — teardown, audit, harvest, designsystem |

## Engine

Parallel browser pooling for concurrent extraction. Persistent disk caching — crawls resume where they left off and results are reused across sessions. 3-tier anti-bot escalation automatically handles protected sites with stealth scripts and proxy rotation.

## Security

Prompt injection defense (hidden element filtering + output sanitization), HTTPS enforced, private IPs blocked, auth headers redacted. Credentials never enter the chat — log in manually with full MFA support.

## Install

```json
{
  "mcpServers": {
    "tapsite": {
      "command": "npx",
      "args": ["-y", "tapsite"]
    }
  }
}
```

Works with Claude, Cursor, Windsurf, and any MCP-compatible AI agent.

[Full documentation on GitHub →](https://github.com/mgriffen/tapsite)
