# cbrowser-mcp

Web intelligence toolkit — an MCP server + CLI built with Node.js and Playwright. Designed for authenticated dashboard inspection, design system extraction, and UI analysis. Reuses browser sessions across tool calls so MFA-protected sites only need one manual login.

## Installation

```bash
# Quick start (no install required)
npx cbrowser-mcp

# Or install globally
npm install -g cbrowser-mcp
npx playwright install chromium
npx playwright install-deps chromium
```

Add to your Claude config (`~/.claude/.mcp.json`):

```json
{
  "mcpServers": {
    "cbrowser": {
      "command": "npx",
      "args": ["cbrowser-mcp"]
    }
  }
}
```

> **First run:** Playwright will install the Chromium browser automatically if not already present. This is a one-time ~150MB download.

## Showcase

Click any image to see the full interactive page:

[![cbrowser Product Overview](docs/screenshots/product.png)](https://mgriffen.github.io/cbrowser/product.html)

**37 MCP tools** for authenticated web intelligence extraction — colors, fonts, performance, accessibility, content, forms, assets, and more.

| Design System Extraction | Deep Intelligence |
|:---:|:---:|
| [![Showcase I](docs/screenshots/showcase-design.png)](https://mgriffen.github.io/cbrowser/showcase-design.html) | [![Showcase II](docs/screenshots/showcase-deep.png)](https://mgriffen.github.io/cbrowser/showcase-deep.html) |
| Live-extracted colors, fonts, perf, breakpoints, and animations from Stripe, Linear, and Vercel | Accessibility audits, content extraction, form analysis, asset inventory, component detection |

[![Real World Intelligence](docs/screenshots/scenarios.png)](https://mgriffen.github.io/cbrowser/scenarios.html)

**Four real-world scenarios** — design system reverse-engineering, competitive intelligence, accessibility auditing, and asset migration prep.

## Development setup (from source)

```bash
git clone https://github.com/mgriffen/cbrowser
cd cbrowser
npm install
npx playwright install chromium
npx playwright install-deps chromium
```

MCP config pointing to local source:

```json
{
  "mcpServers": {
    "cbrowser": {
      "command": "node",
      "args": ["/absolute/path/to/cbrowser/src/server.js"]
    }
  }
}
```

Recommended — set transcript cleanup to prevent credentials lingering on disk:

```json
"cleanupPeriodDays": 1
```

## Tools (37)

### Session
| Tool | Description |
|------|-------------|
| `cbrowser_login` | Automated login (username + password, no MFA) |
| `cbrowser_login_manual` | Open headed browser for manual login + MFA |
| `cbrowser_login_check` | Verify authenticated session state |
| `cbrowser_navigate` | Navigate to a URL, returns indexed interactive elements |
| `cbrowser_inspect` | Full DOM inspection (nav, headings, buttons, forms, tables, links) |
| `cbrowser_screenshot` | Take a screenshot of the current page |
| `cbrowser_act` | Click or fill an indexed element from the last inspect/navigate |
| `cbrowser_scroll` | Scroll the page |
| `cbrowser_run_js` | Execute arbitrary JavaScript and return the result |
| `cbrowser_close` | Close the browser session |

### Content Extraction
| Tool | Description |
|------|-------------|
| `cbrowser_extract_table` | Extract a specific table as structured data |
| `cbrowser_extract_links` | Extract all links with text and href |
| `cbrowser_extract_metadata` | Extract page metadata (title, description, OG tags, etc.) |
| `cbrowser_extract_content` | Extract main readable content (article body, headings, paragraphs) |
| `cbrowser_extract_forms` | Extract all forms with fields, labels, and actions |

### Design Tokens
| Tool | Description |
|------|-------------|
| `cbrowser_extract_colors` | Extract color palette (hex values + usage counts) |
| `cbrowser_extract_fonts` | Extract font families, sizes, weights |
| `cbrowser_extract_css_vars` | Extract CSS custom properties |
| `cbrowser_extract_spacing` | Extract spacing scale values |

### Visual Assets
| Tool | Description |
|------|-------------|
| `cbrowser_extract_images` | Extract all images with src, alt, dimensions |
| `cbrowser_download_images` | Download images to local output directory |
| `cbrowser_extract_svgs` | Extract inline SVGs |
| `cbrowser_extract_favicon` | Extract favicon URLs and sizes |

### Layout Intelligence
| Tool | Description |
|------|-------------|
| `cbrowser_extract_layout` | Extract layout tree (inline text representation) |
| `cbrowser_extract_components` | Detect repeated UI components and patterns |
| `cbrowser_extract_breakpoints` | Extract responsive breakpoints from CSS media queries |

### Network Intelligence
| Tool | Description |
|------|-------------|
| `cbrowser_capture_network` | Capture network requests during a page load |
| `cbrowser_extract_api_schema` | Infer API schema from observed network traffic |
| `cbrowser_detect_stack` | Detect frontend framework, libraries, and tech stack |

### Multi-page
| Tool | Description |
|------|-------------|
| `cbrowser_crawl` | Crawl multiple pages from a start URL |
| `cbrowser_diff_pages` | Compare two pages and report differences |

### Advanced
| Tool | Description |
|------|-------------|
| `cbrowser_extract_animations` | Extract CSS animations and transitions |
| `cbrowser_extract_a11y` | Accessibility audit (ARIA, roles, contrast issues) |
| `cbrowser_detect_darkmode` | Detect dark mode support and extract dark palette |
| `cbrowser_extract_perf` | Extract performance metrics (Core Web Vitals, resource sizes) |

### Export
| Tool | Description |
|------|-------------|
| `cbrowser_export` | Export inspection results as JSON + Markdown + HTML report + CSV tables + screenshots |
| `cbrowser_export_design_report` | Full design system report: `report.html` (visual), `design-tokens.json` (W3C format), `design-tokens.css` (copy-pasteable `:root` vars) |

## Security

### Prompt injection defense

When extracting content from untrusted web pages, cbrowser applies two layers of protection:

1. **Hidden element filtering** — Extractors skip elements with `display:none`, `visibility:hidden`, `opacity:0`, zero-size, and clip-hidden styling. This prevents invisible text (a common prompt injection vector) from entering extraction results. Applied to content, links, forms, and accessibility extractors.

2. **Output sanitization** — All text returned to the LLM is scanned for prompt injection patterns: instruction overrides, role hijacking, exfiltration attempts, and tool manipulation. Matches are flagged inline as `[INJECTION_DETECTED]` rather than silently dropped, so both the LLM and user can see what was caught.

### Credential safety

**Never pass credentials through the chat.** Use `cbrowser_login_manual` to open a headed browser, log in manually (including MFA), then `cbrowser_login_check` to confirm. Credentials never touch Anthropic's servers or local transcripts.

## License

MIT

## Project structure

```
src/
  server.js        — MCP server entry point
  browser.js       — shared Chromium context (ensureBrowser, closeBrowser)
  helpers.js       — shared helpers (navigateIfNeeded, summarizeResult, indexPage)
  sanitizer.js     — prompt injection detection
  extractors.js    — browser-context extraction functions (page.evaluate())
  exporter.js      — file export: JSON, Markdown, HTML, CSV
  inspector.js     — DOM extraction for inspect/navigate tools
  cli.js           — standalone CLI (login, inspect, session)
  config.js        — paths and defaults
  tools/
    session.js     — login, navigate, inspect, screenshot, act, scroll, run_js, close
    extraction.js  — all extract_* and detect_* tools
    network.js     — capture_network, extract_api_schema, detect_stack
    multipage.js   — crawl, diff_pages
    export.js      — export, export_design_report
profiles/          — browser state / session cookies (gitignored)
output/            — export results (gitignored)
```

## Output formats

- `output/run-{timestamp}/` — `cbrowser_export` runs: JSON, Markdown, HTML, screenshots, CSV tables
- `output/design-report-{timestamp}/` — `cbrowser_export_design_report` runs: `report.html`, `design-tokens.json`, `design-tokens.css`
