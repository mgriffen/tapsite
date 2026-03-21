# cbrowser

Web intelligence toolkit — an MCP server + CLI built with Node.js and Playwright. Designed for authenticated dashboard inspection, design system extraction, and UI analysis. Reuses browser sessions across tool calls so MFA-protected sites only need one manual login.

## Showcase

Click any image to see the full interactive page:

[![cbrowser Product Overview](docs/screenshots/product.png)](https://mgriffen.github.io/cbrowser/product.html)

**37 MCP tools** for authenticated web intelligence extraction — colors, fonts, performance, accessibility, content, forms, assets, and more.

| Design System Extraction | Deep Intelligence |
|:---:|:---:|
| [![Showcase I](docs/screenshots/showcase-design.png)](https://mgriffen.github.io/cbrowser/showcase-design.html) | [![Showcase II](docs/screenshots/showcase-deep.png)](https://mgriffen.github.io/cbrowser/showcase-deep.html) |
| Live-extracted colors, fonts, perf, breakpoints, and animations from Stripe, Linear, and Vercel | Accessibility audits, content extraction, form analysis, asset inventory, component detection |

## Setup

```bash
npm install
npx playwright install chromium
npx playwright install-deps chromium
```

Add the MCP server to your Claude config (`~/.claude/.mcp.json`):

```json
{
  "mcpServers": {
    "cbrowser": {
      "command": "node",
      "args": ["/absolute/path/to/cbrowser/src/mcp-server.js"]
    }
  }
}
```

Recommended — set transcript cleanup to prevent credentials lingering on disk:

```json
"cleanupPeriodDays": 1
```

## Credential safety

**Never pass credentials through the chat.** Use `cbrowser_login_manual` to open a headed browser, log in manually (including MFA), then `cbrowser_login_check` to confirm. Credentials never touch Anthropic's servers or local transcripts.

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

## Project structure

```
src/
  mcp-server.js    — all 37 tool definitions
  extractors.js    — browser-context extraction functions (page.evaluate())
  exporter.js      — file export: JSON, Markdown, HTML, CSV
  inspector.js     — legacy DOM extraction (used by cbrowser_inspect)
  browser.js       — persistent Chromium context (CLI)
  cli.js           — standalone CLI
  config.js        — paths and defaults
profiles/          — browser state / session cookies (gitignored)
output/            — export results (gitignored)
```

## Output formats

- `output/run-{timestamp}/` — `cbrowser_export` runs: JSON, Markdown, HTML, screenshots, CSV tables
- `output/design-report-{timestamp}/` — `cbrowser_export_design_report` runs: `report.html`, `design-tokens.json`, `design-tokens.css`
