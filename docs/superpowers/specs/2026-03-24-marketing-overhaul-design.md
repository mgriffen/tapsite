# Marketing Pages Overhaul — Design Spec

**Date:** 2026-03-24
**Status:** Approved
**Scope:** All `docs/` GitHub Pages + `tapsite-promo.html`; delete 5 standalone duplicates

## Problem

tapsite has grown to 43 tools with powerful compound workflows, but the advertising pages haven't kept pace. Key issues:

- **Version drift:** Multiple pages still say "37 tools" when the product has 43
- **Duplicate pages:** 6 standalone root HTML files are near-copies of the `docs/` pages, creating maintenance debt
- **Readability:** The cyberpunk theme has low text contrast, distracting overlays, and Orbitron font used at sizes where it's hard to read
- **No clear value prop above the fold:** Every page leads with the logo and atmospheric animations before explaining what the tool does
- **Under-advertised capabilities:** Compound workflow tools, contrast/shadow/icon extractors, LangChain integration, and the `npx -y tapsite` zero-install story are missing or buried
- **No social proof:** Zero GitHub stars badges, npm download counts, or compatibility logos
- **Weak mobile support:** Atmospheric effects are GPU-intensive on phones, scenario layouts break on narrow screens
- **No OG meta tags:** Link previews when shared on social/Slack/Discord show nothing

## Decisions

| Question | Decision |
|----------|----------|
| Standalone root files | Delete all except `tapsite-promo.html` |
| Readability approach | Significant rework: add clean/light theme (default), keep cyberpunk as opt-in toggle |
| Default theme | Light/clean — cyberpunk is the toggle-on option |
| Index hero | Problem-first: value prop → install command → badges → logo below |
| Card order on index | Product → Use Cases → Design Showcase → Deep Showcase |
| Missing capabilities | Full treatment: new Workflows section on product page, update tool grid, add LangChain/npm |
| Social proof | Shields.io badges + "Works with" compatibility logos (Claude, Cursor, Windsurf) |
| Execution strategy | Shared foundation first (theme system), then content fixes per page |

## Architecture

### 1. Dual-Theme CSS System

Each `docs/` page keeps inline CSS (no external stylesheet) organized into two layers:

**Base layer** — Theme-agnostic structural CSS:
- Layout, grid, flexbox
- Typography scale (font sizes, line heights, letter spacing)
- Spacing, responsive breakpoints
- Component structure (cards, badges, sections)

**Theme layer** — Two sets of CSS custom properties:

```css
/* Light theme (default) */
[data-theme="light"], :root {
  --bg-primary: #ffffff;
  --bg-secondary: #f8f9fa;
  --bg-card: #ffffff;
  --text-primary: #1a1a2a;
  --text-secondary: #4a5568;
  --text-muted: #718096;
  --border: #e2e8f0;
  --accent-primary: #0066cc;
  --accent-secondary: #00a3bf;
  /* ... */
}

/* Dark/cyberpunk theme (opt-in) */
[data-theme="dark"] {
  --bg-primary: #04060c;
  --bg-secondary: #0a0e1a;
  --bg-card: #000000;
  --text-primary: #e8edf5;
  --text-secondary: #94a3b8; /* bumped from #7a8faa for AA compliance */
  --text-muted: #3d5070;
  --border: rgba(0, 212, 255, 0.12);
  --accent-primary: #00d4ff;
  --accent-secondary: #22ecdb;
  /* ... */
}
```

**Atmospheric effects:** Rain animation is visible only in dark mode (`[data-theme="dark"] .rain-container { display: block }`). Scanlines and grain overlays are **removed permanently** from all pages — they reduce readability without adding information.

**Theme toggle:** Small sun/moon button, top-right corner. Flips `data-theme` on `<html>`, saves to `localStorage`. Respects `prefers-color-scheme` on first visit, defaults to light. Hidden via `<noscript>` when JS is unavailable (page renders light).

**Orbitron restriction:** Used only for:
- The TAPSITE logo text
- Primary hero headings (one per page)

All other headings (section titles, card titles, category labels) use Exo 2. Both themes.

### 2. Index Page (`docs/index.html`)

**Hero restructure — problem-first:**

1. Lead line (small mono): `MCP Server · 43 Tools · Open Source`
2. Headline: "Your AI can browse. Can it extract a complete design system?"
3. Subhead: tapsite gives AI agents 43 specialized tools to pull structured intelligence from any website — even behind login walls.
4. Install command: `npx -y tapsite` in styled code block, "Get started in 10 seconds" label
5. Badges row: GitHub stars (shields.io), npm downloads (shields.io), "Works with" logos (Claude, Cursor, Windsurf)
6. TAPSITE logo: Moves below hero content — still present, still animated in dark mode

**Card reorder:** Product → Use Cases → Design Showcase → Deep Showcase

**Footer:** Add GitHub repo link, npm link, LangChain/LangGraph mention.

### 3. Product Page (`docs/product.html`)

**New "Workflows" section** — Between capability cards and tool inventory grid. Four cards:

| Tool | Description | Chains |
|------|-------------|--------|
| `tapsite_audit` | Pre-launch quality check with scored report | a11y + contrast + perf + metadata + dark mode + forms |
| `tapsite_designsystem` | Full design system extraction with W3C token export | colors + fonts + spacing + shadows + css_vars + breakpoints + animations + icons + components |
| `tapsite_teardown` | Competitive design teardown, all extractors in one call | colors + fonts + css_vars + spacing + shadows + components + breakpoints + animations + icons + stack + perf + a11y + contrast + dark mode |
| `tapsite_harvest` | Migration asset inventory, crawl + extract per page | content + images + svgs + forms + fonts + links per page |

Pitch: "One command. Everything you need."

**Tool inventory grid update** — Reflect actual 43 tools. Add missing entries:
- `extract_contrast` → Advanced category
- `extract_shadows` → Design System category
- `extract_icons` → Design System or Visual category
- `audit`, `designsystem`, `teardown`, `harvest` → new Workflows category

**Compatibility section** — Below tool inventory: Claude, Cursor, Windsurf logos + "any MCP-compatible agent" + LangChain/LangGraph.

### 4. Scenarios Page (`docs/scenarios.html`)

**Noscript fallbacks:** Set actual target values as default `textContent` in HTML. JS animates from 0 to those values on scroll. Without JS, correct numbers display immediately.

**Mobile layout:** Add `@media (max-width: 768px)` — single-column forced, `direction: rtl` alternation disabled on even scenarios.

**No new scenarios.** Existing four personas are sufficient.

### 5. Showcase Pages (`docs/showcase-design.html`, `docs/showcase-deep.html`)

**Theme system applied.** Data visualizations (color swatches, performance bars, gauges) keep neon accent colors in both themes — they sit on white/light-gray card surfaces in light mode instead of black.

**No content or structural changes.** Tool count already correct at 43. Dossier format is the strongest proof content — leave it alone.

### 6. Standalone File Cleanup

**Delete:**
- `tapsite-ad.html`
- `tapsite-ad-cyberpunk.html`
- `tapsite-showcase.html`
- `tapsite-showcase-2.html`
- `tapsite-scenarios.html`

**Keep and update `tapsite-promo.html`:**
- Verify all tool category counts match 43 total
- Add "Works with" badges (Claude, Cursor, Windsurf) + GitHub stars/npm badges
- Add LangChain mention
- Add missing tools to category grid (`extract_contrast`, `extract_shadows`, `extract_icons`, workflow tools)
- Keeps its own clean aesthetic (Inter + JetBrains Mono) — does NOT get the dual-theme system

### 7. Cross-Cutting Concerns

**Mobile performance:** `@media (max-width: 768px)` disables rain animation in dark mode on all `docs/` pages.

**GitHub link:** Verify `tapsite-promo.html` "View on GitHub" href is valid. Add GitHub repo link to `docs/` footer.

**Noscript for toggle:** `<noscript><style>.theme-toggle{display:none}</style></noscript>` on all pages.

**OG meta tags:** Each `docs/` page gets `og:title`, `og:description`, `og:image` for link preview support on social/Slack/Discord.

## Out of Scope

- New scenarios or personas
- Video demos or animated GIFs
- Email signup or contact forms
- Pricing pages
- Changes to README.md or non-marketing files
- External stylesheet extraction (pages keep inline CSS)
