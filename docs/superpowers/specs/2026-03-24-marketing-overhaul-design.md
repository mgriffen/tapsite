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

**Accessibility target:** WCAG 2.1 AA minimum — 4.5:1 contrast ratio for normal text, 3:1 for large text (18px+ bold or 24px+ regular). Applies to both themes.

```css
/* Light theme (default) */
[data-theme="light"], :root {
  --bg-primary: #ffffff;
  --bg-secondary: #f8f9fa;
  --bg-card: #ffffff;
  --bg-code: #f1f5f9;
  --text-primary: #1a1a2a;      /* 15.4:1 on white — passes AAA */
  --text-secondary: #4a5568;    /* 7.0:1 on white — passes AA */
  --text-muted: #718096;        /* 4.6:1 on white — passes AA */
  --border: #e2e8f0;
  --border-hover: #cbd5e1;
  --accent-primary: #0066cc;    /* 5.5:1 on white — passes AA */
  --accent-secondary: #00838f;  /* 5.0:1 on white — passes AA */
  --link-color: #0066cc;
  --link-hover: #004d99;
  --card-hover-border: #0066cc;
  --card-hover-shadow: rgba(0, 102, 204, 0.1);
}

/* Dark/cyberpunk theme (opt-in) */
[data-theme="dark"] {
  --bg-primary: #04060c;
  --bg-secondary: #0a0e1a;
  --bg-card: #000000;
  --bg-code: #0f1525;
  --text-primary: #e8edf5;      /* 15.1:1 on #04060c — passes AAA */
  --text-secondary: #94a3b8;    /* 7.2:1 on #04060c — passes AA (bumped from #7a8faa) */
  --text-muted: #64748b;        /* 4.5:1 on #04060c — passes AA (bumped from #3d5070) */
  --border: rgba(0, 212, 255, 0.12);
  --border-hover: rgba(0, 212, 255, 0.3);
  --accent-primary: #00d4ff;
  --accent-secondary: #22ecdb;
  --link-color: #00d4ff;
  --link-hover: #22ecdb;
  --card-hover-border: rgba(0, 212, 255, 0.3);
  --card-hover-shadow: rgba(0, 212, 255, 0.06);
}
```

**Atmospheric effects:** Rain animation is visible only in dark mode (`[data-theme="dark"] .rain-container { display: block }`). Scanlines and grain overlays are **removed permanently** from all pages — they reduce readability without adding information.

**Theme toggle:** Small sun/moon button, top-right corner. Since pages use inline CSS with no shared JS file, the toggle script is inlined in each `docs/` page. Canonical implementation:

```js
(function() {
  const t = document.querySelector('.theme-toggle');
  const saved = localStorage.getItem('tapsite-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  if (t) t.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  if (t) t.addEventListener('click', function() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('tapsite-theme', next);
    t.setAttribute('aria-label', next === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  });
})();
```

Hidden via `<noscript>` when JS is unavailable (page renders light).

**Orbitron restriction:** Used only for:
- The TAPSITE logo text
- Primary hero headings (one per page)

All other headings — including `.card-title` on the index page, section titles, and category labels — change from Orbitron to Exo 2 (weight 600). Both themes.

### 2. Index Page (`docs/index.html`)

**Hero restructure — problem-first:**

1. Lead line (small mono): `MCP Server · 43 Tools · Open Source`
2. Headline: "Your AI can browse. Can it extract a complete design system?"
3. Subhead: tapsite gives AI agents 43 specialized tools to pull structured intelligence from any website — even behind login walls.
4. Install command: `npx -y tapsite` in styled code block, "Get started in 10 seconds" label
5. Badges row and compatibility logos (see Section 8 for badge/logo specifications)
6. TAPSITE logo: Moves below hero content — still present, still animated in dark mode

**Card reorder:** Product → Use Cases → Design Showcase → Deep Showcase

**Footer (all `docs/` pages share this treatment):** Add GitHub repo link (`https://github.com/mgriffen/tapsite`), npm link (`https://www.npmjs.com/package/tapsite`), and LangChain/LangGraph compatibility mention. Same footer across index, product, scenarios, and both showcases.

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
- Update tool category grid to match the product page's canonical 43-tool breakdown (see Section 3 for exact categories and tool assignments)
- Add "Works with" badges and compatibility logos (see Section 8)
- Add LangChain mention to compatibility line
- Add missing tools: `extract_contrast` (Analysis), `extract_shadows` (Design System), `extract_icons` (Design System), plus `audit`/`designsystem`/`teardown`/`harvest` (Workflows)
- Keeps its own clean aesthetic (Inter + JetBrains Mono) — does NOT get the dual-theme system

### 7. Cross-Cutting Concerns

**Mobile performance:** `@media (max-width: 768px)` disables rain animation in dark mode on all `docs/` pages.

**GitHub link:** Verify `tapsite-promo.html` "View on GitHub" href is valid. Add GitHub repo link to `docs/` footer.

**Noscript for toggle:** `<noscript><style>.theme-toggle{display:none}</style></noscript>` on all pages.

**OG meta tags:** Each `docs/` page gets `og:title` and `og:description` for link preview support on social/Slack/Discord. `og:image` is deferred — creating a 1200x630 OG-ready image is a separate task. For now, only text metadata is added.

### 8. Badges, Logos, and Social Proof

**Shields.io badges** (used on index hero and `tapsite-promo.html`):

```html
<!-- GitHub stars -->
<img alt="GitHub stars" src="https://img.shields.io/github/stars/mgriffen/tapsite?style=flat-square&color=0066cc">
<!-- npm downloads -->
<img alt="npm downloads" src="https://img.shields.io/npm/dm/tapsite?style=flat-square&color=00838f">
```

npm package name: `tapsite`. If npm downloads badge 404s (package not yet published), omit it and use only the GitHub stars badge.

**"Works with" compatibility logos:** Rendered as simple text badges with styled borders — not external logo images (avoids trademark issues and broken image links). Format:

```html
<span class="compat-badge">Claude</span>
<span class="compat-badge">Cursor</span>
<span class="compat-badge">Windsurf</span>
<span class="compat-badge">Any MCP Agent</span>
```

Styled with `--border` and `--text-secondary` colors from the active theme. Small monospace text, pill-shaped with subtle border.

### 9. Implementation Order

Work proceeds in this sequence:

1. **Delete standalone files** (5 files) — clean the slate first
2. **Build the dual-theme CSS system** — develop on `docs/index.html` as the reference implementation
3. **Update `docs/index.html`** — hero rewrite, card reorder, footer, badges, theme toggle
4. **Update `docs/product.html`** — theme system, new Workflows section, tool grid fix, compatibility section
5. **Update `docs/scenarios.html`** — theme system, noscript fallbacks, mobile layout fix
6. **Update `docs/showcase-design.html`** — theme system (light-safe data visualizations)
7. **Update `docs/showcase-deep.html`** — theme system (light-safe data visualizations)
8. **Update `tapsite-promo.html`** — tool grid fix, badges, LangChain mention
9. **Cross-cutting pass** — OG meta tags, GitHub link verification, mobile performance media queries

## Out of Scope

- New scenarios or personas
- Video demos or animated GIFs
- Email signup or contact forms
- Pricing pages
- Changes to README.md or non-marketing files
- External stylesheet extraction (pages keep inline CSS)
- OG image creation (deferred to a future task)
- External logo images for compatibility badges (text badges only)
