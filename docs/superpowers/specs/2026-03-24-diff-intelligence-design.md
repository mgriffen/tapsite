# Phase 5B: Diff Intelligence

> Design spec — 2026-03-24

## Context

tapsite has 43 tools including 4 workflow presets (teardown, audit, harvest, designsystem). The existing `tapsite_diff_pages` tool compares two URLs but uses inline DOM scraping instead of the real extractors, producing shallow results (heading text, word counts, basic color sampling). This upgrade replaces the inline scraper with real extractors, adds temporal diffing via snapshots, and introduces per-extractor diff logic.

Phase 5A (extraction presets / `tapsite_analyze`) is skipped — the existing workflow tools already cover those use cases. Phase 5C (watch mode) is deferred — MCP servers aren't natural cron runners, and snapshot storage makes watch trivial to add later if demand materializes.

## Scope

- Upgrade `tapsite_diff_pages` to use real extractors
- Add snapshot storage for temporal diffs
- Per-extractor diff logic in an isolated, testable module
- No new tools — this is an upgrade to an existing tool

## Design

### 1. Snapshot Storage (`src/snapshots.js`)

Snapshots persist extractor output for temporal diffs.

```
output/snapshots/{domain}/{extractorName}-{urlHash}-{timestamp}.json
```

The `urlHash` is the first 8 characters of a SHA-256 hash of the full URL (origin + pathname). This distinguishes snapshots for different pages on the same domain (e.g., `example.com/pricing` vs `example.com/about`).

Each file:
```json
{
  "url": "https://example.com/pricing",
  "extractor": "colors",
  "timestamp": "2026-03-24T14:30:00.000Z",
  "version": "3.1.1",
  "data": { ... }
}
```

**Exports:**

- `saveSnapshot(url, extractorName, data)` — writes snapshot, returns file path
- `loadLatestSnapshot(url, extractorName)` — reads most recent snapshot matching the URL (via urlHash) and extractor name. Returns `{ timestamp, data }` or `null`

Domain is derived from `new URL(url).hostname`. Timestamps use ISO format with colons/dots replaced for filesystem safety.

No retention policy. Files accumulate until the user deletes them. The `output/` directory is already gitignored.

The `version` field is informational only — no compatibility check. If extractor shapes change across versions, old snapshots may produce odd diffs; the user can delete `output/snapshots/` to reset. This is acceptable for v1.

### 2. Diff Logic (`src/diff.js`)

A single entry point: `diffExtractorResult(extractorName, before, after)` that dispatches to per-extractor diff functions.

Each diff function returns a consistent shape:
```json
{
  "added": [],
  "removed": [],
  "unchanged": 0,
  "deltas": {}
}
```

Fields are populated as appropriate per extractor — some only use `added/removed` (set-based), others only use `deltas` (numeric).

#### Per-extractor strategies:

| Extractor | Key field(s) | Strategy |
|---|---|---|
| colors | `colors[].hex` | Set diff on hex values |
| fonts | `families[].value` | Set diff on family names |
| spacing | `spacing[].value`, `inferredBase` | Set diff on values, delta on inferredBase |
| components | `components[].name` | Set diff on component names |
| breakpoints | `breakpoints[].value` | Set diff on pixel values |
| a11y | `score`, `issues[].message` | Score delta, set diff on issue messages |
| perf | `timing.ttfbMs`, `timing.loadMs`, `dom.nodeCount` | Numeric deltas |
| metadata | `title`, `description`, `openGraph` | Field-by-field string equality |
| contrast | `passing`, `failing`, `worstPairs` | Count deltas, list new entries in worstPairs |

#### Extractor name mapping and default arguments

The `extractors` param accepts short names. Each entry maps to a browser function and its default arguments (matching the values used by the workflow tools):

```
colors       → extractColorsInBrowser        { limit: 50 }
fonts        → extractFontsInBrowser          (no args)
spacing      → extractSpacingInBrowser        { sampleSize: 200 }
components   → extractComponentsInBrowser     { minOccurrences: 2 }
breakpoints  → extractBreakpointsInBrowser    (no args)
a11y         → extractA11yInBrowser           { standard: 'aa' }
perf         → extractPerfInBrowser           (no args)
metadata     → extractMetadataInBrowser       (no args)
contrast     → extractContrastInBrowser       { sampleSize: 200, standard: 'aa' }
```

This mapping (name → function + default args) lives in `src/diff.js` alongside the diff logic, since the diff module already needs to know about extractor shapes.

### 3. Upgraded `tapsite_diff_pages` (in `src/tools/multipage.js`)

**New signature:**
```
tapsite_diff_pages({
  url1: string,
  url2?: string,
  extractors?: string[]
})
```

- `url1` — required. First URL, or the only URL for temporal mode.
- `url2` — optional. If provided: cross-site mode. If omitted: temporal mode.
- `extractors` — optional. Which extractors to run. Default: `["colors", "fonts", "spacing", "a11y", "perf", "metadata", "components", "breakpoints"]`. Available values match extractor names.

**Breaking changes from current signature:**
- `viewport1`/`viewport2` params are removed. Responsive comparison was not the core use case and added complexity. Users who need viewport-specific extraction can set viewport via `tapsite_interact` before calling diff.

**Mode inference:**
- Both URLs provided → **cross-site**: extract both, diff results
- Only url1 → **temporal**: extract now, load latest snapshot, diff. If no snapshot exists, save baseline and return "Baseline captured — no previous data to compare."

**Execution flow:**

1. Validate URLs via `requireSafeUrl()`
2. Navigate to url1 via `navigateIfNeeded(url1)`, run selected extractors via `safeEvaluate()` with default args from the mapping
3. If cross-site: navigate to url2 via raw `page.goto()` (must force navigation since `navigateIfNeeded` would skip if same domain), run same extractors
4. If temporal: load latest snapshots for each extractor
5. Run `diffExtractorResult()` for each extractor
6. If temporal: save current results as new snapshots
7. Build summary highlighting regressions
8. Return via `summarizeResult()`

**Error handling per extractor:** Individual extractor failures (timeouts, errors) are caught and reported inline rather than killing the whole operation:
```json
{
  "colors": { "added": [...], "removed": [...], "unchanged": 5 },
  "fonts": { "error": "Evaluation timed out after 30000ms" },
  "a11y": { "deltas": { "score": -5 }, ... }
}
```

The summary notes which extractors failed so the LLM can report partial results.

**Output structure:**
```json
{
  "mode": "cross-site | temporal",
  "urls": { "before": "...", "after": "..." },
  "timestamps": { "before": "...", "after": "..." },
  "extractors": ["colors", "fonts", ...],
  "changes": {
    "colors": { "added": [...], "removed": [...], "unchanged": 5 },
    "fonts": { "added": [...], "removed": [...], "unchanged": 2 },
    "a11y": { "deltas": { "score": -5 }, "added": ["new issues..."], "removed": ["resolved..."] },
    "perf": { "deltas": { "loadMs": 200, "ttfbMs": 50, "nodeCount": 100 } },
    ...
  },
  "summary": {
    "totalChanges": 12,
    "regressions": ["a11y score dropped 5 points", "load time +200ms"],
    "improvements": ["2 contrast issues resolved"],
    "errors": ["fonts: timed out"]
  }
}
```

**Summary text** leads with regressions so the LLM surfaces them:
```
DIFF: example.com (temporal, 3 days since last snapshot)

REGRESSIONS:
  a11y score: 85 → 80 (-5)
  Load time: 1200ms → 1400ms (+200ms)

IMPROVEMENTS:
  Contrast: 3 failing → 1 failing (-2)

CHANGES:
  Colors: +1 added, -0 removed (6 total)
  Fonts: no change (3 total)
  Components: +2 added (12 total)
```

## Files touched

| File | Change |
|---|---|
| `src/snapshots.js` | **New** — saveSnapshot, loadLatestSnapshot |
| `src/diff.js` | **New** — diffExtractorResult, extractor name/args map |
| `src/tools/multipage.js` | **Modified** — rewrite tapsite_diff_pages |
| `test/diff.test.js` | **New** — unit tests for diff logic |
| `test/snapshots.test.js` | **New** — unit tests for snapshot I/O |

## Testing

- **diff.js**: Pure function tests. Feed known before/after extractor outputs, assert diff shape. Cover each extractor strategy.
- **snapshots.js**: Write to a temp dir, read back, verify latest-finding logic. Test missing snapshot returns null. Test URL hash distinguishes different paths on same domain.
- **Integration**: Existing MCP server test pattern can verify the upgraded tool registers with correct schema.

## Security

- Snapshots write to `output/` which is gitignored — no risk of committing extraction data
- URLs validated via `requireSafeUrl()` (existing SSRF protection)
- All extractor calls go through `safeEvaluate()` (existing 30s timeout)
- Snapshot filenames derived from `URL.hostname` + hash — sanitized, no path traversal risk
- No new environment variables or permissions required

## Version

This ships as `v4.0.0` per the roadmap (Phase 5 = new feature addition with changed tool signature).

## What's deferred

- **Watch mode (5C)**: Snapshot storage makes this easy to add later. A `tapsite_watch` tool would just call `tapsite_diff_pages` in temporal mode and format the output for monitoring. Not building it until there's demand.
- **Design system diff**: Comparing two sites' design tokens (fonts, colors, spacing side by side) is a natural extension but not in this scope. The cross-site mode with `extractors: ["colors", "fonts", "spacing"]` covers the basic case.
