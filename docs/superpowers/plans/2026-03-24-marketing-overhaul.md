# Marketing Pages Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul tapsite's GitHub Pages marketing site with a clean default theme, problem-first messaging, accurate 43-tool content, and social proof badges.

**Architecture:** Shared dual-theme CSS foundation (light default + dark cyberpunk toggle) applied to 5 `docs/` pages. Content fixes per page. 5 standalone duplicate files deleted. `tapsite-promo.html` kept and updated independently.

**Tech Stack:** HTML, CSS (inline, CSS custom properties), vanilla JS (theme toggle, scroll animations)

**Spec:** `docs/superpowers/specs/2026-03-24-marketing-overhaul-design.md`

---

### Task 1: Delete Standalone Duplicate Files

**Files:**
- Delete: `tapsite-ad.html`
- Delete: `tapsite-ad-cyberpunk.html`
- Delete: `tapsite-showcase.html`
- Delete: `tapsite-showcase-2.html`
- Delete: `tapsite-scenarios.html`

- [ ] **Step 1: Delete the 5 files**

```bash
git rm tapsite-ad.html tapsite-ad-cyberpunk.html tapsite-showcase.html tapsite-showcase-2.html tapsite-scenarios.html
```

- [ ] **Step 2: Verify no broken references**

```bash
grep -r "tapsite-ad\|tapsite-showcase\|tapsite-scenarios" docs/ tapsite-promo.html
```

Expected: No matches (these standalone files are not linked from the `docs/` site or promo page).

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: delete 5 standalone duplicate marketing pages

These are stale copies of the docs/ site with outdated tool counts.
The docs/ pages are the canonical versions."
```

---

### Task 2: Build Dual-Theme System on Index Page

This is the reference implementation. The index page is small (135 lines) so it's the ideal place to build and validate the theme system before applying to larger pages.

**Files:**
- Rewrite: `docs/index.html`

- [ ] **Step 1: Rewrite `docs/index.html` with the complete dual-theme system**

The new index page includes:
- **Theme CSS variables** (light default in `:root`, dark in `[data-theme="dark"]`)
- **Base structural CSS** (layout, typography, cards, responsive)
- **Theme toggle button** (sun/moon, top-right, saves to localStorage)
- **Noscript fallback** hiding toggle when JS unavailable
- **Rain animation CSS** (visible only in `[data-theme="dark"]`)
- **No scanlines or grain** (removed permanently)
- **Orbitron** restricted to `.logo` only; `.card-title` uses Exo 2 weight 600
- **Problem-first hero**: lead line, headline, subhead, install command, badges, compat logos
- **Card reorder**: Product -> Use Cases -> Design Showcase -> Deep Showcase
- **Updated footer**: GitHub link, npm link, LangChain mention, "Open source" line
- **OG meta tags**: `og:title`, `og:description` in `<head>`
- **Rain JS** only creates drops when `data-theme="dark"`

Key CSS structure:
```css
:root, [data-theme="light"] {
  --bg-primary: #ffffff;
  --bg-secondary: #f8f9fa;
  --bg-card: #ffffff;
  --bg-code: #f1f5f9;
  --text-primary: #1a1a2a;
  --text-secondary: #4a5568;
  --text-muted: #64748b;
  --border: #e2e8f0;
  --border-hover: #cbd5e1;
  --accent-primary: #0055b3;
  --accent-secondary: #00727d;
  --link-color: #0055b3;
  --link-hover: #004080;
  --card-hover-border: #0066cc;
  --card-hover-shadow: rgba(0, 102, 204, 0.1);
}
[data-theme="dark"] {
  --bg-primary: #04060c;
  --bg-secondary: #0a0e1a;
  --bg-card: #000000;
  --bg-code: #0f1525;
  --text-primary: #e8edf5;
  --text-secondary: #94a3b8;
  --text-muted: #718096;
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

Theme toggle JS (inline in `<script>` before `</body>`):
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

Rain drops JS — only creates rain when dark theme is active, and listens for theme changes:
```js
function createRain() {
  var rc = document.getElementById('rain');
  if (!rc) return;
  rc.innerHTML = '';
  for (var i = 0; i < 60; i++) {
    var d = document.createElement('div');
    d.className = 'rain-drop';
    d.style.left = Math.random() * 100 + '%';
    d.style.height = (40 + Math.random() * 80) + 'px';
    d.style.animationDuration = (0.5 + Math.random() * 0.7) + 's';
    d.style.animationDelay = (Math.random() * 2) + 's';
    rc.appendChild(d);
  }
}
if (document.documentElement.getAttribute('data-theme') === 'dark') createRain();
```

CSS for rain visibility:
```css
.rain-container { display: none; }
[data-theme="dark"] .rain-container { display: block; }
@media (max-width: 768px) {
  [data-theme="dark"] .rain-container { display: none; }
}
```

Hero HTML structure:
```html
<section class="hero">
  <div class="hero-lead">MCP Server &middot; 43 Tools &middot; Open Source</div>
  <h1 class="hero-title">Your AI can browse.<br>Can it extract a complete design system?</h1>
  <p class="hero-subtitle">tapsite gives AI agents 43 specialized tools to pull structured intelligence from any website — even behind login walls.</p>
  <div class="install-block">
    <div class="install-label">Get started in 10 seconds</div>
    <code class="install-cmd">npx -y tapsite</code>
  </div>
  <div class="badges-row">
    <img alt="GitHub stars" src="https://img.shields.io/github/stars/mgriffen/tapsite?style=flat-square&color=0055b3">
    <img alt="npm downloads" src="https://img.shields.io/npm/dm/tapsite?style=flat-square&color=00727d">
  </div>
  <div class="compat-row">
    <span class="compat-badge">Claude</span>
    <span class="compat-badge">Cursor</span>
    <span class="compat-badge">Windsurf</span>
    <span class="compat-badge">Any MCP Agent</span>
  </div>
</section>
<div class="logo">TAPSITE</div>
```

Footer HTML:
```html
<footer class="footer">
  Open source &bull; Works with any MCP-compatible AI agent &bull; LangChain/LangGraph compatible<br>
  <a href="https://github.com/mgriffen/tapsite">GitHub</a> &bull;
  <a href="https://www.npmjs.com/package/tapsite">npm</a>
</footer>
```

- [ ] **Step 2: Open in browser and verify both themes**

```bash
xdg-open docs/index.html
```

Verify:
- Page loads in light theme by default (white background, dark text)
- Theme toggle button visible top-right
- Clicking toggle switches to dark theme (dark background, neon accents, rain animation appears)
- Clicking again returns to light
- Refresh preserves theme choice (localStorage)
- Problem-first hero visible: headline, install command, badges
- Cards in correct order: Product, Use Cases, Design Showcase, Deep Showcase
- Footer has GitHub/npm links

- [ ] **Step 3: Commit**

```bash
git add docs/index.html
git commit -m "feat: rewrite index page with dual-theme system and problem-first hero

Light theme default, cyberpunk dark toggle. Problem-first hero with
install command, shields.io badges, and compat logos. Card reorder:
Product > Use Cases > Design Showcase > Deep Showcase."
```

---

### Task 3: Apply Theme System to Product Page

The largest page (1247 lines). Theme system changes + new Workflows section + tool grid update + compatibility section.

**Files:**
- Modify: `docs/product.html`

- [ ] **Step 1: Replace CSS variables and remove scanlines/grain**

In `docs/product.html`:
- Replace the existing `:root` CSS variable block with the dual-theme variables from Task 2
- Remove the `.scanlines` and `.grain` CSS rules entirely
- Remove the `.scanlines` and `.grain` HTML elements (around line 868-869)
- Add `.rain-container { display: none; } [data-theme="dark"] .rain-container { display: block; }` and the mobile media query hiding rain
- Change all hardcoded color values in CSS to use the new CSS variables where they map directly (e.g., `background: var(--void)` becomes `background: var(--bg-primary)`, `color: var(--text-primary)` stays, card backgrounds become `var(--bg-card)`, borders become `var(--border)`)
- Change `.hero-title` and any section title that uses `font-family: 'Orbitron'` to `font-family: 'Exo 2'` EXCEPT the main `.hero-title` (TAPSITE text) which keeps Orbitron
- All `.feature-title`, `.tool-cat-name`, `.section-title` elements: change from Orbitron to `font-family: 'Exo 2', sans-serif; font-weight: 600`

- [ ] **Step 2: Add theme toggle button and JS**

Add the theme toggle button HTML right after `<body>`:
```html
<button class="theme-toggle" aria-label="Switch to dark mode">
  <svg class="icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
  <svg class="icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
</button>
<noscript><style>.theme-toggle{display:none}</style></noscript>
```

Add theme toggle CSS:
```css
.theme-toggle {
  position: fixed; top: 1rem; right: 1rem; z-index: 10000;
  background: var(--bg-card); border: 1px solid var(--border);
  color: var(--text-secondary); cursor: pointer;
  width: 40px; height: 40px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  transition: border-color 0.3s, background 0.3s;
}
.theme-toggle:hover { border-color: var(--border-hover); }
[data-theme="dark"] .icon-sun { display: none; }
[data-theme="light"] .icon-moon, :root .icon-moon { display: none; }
```

Add the theme toggle JS and rain JS from Task 2 in `<script>` before `</body>`. Update the rain creation JS to also listen for toggle clicks and create/clear rain accordingly.

- [ ] **Step 3: Add new Workflows section**

Insert between the existing feature cards section and the tool inventory grid (before line ~1045):

```html
<div class="neon-divider"></div>

<section class="section">
  <div class="section-label"><span class="accent-line"></span>Compound Tools</div>
  <h2 class="section-title">One Command. <span class="accent">Everything You Need.</span></h2>
  <p class="section-desc">
    Workflow tools chain multiple extractors into a single call. Run a complete audit, extract a full design system, or inventory an entire site — all from one prompt.
  </p>

  <div class="features-grid">
    <div class="feature-card glass">
      <div class="feature-icon" style="color: var(--accent-primary);">&#x2713;</div>
      <div class="feature-title">tapsite_audit</div>
      <div class="feature-desc">Pre-launch quality check with scored report. Chains: a11y + contrast + perf + metadata + dark mode + forms.</div>
    </div>
    <div class="feature-card glass">
      <div class="feature-icon" style="color: var(--accent-secondary);">&#x25A8;</div>
      <div class="feature-title">tapsite_designsystem</div>
      <div class="feature-desc">Full design system extraction with W3C token export. Chains: colors + fonts + spacing + shadows + css_vars + breakpoints + animations + icons + components.</div>
    </div>
    <div class="feature-card glass">
      <div class="feature-icon" style="color: var(--accent-primary);">&#x2694;</div>
      <div class="feature-title">tapsite_teardown</div>
      <div class="feature-desc">Competitive design teardown — all extractors in one call. Colors, fonts, spacing, shadows, components, breakpoints, animations, icons, stack, perf, a11y, contrast, dark mode.</div>
    </div>
    <div class="feature-card glass">
      <div class="feature-icon" style="color: var(--accent-secondary);">&#x21C4;</div>
      <div class="feature-title">tapsite_harvest</div>
      <div class="feature-desc">Migration asset inventory. Crawls up to N pages, extracting content, images, SVGs, forms, fonts, and links per page.</div>
    </div>
  </div>
</section>
```

- [ ] **Step 4: Update tool inventory grid to 43 tools**

Replace the existing 8-category tool grid (lines ~1057-1098). The current page has a bug: it claims "43 Tools Across 10 Areas" but actually lists 8 categories summing to 37 tools with some wrong names (`act` should be `interact`, `detect_stack` should be `extract_stack`, `detect_darkmode` should be `extract_darkmode`). There is no `navigate` tool — `inspect` handles navigation.

Replace with this corrected 10-category grid using canonical tool names from `src/tools/*.js`:

```html
<div class="tool-categories">
  <div class="tool-cat">
    <div class="tool-cat-count">09</div>
    <div class="tool-cat-name">Session</div>
    <div class="tool-cat-items">login / login_manual / login_check / inspect / screenshot / interact / scroll / run_js / close</div>
  </div>
  <div class="tool-cat">
    <div class="tool-cat-count">04</div>
    <div class="tool-cat-name">Visual</div>
    <div class="tool-cat-items">download_images / extract_images / extract_svgs / extract_favicon</div>
  </div>
  <div class="tool-cat">
    <div class="tool-cat-count">08</div>
    <div class="tool-cat-name">Design System</div>
    <div class="tool-cat-items">extract_colors / extract_fonts / extract_css_vars / extract_spacing / extract_shadows / extract_icons / extract_components / extract_breakpoints</div>
  </div>
  <div class="tool-cat">
    <div class="tool-cat-count">05</div>
    <div class="tool-cat-name">Content</div>
    <div class="tool-cat-items">extract_content / extract_metadata / extract_links / extract_table / extract_forms</div>
  </div>
  <div class="tool-cat">
    <div class="tool-cat-count">03</div>
    <div class="tool-cat-name">Network</div>
    <div class="tool-cat-items">capture_network / extract_api_schema / extract_stack</div>
  </div>
  <div class="tool-cat">
    <div class="tool-cat-count">06</div>
    <div class="tool-cat-name">Analysis</div>
    <div class="tool-cat-items">extract_layout / extract_animations / extract_a11y / extract_contrast / extract_darkmode / extract_perf</div>
  </div>
  <div class="tool-cat">
    <div class="tool-cat-count">02</div>
    <div class="tool-cat-name">Multi-Page</div>
    <div class="tool-cat-items">crawl / diff_pages</div>
  </div>
  <div class="tool-cat">
    <div class="tool-cat-count">02</div>
    <div class="tool-cat-name">Export</div>
    <div class="tool-cat-items">export / export_design_report</div>
  </div>
  <div class="tool-cat">
    <div class="tool-cat-count">04</div>
    <div class="tool-cat-name">Workflows</div>
    <div class="tool-cat-items">audit / designsystem / teardown / harvest</div>
  </div>
</div>
```

Verify total: 9+4+8+5+3+6+2+2+4 = 43. Update the section heading to "43 Tools Across 9 Areas".

- [ ] **Step 5: Add compatibility section**

Insert after the tool inventory grid, before the terminal demo section:

```html
<div class="compat-section">
  <div class="compat-row">
    <span class="compat-badge">Claude</span>
    <span class="compat-badge">Cursor</span>
    <span class="compat-badge">Windsurf</span>
    <span class="compat-badge">Any MCP Agent</span>
    <span class="compat-badge">LangChain / LangGraph</span>
  </div>
</div>
```

Add CSS for `.compat-badge` and `.compat-section` (same as index page).

- [ ] **Step 6: Update footer**

Replace the existing footer with the standardized version:
```html
<footer class="footer">
  <div class="logo">TAPSITE</div>
  <div class="footer-stack">Node.js &bull; Playwright &bull; Model Context Protocol</div>
  <div class="footer-line">Open source &bull; Works with any MCP-compatible AI agent &bull; LangChain/LangGraph compatible</div>
  <div class="footer-links">
    <a href="https://github.com/mgriffen/tapsite">GitHub</a> &bull;
    <a href="https://www.npmjs.com/package/tapsite">npm</a>
  </div>
</footer>
```

- [ ] **Step 7: Add OG meta tags to `<head>`**

```html
<meta property="og:title" content="TAPSITE — Web Intelligence MCP Server">
<meta property="og:description" content="43 tools that give AI agents the ability to extract design systems, audit accessibility, and pull structured intelligence from any website.">
<meta property="og:type" content="website">
```

- [ ] **Step 8: Open in browser and verify**

```bash
xdg-open docs/product.html
```

Verify:
- Light theme default: white/light background, readable text, no rain/scanlines/grain
- Dark toggle: neon colors return, rain appears, no scanlines/grain
- New Workflows section visible between features and tool grid
- Tool grid shows 9 categories, 43 tools total
- Compatibility badges visible
- Footer has GitHub/npm links

- [ ] **Step 9: Commit**

```bash
git add docs/product.html
git commit -m "feat: apply dual-theme to product page, add workflows section and updated tool grid

New Workflows section showcasing compound tools (audit, designsystem,
teardown, harvest). Tool grid updated to 10 categories / 43 tools.
Compatibility badges and standardized footer added."
```

---

### Task 4: Apply Theme System to Scenarios Page

**Files:**
- Modify: `docs/scenarios.html`

- [ ] **Step 1: Replace CSS variables, remove scanlines/grain, add theme toggle**

Same CSS variable replacement as Tasks 2-3. Remove `.scanlines` and `.grain` CSS + HTML. Add theme toggle button + CSS + JS. Add rain visibility rules. Change Orbitron usage on `.scenario-title` and other non-hero headings to Exo 2 weight 600.

- [ ] **Step 2: Fix noscript fallbacks for animated counters**

Find all `<span class="counter" data-target="N">0</span>` elements. These are nested inside parent divs — the `data-target` is on the `<span>`, not the outer container. Suffix text like "min", "sites", "pages" lives outside the span.

Current pattern:
```html
<div class="value-number"><span class="counter" data-target="5">0</span> min</div>
```

Change to:
```html
<div class="value-number"><span class="counter" data-target="5">5</span> min</div>
```

Then update the counter animation JS (around line 1152) to set `el.textContent = '0'` at the start of each counter's animation, so with JS the counter still animates from 0, but without JS the real value shows.

**Only actual animated counters need this fix** — static values in `.asset-bar-count`, `.metric-value`, etc. are NOT animated counters. The actual counters to fix are:

- Scenario 1: `5` min, `47` colors, `12` font sizes, `8` weights, `19` spacing, `86` CSS vars, `5` breakpoints
- Scenario 2: `3` sites, `42` pages crawled, `156` SEO fields, `23` diffs
- Scenario 3: `4` issues, `8` pages, `200` contrast checks, `12` forms
- Scenario 4: `50` pages (this is the ONLY counter in scenario 4 — the asset bar values like 168 images, 154 links, etc. are static text, not animated counters)

- [ ] **Step 3: Add mobile layout fix**

Add to the `<style>` block:
```css
@media (max-width: 768px) {
  .scenario-body {
    grid-template-columns: 1fr;
  }
  .scenario:nth-child(even) .scenario-body {
    direction: ltr;
  }
  [data-theme="dark"] .rain-container { display: none; }
}
```

- [ ] **Step 4: Update footer and add OG meta tags**

Same standardized footer as product page. Add OG tags:
```html
<meta property="og:title" content="TAPSITE — Real World Workflows">
<meta property="og:description" content="Four real-world workflows: design system extraction, competitive research, accessibility auditing, and asset migration.">
<meta property="og:type" content="website">
```

- [ ] **Step 5: Open in browser and verify**

```bash
xdg-open docs/scenarios.html
```

Verify:
- Light theme default with readable text
- Dark toggle works with rain
- Counter values show real numbers (not 0) on initial load
- Disable JS in browser devtools: counters still show real values, toggle hidden
- Mobile responsive: resize to 768px, scenarios stack single-column
- Footer has GitHub/npm links

- [ ] **Step 6: Commit**

```bash
git add docs/scenarios.html
git commit -m "feat: apply dual-theme to scenarios page, fix noscript counters and mobile layout

Counter fallbacks show real values without JS. Mobile layout forces
single-column below 768px. Standardized footer with GitHub/npm links."
```

---

### Task 5: Apply Theme System to Showcase Design Page

**Files:**
- Modify: `docs/showcase-design.html`

- [ ] **Step 1: Replace CSS variables, remove scanlines/grain, add theme toggle**

Same pattern as previous tasks. Key consideration: data visualizations (color swatches, performance bars, breakpoint dots) keep their neon/vivid colors in both themes — only the card backgrounds and text switch.

Specific attention needed for:
- `.dossier` card backgrounds: `var(--bg-card)` with `var(--border)` border
- Performance bar backgrounds: keep colored fills, but the track behind them uses `var(--bg-secondary)`
- Color swatch displays: keep the actual extracted colors (they're data, not theme), but labels use `var(--text-secondary)`
- The hero background glows: only visible in `[data-theme="dark"]`

- [ ] **Step 2: Update footer and add OG meta tags**

Standardized footer. OG tags:
```html
<meta property="og:title" content="TAPSITE — Design System Extraction Showcase">
<meta property="og:description" content="Real design data extracted from Stripe, Linear, and Vercel. Colors, fonts, performance, breakpoints — every design decision revealed.">
<meta property="og:type" content="website">
```

- [ ] **Step 3: Open in browser and verify**

Verify:
- Light theme: data cards on white/light background, color swatches still show vivid extracted colors
- Dark theme: existing cyberpunk look preserved, neon accents on data
- Performance bars readable in both themes
- Mobile: rain hidden below 768px

- [ ] **Step 4: Commit**

```bash
git add docs/showcase-design.html
git commit -m "feat: apply dual-theme to design showcase page

Data visualizations keep vivid colors in both themes. Card backgrounds
and text adapt to light/dark. Standardized footer."
```

---

### Task 6: Apply Theme System to Showcase Deep Page

**Files:**
- Modify: `docs/showcase-deep.html`

- [ ] **Step 1: Replace CSS variables, remove scanlines/grain, add theme toggle**

Same pattern. Additional attention for:
- Accessibility gauge SVG circles: keep colored strokes (green/red/yellow), track uses `var(--bg-secondary)`
- Form table: borders use `var(--border)`, method badges (GET=green, POST=orange) keep their colors
- Asset inventory bars: keep colored fills, track uses `var(--bg-secondary)`
- Component detection bars: keep accent colors
- Link type badges (INT/EXT): keep their distinct colors

- [ ] **Step 2: Update footer and add OG meta tags**

Standardized footer. OG tags:
```html
<meta property="og:title" content="TAPSITE — Deep Intelligence Showcase">
<meta property="og:description" content="Accessibility audits, content extraction, form analysis, asset inventory, component detection, and spacing forensics from real websites.">
<meta property="og:type" content="website">
```

- [ ] **Step 3: Open in browser and verify**

Verify:
- Light theme: all data visualizations readable on light background
- A11y gauges: colored rings on light card backgrounds
- Form tables: clean borders, method badges visible
- Dark theme: existing look preserved

- [ ] **Step 4: Commit**

```bash
git add docs/showcase-deep.html
git commit -m "feat: apply dual-theme to deep showcase page

Gauges, form tables, asset bars, component charts keep vivid data
colors in both themes. Standardized footer."
```

---

### Task 7: Update tapsite-promo.html

This page keeps its own aesthetic (Inter + JetBrains Mono). No dual-theme system. Only content updates.

**Files:**
- Modify: `tapsite-promo.html`

- [ ] **Step 1: Verify "View on GitHub" link**

Search for the GitHub link in the file and verify it points to `https://github.com/mgriffen/tapsite`. Fix if incorrect.

```bash
grep -n "github" tapsite-promo.html
```

- [ ] **Step 2: Add shields.io badges**

Find the hero section's CTA area and add after the install command block:

```html
<div class="badges-row">
  <img alt="GitHub stars" src="https://img.shields.io/github/stars/mgriffen/tapsite?style=flat-square&color=0055b3">
  <img alt="npm downloads" src="https://img.shields.io/npm/dm/tapsite?style=flat-square&color=00727d">
</div>
```

Add minimal CSS for `.badges-row`:
```css
.badges-row { display: flex; gap: 0.5rem; align-items: center; margin-top: 1rem; }
.badges-row img { height: 20px; }
```

- [ ] **Step 3: Add compatibility badges**

Find the footer or CTA section and add:
```html
<div class="compat-row">
  <span class="compat-badge">Claude</span>
  <span class="compat-badge">Cursor</span>
  <span class="compat-badge">Windsurf</span>
  <span class="compat-badge">Any MCP Agent</span>
</div>
```

Add CSS matching the page's existing Inter/JetBrains Mono aesthetic:
```css
.compat-row { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; margin-top: 1.5rem; }
.compat-badge {
  font-family: 'JetBrains Mono', monospace; font-size: 0.75rem;
  padding: 0.3rem 0.8rem; border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 999px; color: #94a3b8; letter-spacing: 0.05em;
}
```

- [ ] **Step 4: Add LangChain to compatibility line**

Find the existing "Works with any MCP-compatible AI agent" text in the footer and append ". LangChain/LangGraph compatible."

- [ ] **Step 5: Fix tool category grid to total 43**

The promo page has a 6-category grid that currently sums to ~35 tools. Replace the tool tags in each category to match the canonical 43-tool set. The promo page uses a different category grouping than the product page (6 broader categories vs 9 specific ones), which is fine — but the tools must all be present.

Replace the content of each `.tool-tags` div:

**Session** (5 tags — grouped for marketing, not 1:1 with tool names):
`login` `inspect` `screenshot` `interact` `scroll`

**Design System** (8 tags):
`colors` `fonts` `spacing` `breakpoints` `shadows` `icons` `css vars` `contrast`

**Content** (7 tags):
`metadata` `forms` `tables` `links` `images` `SVGs` `content`

**Analysis** (7 tags):
`a11y` `perf` `components` `layout` `stack` `dark mode` `animations`

**Workflows** (4 tags):
`teardown` `audit` `harvest` `designsystem`

**Intelligence** (6 tags):
`diff pages` `crawl` `network` `run js` `export` `design report`

Also update subtitle from "six categories" to match, and update the section subtitle `43 specialized tools` (already correct).

Note: The promo page uses friendly short names as tags (e.g., "login" for login/login_manual/login_check/close, "network" for capture_network). The total displayed tag count (37) won't match 43 because some tags represent multiple tools. This is acceptable for marketing — the "43 specialized tools" heading is the accurate number. Add `run_js`, `close`, `login_manual`, `login_check`, `download_images`, and `favicon` tags to bring the visible count closer to 43, or keep the curated shorter list if it reads better.

- [ ] **Step 6: Open in browser and verify**

```bash
xdg-open tapsite-promo.html
```

Verify: badges visible, compat logos visible, tool counts correct, LangChain mentioned.

- [ ] **Step 7: Commit**

```bash
git add tapsite-promo.html
git commit -m "feat: add badges, compat logos, and LangChain mention to promo page

Shields.io badges for GitHub stars and npm downloads. Compatibility
badges for Claude, Cursor, Windsurf. Tool grid verified at 43."
```

---

### Task 8: Cross-Cutting Verification Pass

Final pass to catch anything missed across all pages.

**Files:**
- Verify: all `docs/*.html` and `tapsite-promo.html`

- [ ] **Step 1: Verify all pages say 43 tools**

```bash
grep -n "37\|43" docs/*.html tapsite-promo.html | grep -i "tool"
```

Expected: only "43" matches, zero "37" matches.

- [ ] **Step 2: Verify no scanlines or grain remain**

```bash
grep -n "scanline\|\.grain" docs/*.html
```

Expected: no matches.

- [ ] **Step 3: Verify all footers have GitHub/npm links**

```bash
grep -n "github.com/mgriffen/tapsite\|npmjs.com/package/tapsite" docs/*.html
```

Expected: matches in all 5 `docs/` pages.

- [ ] **Step 4: Verify OG tags in all docs pages**

```bash
grep -n "og:title\|og:description" docs/*.html
```

Expected: matches in all 5 `docs/` pages (index, product, scenarios, showcase-design, showcase-deep).

- [ ] **Step 5: Verify theme toggle in all docs pages**

```bash
grep -n "theme-toggle" docs/*.html
```

Expected: matches in all 5 pages.

- [ ] **Step 6: Verify deleted files are gone**

```bash
ls tapsite-ad*.html tapsite-showcase*.html tapsite-scenarios.html 2>&1
```

Expected: "No such file or directory" for all 5.

- [ ] **Step 7: Open each page in browser for visual spot-check**

Open all pages and quickly verify light/dark toggle works on each:
```bash
for f in docs/index.html docs/product.html docs/scenarios.html docs/showcase-design.html docs/showcase-deep.html tapsite-promo.html; do xdg-open "$f"; sleep 1; done
```

- [ ] **Step 8: Commit any fixes from this pass**

Only if issues were found:
```bash
git add -A
git commit -m "fix: cross-cutting fixes from verification pass"
```
