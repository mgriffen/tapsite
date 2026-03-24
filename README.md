# tapsite

The MCP server for web intelligence extraction. 43 tools that give AI agents the ability to *understand* websites — not just drive a browser, but extract structured intelligence about design systems, accessibility, performance, content, and more.

Other MCP browser tools let agents click buttons. tapsite lets agents extract a complete color palette, audit WCAG contrast ratios, diff two sites' design tokens, or track accessibility regressions over time — all as structured JSON that agents can reason about.

Works with Claude, Cursor, Windsurf, and any MCP-compatible AI agent.

## Installation

```bash
# Quick start (no install required)
npx -y tapsite

# Or install globally
npm install -g tapsite
npx playwright install chromium
npx playwright install-deps chromium
```

Add to your AI agent's MCP config:

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

> **First run:** Playwright will install Chromium automatically if not already present (~150MB one-time download).

Also available on the [MCP Registry](https://registry.modelcontextprotocol.io/servers/io.github.mgriffen/tapsite) and [Glama](https://glama.ai/mcp/servers/mgriffen/tapsite).

## What tapsite does

**Extract design systems** — colors, fonts, spacing scales, breakpoints, components, shadows, icons, CSS variables, and contrast ratios from any website. Output as structured JSON or W3C design tokens.

**Audit quality** — accessibility scoring with WCAG contrast analysis, performance timing (Core Web Vitals), tech stack detection, dark mode support, and animation inventory.

**Compare and track** — diff two sites side by side, or track a single site over time with snapshot-based temporal diffs. Regressions and improvements are flagged automatically.

**Work behind login walls** — persistent browser sessions with full MFA support. Log in once manually, then extract across tool calls without re-authenticating. Credentials never enter the chat.

## Showcase

Click any image to see the full interactive page:

[![tapsite Product Overview](docs/screenshots/product-v2.png)](https://mgriffen.github.io/tapsite/product.html)

| Design System Extraction | Deep Intelligence |
|:---:|:---:|
| [![Showcase I](docs/screenshots/showcase-design-v2.png)](https://mgriffen.github.io/tapsite/showcase-design.html) | [![Showcase II](docs/screenshots/showcase-deep-v2.png)](https://mgriffen.github.io/tapsite/showcase-deep.html) |
| Live-extracted colors, fonts, perf, breakpoints, and animations from Stripe, Linear, and Vercel | Accessibility audits, content extraction, form analysis, asset inventory, component detection |

[![Real World Workflows](docs/screenshots/scenarios-v2.png)](https://mgriffen.github.io/tapsite/scenarios.html)

## Tools (43)

### Session
| Tool | Description |
|------|-------------|
| `tapsite_login` | Automated login (username + password, no MFA) |
| `tapsite_login_manual` | Open headed browser for manual login + MFA |
| `tapsite_login_check` | Verify authenticated session state |
| `tapsite_inspect` | Navigate to URL and inspect the DOM (nav, headings, buttons, forms, tables, links) |
| `tapsite_screenshot` | Take a screenshot of the current page |
| `tapsite_interact` | Click or fill an indexed element from the last inspect |
| `tapsite_scroll` | Scroll the page |
| `tapsite_run_js` | Execute arbitrary JavaScript and return the result |
| `tapsite_close` | Close the browser session |

### Content Extraction
| Tool | Description |
|------|-------------|
| `tapsite_extract_table` | Extract a specific table as structured data |
| `tapsite_extract_links` | Extract all links with text and href |
| `tapsite_extract_metadata` | Extract page metadata (title, description, OG tags, etc.) |
| `tapsite_extract_content` | Extract main readable content (article body, headings, paragraphs) |
| `tapsite_extract_forms` | Extract all forms with fields, labels, and actions |

### Design Tokens
| Tool | Description |
|------|-------------|
| `tapsite_extract_colors` | Extract color palette (hex values + usage counts) |
| `tapsite_extract_fonts` | Extract font families, sizes, weights |
| `tapsite_extract_css_vars` | Extract CSS custom properties |
| `tapsite_extract_spacing` | Extract spacing scale values |
| `tapsite_extract_shadows` | Extract box-shadow and text-shadow patterns |

### Visual Assets
| Tool | Description |
|------|-------------|
| `tapsite_extract_images` | Extract all images with src, alt, dimensions |
| `tapsite_download_images` | Download images to local output directory |
| `tapsite_extract_svgs` | Extract inline SVGs |
| `tapsite_extract_favicon` | Extract favicon URLs and sizes |

### Layout Intelligence
| Tool | Description |
|------|-------------|
| `tapsite_extract_layout` | Extract layout tree (inline text representation) |
| `tapsite_extract_components` | Detect repeated UI components and patterns |
| `tapsite_extract_breakpoints` | Extract responsive breakpoints from CSS media queries |

### Network Intelligence
| Tool | Description |
|------|-------------|
| `tapsite_capture_network` | Capture network requests during a page load |
| `tapsite_extract_api_schema` | Infer API schema from observed network traffic |
| `tapsite_extract_stack` | Detect frontend framework, libraries, and tech stack |

### Multi-page
| Tool | Description |
|------|-------------|
| `tapsite_crawl` | Crawl multiple pages from a start URL |
| `tapsite_diff_pages` | Compare two URLs (cross-site) or track changes over time (temporal) using real extractors |

### Advanced
| Tool | Description |
|------|-------------|
| `tapsite_extract_animations` | Extract CSS animations and transitions |
| `tapsite_extract_a11y` | Accessibility audit (ARIA, roles, contrast issues) |
| `tapsite_extract_darkmode` | Detect dark mode support and extract dark palette |
| `tapsite_extract_perf` | Extract performance metrics (Core Web Vitals, resource sizes) |
| `tapsite_extract_icons` | Detect icon libraries and extract icon usage |
| `tapsite_extract_contrast` | Audit WCAG contrast ratios between text and background |

### Export
| Tool | Description |
|------|-------------|
| `tapsite_export` | Export inspection results as JSON + Markdown + HTML report + CSV tables + screenshots |
| `tapsite_export_design_report` | Full design system report: `report.html` (visual), `design-tokens.json` (W3C format), `design-tokens.css` (copy-pasteable `:root` vars) |

### Workflows (Presets)
| Tool | Description |
|------|-------------|
| `tapsite_teardown` | Comprehensive competitive design teardown (all extractors) |
| `tapsite_audit` | Pre-launch quality audit (a11y, contrast, perf, SEO, darkmode) |
| `tapsite_harvest` | Inventory all site assets (images, SVGs, forms, fonts, links) |
| `tapsite_designsystem` | Extract design tokens as W3C JSON and CSS variables |

## Using tapsite with LangChain / LangGraph

tapsite works with LangChain and LangGraph via the official [`langchain-mcp-adapters`](https://github.com/langchain-ai/langchain-mcp-adapters) package.

```bash
pip install langchain-mcp-adapters langgraph langchain-anthropic
```

Requires Node.js installed (tapsite is a Node.js MCP server).

```python
import asyncio
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.graph import StateGraph, MessagesState, START
from langgraph.prebuilt import ToolNode, tools_condition
from langchain_anthropic import ChatAnthropic

model = ChatAnthropic(model="claude-sonnet-4-20250514")

async def main():
    async with MultiServerMCPClient({
        "tapsite": {
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", "tapsite"],
        }
    }) as client:
        tools = await client.get_tools()

        def call_model(state: MessagesState):
            return {"messages": model.bind_tools(tools).invoke(state["messages"])}

        graph = StateGraph(MessagesState)
        graph.add_node("agent", call_model)
        graph.add_node("tools", ToolNode(tools))
        graph.add_edge(START, "agent")
        graph.add_conditional_edges("agent", tools_condition)
        graph.add_edge("tools", "agent")
        app = graph.compile()

        result = await app.ainvoke({
            "messages": [("user", "Extract the design system from https://example.com")]
        })
        print(result["messages"][-1].content)

asyncio.run(main())
```

**Important:** tapsite uses a persistent browser context — session cookies survive across tool calls. For authenticated workflows, use the `MultiServerMCPClient` context manager as shown above to maintain a single MCP session. The default stateless mode creates a fresh connection per tool call, which breaks session persistence.

## Security

### Prompt injection defense

When extracting content from untrusted web pages, tapsite applies two layers of protection:

1. **Hidden element filtering** — Extractors skip elements with `display:none`, `visibility:hidden`, `opacity:0`, zero-size, and clip-hidden styling. This prevents invisible text (a common prompt injection vector) from entering extraction results.

2. **Output sanitization** — All text returned to the LLM is scanned for prompt injection patterns: instruction overrides, role hijacking, exfiltration attempts, and tool manipulation. Matches are flagged inline as `[INJECTION_DETECTED]` rather than silently dropped.

### Credential safety

**Never pass credentials through the chat.** Use `tapsite_login_manual` to open a headed browser, log in manually (including MFA), then `tapsite_login_check` to confirm. Credentials never touch the AI provider's servers or local transcripts.

## Docker

tapsite ships a `Dockerfile` and `docker-compose.yml` for headless-only use — CI pipelines, server deployments, or anywhere you don't want a local Node.js install.

```bash
docker build -t tapsite .
docker compose up
```

`tapsite_login_manual` is not available in Docker (it requires a display). To use authenticated sessions in Docker, log in locally first, then mount the `profiles/` directory into the container:

```yaml
volumes:
  - ./output:/app/output
  - ./profiles:/app/profiles
```

> **Security note:** `profiles/` contains live session cookies. Don't commit it to version control (it's already in `.gitignore`).

## Development setup

```bash
git clone https://github.com/mgriffen/tapsite
cd tapsite
npm install
npx playwright install chromium
npx playwright install-deps chromium
```

MCP config pointing to local source:

```json
{
  "mcpServers": {
    "tapsite": {
      "command": "node",
      "args": ["/absolute/path/to/tapsite/src/server.js"]
    }
  }
}
```

### Project structure

```
src/
  server.js        — MCP server entry point
  browser.js       — shared Chromium context (ensureBrowser, closeBrowser)
  helpers.js       — shared helpers (navigateIfNeeded, summarizeResult, indexPage)
  sanitizer.js     — prompt injection detection
  diff.js          — per-extractor diff logic and extractor name/args mapping
  snapshots.js     — temporal snapshot I/O (saveSnapshot, loadLatestSnapshot)
  extractors.js    — browser-context extraction functions (page.evaluate())
  exporter.js      — file export: JSON, Markdown, HTML, CSV
  inspector.js     — DOM extraction for inspect tools
  cli.js           — standalone CLI (login, inspect, session)
  config.js        — paths and defaults
  tools/
    session.js     — login, inspect, screenshot, interact, scroll, run_js, close
    extraction.js  — all extract_* tools
    network.js     — capture_network, extract_api_schema, extract_stack
    multipage.js   — crawl, diff_pages
    export.js      — export, export_design_report
    workflows.js   — teardown, audit, harvest, designsystem
profiles/          — browser state / session cookies (gitignored)
output/            — export results + snapshots (gitignored)
```

### Output formats

- `output/run-{timestamp}/` — `tapsite_export`: JSON, Markdown, HTML, screenshots, CSV tables
- `output/design-report-{timestamp}/` — `tapsite_export_design_report`: `report.html`, `design-tokens.json`, `design-tokens.css`
- `output/snapshots/{domain}/` — `tapsite_diff_pages` temporal snapshots

## License

MIT
