#!/usr/bin/env node

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { chromium } = require("playwright");
const { inspectPage, inspectPageV2 } = require("./inspector");
const { createRunDir, screenshotPath, exportJSON, exportMarkdown, exportHTML, exportCSV } = require("./exporter");
const {
  extractColorsInBrowser,
  extractFontsInBrowser,
  extractCssVarsInBrowser,
  extractSpacingInBrowser,
  extractImagesInBrowser,
  extractSvgsInBrowser,
  extractFaviconInBrowser,
  extractLayoutInBrowser,
  extractComponentsInBrowser,
  extractBreakpointsInBrowser,
  detectStackInBrowser,
  extractMetadataInBrowser,
  extractContentInBrowser,
  extractFormsInBrowser,
  extractAnimationsInBrowser,
  extractA11yInBrowser,
  detectDarkmodeInBrowser,
  extractPerfInBrowser,
} = require("./extractors");
const { sanitizeForLLM } = require("./sanitizer");
const config = require("./config");
const fs = require("fs");
const path = require("path");

// Shared browser state
let context = null;
let page = null;
let isHeadless = null;
let elementMap = []; // indexed interactive elements, refreshed on each action/navigation

async function ensureBrowser(headless = true) {
  // If we have a context but need a different mode, close it first
  if (context && isHeadless !== headless) {
    await closeBrowser();
  }
  if (context) return;
  fs.mkdirSync(config.PROFILE_DIR, { recursive: true });
  context = await chromium.launchPersistentContext(config.PROFILE_DIR, {
    headless,
    viewport: config.VIEWPORT,
    ignoreHTTPSErrors: false,
    acceptDownloads: false,
  });
  isHeadless = headless;
  page = context.pages()[0] || (await context.newPage());
}

async function closeBrowser() {
  if (context) {
    await context.close();
    context = null;
    page = null;
    isHeadless = null;
    elementMap = [];
  }
}

/**
 * Navigate to a URL if provided. Swallows errors (continues with whatever loaded).
 * Most tools accept an optional `url` param — this centralizes the boilerplate.
 */
async function navigateIfNeeded(url, waitMs = 1500) {
  if (!url) return;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  } catch {}
  await page.waitForTimeout(waitMs);
}

/**
 * Write full extraction data to disk and return a compact summary for the context window.
 */
function summarizeResult(name, data, summary) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(config.OUTPUT_DIR, 'extractions');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${name}-${ts}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  const sanitized = sanitizeForLLM(summary);
  return {
    content: [{ type: "text", text: `${sanitized}\n\nFull data: ${filePath}` }],
  };
}

/**
 * Re-index the current page: extract interactive elements and compressed DOM.
 * Stores element map in module state for use by cbrowser_act.
 */
async function indexPage() {
  const result = await inspectPageV2(page);
  elementMap = result.elements;
  return result;
}

/**
 * Resolve an element index to a Playwright locator.
 */
function resolveElement(index) {
  const el = elementMap.find((e) => e.index === index);
  if (!el) {
    throw new Error(
      `Element [${index}] not found. Valid indices: 1-${elementMap.length}. Re-inspect the page to get updated indices.`
    );
  }
  return { locator: page.locator(el.selector).first(), element: el };
}

/**
 * Format index result as a response string.
 */
function formatIndexResult(result) {
  const text = `Title: ${result.title}\nURL: ${result.url}\n\nInteractive elements: ${result.elements.length}\n\n${result.compressedDOM}`;
  return sanitizeForLLM(text);
}

const server = new McpServer({
  name: "cbrowser",
  version: "3.0.0",
});

// --- Tools ---

server.tool(
  "cbrowser_login",
  "Auto-login with credentials. Session persists across calls.",
  {
    url: z.string().describe("Login page URL"),
    username: z.string().describe("Username"),
    password: z.string().describe("Password"),
    usernameSelector: z
      .string()
      .default('input[name="username"]')
      .describe("Username field selector"),
    passwordSelector: z
      .string()
      .default('input[name="password"]')
      .describe("Password field selector"),
    submitSelector: z
      .string()
      .default('input[type="submit"]')
      .describe("Submit button selector"),
  },
  async ({ url, username, password, usernameSelector, passwordSelector, submitSelector }) => {
    await ensureBrowser();
    await page.goto(url);
    await page.fill(usernameSelector, username);
    await page.fill(passwordSelector, password);
    await page.click(submitSelector);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);

    const title = await page.title();
    const currentUrl = page.url();
    const bodyPreview = await page.evaluate(() =>
      (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 500)
    );

    return {
      content: [
        {
          type: "text",
          text: `Logged in successfully.\nTitle: ${title}\nURL: ${currentUrl}\n\nPage preview:\n${bodyPreview}`,
        },
      ],
    };
  }
);

server.tool(
  "cbrowser_login_manual",
  "Open headed browser for manual login (MFA). Call login_check when done.",
  {
    url: z.string().describe("Login page URL"),
  },
  async ({ url }) => {
    await ensureBrowser(false); // headed mode
    await page.goto(url);

    const title = await page.title();
    return {
      content: [
        {
          type: "text",
          text: `Browser window opened to: ${url}\nPage title: ${title}\n\nThe user should now log in manually (including MFA/authenticator). Once they confirm they are logged in, use cbrowser_login_check to verify the session.`,
        },
      ],
    };
  }
);

server.tool(
  "cbrowser_login_check",
  "Verify auth state after manual login. Returns title, URL, content preview.",
  {},
  async () => {
    if (!context || !page) {
      return {
        content: [
          {
            type: "text",
            text: "No browser session active. Use cbrowser_login_manual to open a browser first.",
          },
        ],
      };
    }

    const title = await page.title();
    const currentUrl = page.url();
    const bodyPreview = await page.evaluate(() =>
      (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1000)
    );

    return {
      content: [
        {
          type: "text",
          text: `Current page:\nTitle: ${title}\nURL: ${currentUrl}\n\nContent preview:\n${bodyPreview}`,
        },
      ],
    };
  }
);

server.tool(
  "cbrowser_navigate",
  "Navigate to URL. Returns compressed DOM with numbered interactive elements.",
  {
    url: z.string().describe("URL to navigate to"),
  },
  async ({ url }) => {
    await ensureBrowser();
    await navigateIfNeeded(url);

    const result = await indexPage();
    return {
      content: [
        {
          type: "text",
          text: formatIndexResult(result),
        },
      ],
    };
  }
);

server.tool(
  "cbrowser_inspect",
  "Inspect page DOM with numbered interactive elements. Optional screenshot.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
    screenshot: z.boolean().default(false).describe("Include screenshot"),
  },
  async ({ url, screenshot }) => {
    await ensureBrowser();
    await navigateIfNeeded(url);

    const result = await indexPage();
    const content = [
      {
        type: "text",
        text: formatIndexResult(result),
      },
    ];

    if (screenshot) {
      const buffer = await page.screenshot({ fullPage: true });
      content.push({
        type: "image",
        data: buffer.toString("base64"),
        mimeType: "image/png",
      });
    }

    return { content };
  }
);

server.tool(
  "cbrowser_screenshot",
  "Screenshot the page. Optional element highlighting with numbered badges.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
    fullPage: z.boolean().default(true).describe("Full scrollable page"),
    highlight: z
      .boolean()
      .default(false)
      .describe("Overlay numbered element badges"),
  },
  async ({ url, fullPage, highlight }) => {
    await ensureBrowser();
    await navigateIfNeeded(url);

    // If highlight requested, index the page and inject overlays
    if (highlight) {
      if (!elementMap.length) {
        await indexPage();
      }
      await page.evaluate((elements) => {
        const container = document.createElement("div");
        container.id = "__cbrowser_highlights__";
        container.style.cssText = "position:absolute;top:0;left:0;z-index:999999;pointer-events:none;";
        for (const el of elements) {
          const badge = document.createElement("div");
          badge.className = "__cbrowser_badge__";
          badge.textContent = el.index;
          badge.style.cssText = `
            position:absolute;
            left:${el.boundingBox.x}px;
            top:${Math.max(0, el.boundingBox.y - 16)}px;
            background:#e53e3e;
            color:#fff;
            font-size:11px;
            font-weight:bold;
            padding:1px 4px;
            border-radius:3px;
            font-family:monospace;
            line-height:14px;
            white-space:nowrap;
          `;
          container.appendChild(badge);
        }
        document.body.appendChild(container);
      }, elementMap);
    }

    const buffer = await page.screenshot({ fullPage });

    // Remove overlays
    if (highlight) {
      await page.evaluate(() => {
        document.getElementById("__cbrowser_highlights__")?.remove();
      });
    }

    return {
      content: [
        {
          type: "image",
          data: buffer.toString("base64"),
          mimeType: "image/png",
        },
      ],
    };
  }
);

server.tool(
  "cbrowser_extract_table",
  "Extract table data as structured rows.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
    minColumns: z.number().default(2).describe("Min columns per row"),
    limit: z.number().default(50).describe("Max rows"),
  },
  async ({ url, minColumns, limit }) => {
    await ensureBrowser();
    await navigateIfNeeded(url);

    const tableData = await page.evaluate(
      ({ minColumns, limit }) => {
        const rows = [...document.querySelectorAll("tr")];
        const results = [];
        for (const row of rows) {
          const cells = [...row.querySelectorAll("td, th")];
          if (cells.length >= minColumns) {
            const rowData = cells.map((c) => {
              const text = c.textContent.trim();
              const link = c.querySelector("a")?.href || undefined;
              const imgAlt = c.querySelector("img")?.alt || undefined;
              return { text: text.slice(0, 200), link, imgAlt };
            });
            results.push(rowData);
            if (results.length >= limit) break;
          }
        }
        return results;
      },
      { minColumns, limit }
    );

    const rows = tableData || [];
    const cols = rows[0]?.length || 0;
    const headers = rows[0]?.map(c => c.text).join(' | ') || '';
    const preview = rows.slice(1, 4).map(r => r.map(c => c.text?.slice(0, 25)).join(' | ')).join('\n  ');
    const summary = `Table: ${rows.length} rows x ${cols} columns\nHeaders: ${headers}\nPreview:\n  ${preview || '(empty)'}`;
    return summarizeResult('table', tableData, summary);
  }
);

server.tool(
  "cbrowser_extract_links",
  "Extract all links with text and href.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
    filter: z.string().optional().describe("Filter: href contains this string"),
  },
  async ({ url, filter }) => {
    await ensureBrowser();
    await navigateIfNeeded(url);

    let links = await page.evaluate(() => {
      function isHiddenElement(el) {
        if (!el || el.nodeType !== 1) return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none') return true;
        if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
        if (parseFloat(cs.opacity) === 0) return true;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0 && cs.overflow === 'hidden') return true;
        if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(100%)') return true;
        if (cs.position === 'absolute' || cs.position === 'fixed') {
          if (rect.right < 0 || rect.bottom < 0 || rect.left > window.innerWidth || rect.top > window.innerHeight) {
            if (rect.width < 2 || rect.height < 2) return true;
          }
        }
        return false;
      }
      return [...document.querySelectorAll("a[href]")]
        .filter(a => !isHiddenElement(a))
        .map((a) => ({
          text: a.textContent.trim() || a.querySelector("img")?.alt || "(image link)",
          href: a.href,
        }));
    });

    if (filter) {
      links = links.filter((l) => l.href.includes(filter));
    }

    const pageUrl = page.url();
    let internal = 0, external = 0;
    try {
      const host = new URL(pageUrl).hostname;
      links.forEach(l => { try { new URL(l.href).hostname === host ? internal++ : external++; } catch { external++; } });
    } catch { external = links.length; }
    const sample = links.slice(0, 6).map(l => `${l.text.slice(0, 30)} (${l.href.slice(0, 50)})`).join('\n  ');
    const summary = `Links: ${links.length} found (${internal} internal, ${external} external)\n  ${sample || 'none'}`;
    return summarizeResult('links', links, summary);
  }
);

server.tool(
  "cbrowser_run_js",
  "Run JS in page context. Large results (>2KB) write to disk.",
  {
    script: z.string().describe("JS expression (must return a value)"),
  },
  async ({ script }) => {
    await ensureBrowser();
    const result = await page.evaluate(script);
    const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    if (text.length > 2000) {
      const preview = text.slice(0, 500) + '\n…(truncated)';
      return summarizeResult('run-js', result, `Result (${text.length} chars, truncated):\n${preview}`);
    }
    return { content: [{ type: "text", text: sanitizeForLLM(text) }] };
  }
);

server.tool(
  "cbrowser_export",
  "Export URLs as Markdown + HTML report + JSON + CSV + screenshots.",
  {
    urls: z.array(z.string()).describe("URLs to export"),
  },
  async ({ urls }) => {
    await ensureBrowser();
    const runDir = createRunDir();
    const results = [];

    for (const [i, url] of urls.entries()) {
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      } catch {}
      await page.waitForTimeout(1500);

      const data = await inspectPage(page);
      await page.screenshot({ path: screenshotPath(runDir, i), fullPage: true });
      results.push(data);
    }

    const jsonPath = exportJSON(runDir, results);
    const mdPath = exportMarkdown(runDir, results);
    const htmlPath = exportHTML(runDir, results);
    const csvFiles = exportCSV(runDir, results);

    const lines = [
      `Exported ${results.length} page(s) to ${runDir}`,
      `  JSON:     ${jsonPath}`,
      `  Markdown: ${mdPath}`,
      `  HTML:     ${htmlPath}`,
      `  Screenshots: ${runDir}/screenshots/`,
    ];
    if (csvFiles.length) {
      lines.push(`  CSV tables (${csvFiles.length}): ${csvFiles.map(f => path.basename(f)).join(', ')}`);
    }

    return {
      content: [{ type: "text", text: lines.join('\n') }],
    };
  }
);

server.tool(
  "cbrowser_act",
  "Click, fill, select, check, or hover an indexed element. Returns updated DOM.",
  {
    action: z
      .enum(["click", "fill", "select", "check", "hover"])
      .describe("Action type"),
    index: z.number().describe("Element index from inspect/navigate"),
    value: z
      .string()
      .optional()
      .describe("Value for fill/select"),
  },
  async ({ action, index, value }) => {
    await ensureBrowser();
    if (!elementMap.length) {
      return {
        content: [
          {
            type: "text",
            text: "No element map available. Use cbrowser_navigate or cbrowser_inspect first to index the page.",
          },
        ],
      };
    }

    const { locator, element } = resolveElement(index);

    try {
      switch (action) {
        case "click":
          await locator.click();
          break;
        case "fill":
          if (!value && value !== "")
            return {
              content: [
                { type: "text", text: 'Error: "value" is required for fill action.' },
              ],
            };
          await locator.fill(value);
          break;
        case "select":
          if (!value)
            return {
              content: [
                { type: "text", text: 'Error: "value" is required for select action.' },
              ],
            };
          await locator.selectOption(value);
          break;
        case "check": {
          const checked = await locator.isChecked().catch(() => false);
          if (checked) {
            await locator.uncheck();
          } else {
            await locator.check();
          }
          break;
        }
        case "hover":
          await locator.hover();
          break;
      }
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Action "${action}" on [${index}] (${element.tag}) failed: ${err.message}`,
          },
        ],
      };
    }

    // Wait for any resulting navigation or rendering
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(500);

    // Re-index and return updated state
    const result = await indexPage();
    return {
      content: [
        {
          type: "text",
          text: `Action "${action}" on [${index}] (${element.tag} "${element.text || ""}") completed.\n\n${formatIndexResult(result)}`,
        },
      ],
    };
  }
);

server.tool(
  "cbrowser_scroll",
  "Scroll page or scroll an element into view.",
  {
    direction: z
      .enum(["up", "down", "top", "bottom"])
      .optional()
      .describe("Direction (ignored if index set)"),
    index: z
      .number()
      .optional()
      .describe("Element index to scroll to"),
  },
  async ({ direction, index }) => {
    await ensureBrowser();

    if (index !== undefined) {
      const { locator } = resolveElement(index);
      await locator.scrollIntoViewIfNeeded();
    } else {
      const scrollMap = {
        up: "window.scrollBy(0, -window.innerHeight * 0.8)",
        down: "window.scrollBy(0, window.innerHeight * 0.8)",
        top: "window.scrollTo(0, 0)",
        bottom: "window.scrollTo(0, document.body.scrollHeight)",
      };
      await page.evaluate(scrollMap[direction || "down"]);
    }

    await page.waitForTimeout(300);

    const result = await indexPage();
    return {
      content: [
        {
          type: "text",
          text: `Scrolled ${index !== undefined ? `element [${index}] into view` : direction || "down"}.\n\n${formatIndexResult(result)}`,
        },
      ],
    };
  }
);

// --- Phase 1: Design Token Extraction ---

server.tool(
  "cbrowser_extract_colors",
  "Extract color palette sorted by frequency.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
    limit: z.number().default(30).describe("Max colors"),
  },
  async ({ url, limit }) => {
    await ensureBrowser();
    await navigateIfNeeded(url);
    const result = await page.evaluate(extractColorsInBrowser, { limit });
    const colors = result.colors || [];
    const top5 = colors.slice(0, 5).map(c => `${c.hex} (${c.count}x)`).join(', ');
    const summary = `Colors: ${colors.length} unique\nTop: ${top5 || 'none'}`;
    return summarizeResult('colors', result, summary);
  }
);

server.tool(
  "cbrowser_extract_fonts",
  "Extract fonts: families, sizes, weights, sources.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
  },
  async ({ url }) => {
    await ensureBrowser();
    await navigateIfNeeded(url);
    const result = await page.evaluate(extractFontsInBrowser);
    const families = (result.families || []).map(f => `"${f.value}" (${f.count}x)`).join(', ');
    const sizes = (result.sizes || []).slice(0, 5).map(s => s.value).join(', ');
    const summary = `Fonts: ${(result.families || []).length} families, ${(result.sizes || []).length} sizes, ${(result.weights || []).length} weights\nFamilies: ${families || 'none'}\nSizes: ${sizes || 'none'}`;
    return summarizeResult('fonts', result, summary);
  }
);

server.tool(
  "cbrowser_extract_css_vars",
  "Extract CSS custom properties, categorized by type.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
    includeAll: z.boolean().default(false).describe("Also scan inline styles"),
  },
  async ({ url, includeAll }) => {
    await ensureBrowser();
    await navigateIfNeeded(url);
    const result = await page.evaluate(extractCssVarsInBrowser, { includeAll });
    const vars = result.variables || [];
    const catStr = Object.entries(result.summary || {}).map(([k, v]) => `${k} (${v})`).join(', ');
    const samples = vars.slice(0, 4).map(v => `${v.name}: ${v.value}`).join(', ');
    const summary = `CSS vars: ${result.total || vars.length} total | ${catStr}\nSample: ${samples || 'none'}`;
    return summarizeResult('css-vars', result, summary);
  }
);

server.tool(
  "cbrowser_extract_spacing",
  "Extract spacing scale: margins, padding, gaps, radii.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
    sampleSize: z.number().default(200).describe("Max elements to sample"),
  },
  async ({ url, sampleSize }) => {
    await ensureBrowser();
    await navigateIfNeeded(url);
    const result = await page.evaluate(extractSpacingInBrowser, { sampleSize });
    const spacing = result.spacing || [];
    const scale = spacing.slice(0, 10).map(s => s.value).join(', ');
    const top5 = spacing.slice(0, 5).map(s => `${s.value} (${s.count}x)`).join(', ');
    const summary = `Spacing: ${spacing.length} values | Base: ${result.inferredBase || 'unknown'}\nScale: ${scale || 'none'}\nTop: ${top5 || 'none'}`;
    return summarizeResult('spacing', result, summary);
  }
);

// --- Phase 2: Visual Asset Extraction ---

server.tool(
  "cbrowser_extract_images",
  "Extract all images with src, dimensions, alt, format.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
    minWidth: z.number().default(1).describe("Min width in px"),
    filter: z.string().optional().describe("Filter: src contains string"),
  },
  async ({ url, minWidth, filter }) => {
    await ensureBrowser();
    await navigateIfNeeded(url);
    const result = await page.evaluate(extractImagesInBrowser, { minWidth, filter: filter || "" });
    const imgs = result.images || [];
    const byType = {};
    imgs.forEach(i => { byType[i.source || 'unknown'] = (byType[i.source || 'unknown'] || 0) + 1; });
    const typeStr = Object.entries(byType).map(([k, v]) => `${k} (${v})`).join(', ');
    const top3 = imgs.slice(0, 3).map(i => `${(i.src || '').split('/').pop()?.slice(0, 30)} ${i.width}x${i.height}`).join(', ');
    const summary = `Images: ${imgs.length} found | ${typeStr}\nTop: ${top3 || 'none'}`;
    return summarizeResult('images', result, summary);
  }
);

server.tool(
  "cbrowser_download_images",
  "Download images to disk. Uses session cookies for auth assets.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
    minWidth: z.number().default(50).describe("Min width in px"),
    filter: z.string().optional().describe("Filter: src contains string"),
    limit: z.number().default(50).describe("Max images"),
    formats: z.array(z.string()).optional().describe("Extensions filter (e.g. ['png','jpg'])"),
  },
  async ({ url, minWidth, filter, limit, formats }) => {
    await ensureBrowser();
    await navigateIfNeeded(url);

    // Discover images
    const { images } = await page.evaluate(extractImagesInBrowser, { minWidth, filter: filter || "" });

    // Filter by format if specified
    let toDownload = images;
    if (formats && formats.length > 0) {
      const exts = formats.map(f => f.toLowerCase().replace(/^\./, ""));
      toDownload = toDownload.filter(img => {
        const urlPath = new URL(img.src, page.url()).pathname.toLowerCase();
        return exts.some(ext => urlPath.endsWith(`.${ext}`));
      });
    }
    toDownload = toDownload.slice(0, limit);

    // Create output directory
    const assetsDir = path.join(config.OUTPUT_DIR, "assets", "images");
    fs.mkdirSync(assetsDir, { recursive: true });

    const downloaded = [];
    const errors = [];

    for (const img of toDownload) {
      try {
        const imgUrl = new URL(img.src, page.url()).href;
        const response = await page.context().request.get(imgUrl);
        if (!response.ok()) {
          errors.push({ src: img.src, status: response.status() });
          continue;
        }
        const body = await response.body();

        // Derive filename from URL
        const urlObj = new URL(imgUrl);
        let filename = path.basename(urlObj.pathname) || "image";
        // Sanitize filename
        filename = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
        // Deduplicate
        let savePath = path.join(assetsDir, filename);
        let counter = 1;
        while (fs.existsSync(savePath)) {
          const ext = path.extname(filename);
          const base = path.basename(filename, ext);
          savePath = path.join(assetsDir, `${base}_${counter}${ext}`);
          counter++;
        }

        fs.writeFileSync(savePath, body);
        downloaded.push({ src: img.src, saved: savePath, size: body.length });
      } catch (err) {
        errors.push({ src: img.src, error: err.message });
      }
    }

    const summary = `Downloaded ${downloaded.length}/${toDownload.length} images to ${assetsDir}\n` +
      downloaded.map(d => `  ✓ ${path.basename(d.saved)} (${(d.size / 1024).toFixed(1)}KB)`).join("\n") +
      (errors.length ? "\n\nErrors:\n" + errors.map(e => `  ✗ ${e.src}: ${e.error || `HTTP ${e.status}`}`).join("\n") : "");

    return {
      content: [{ type: "text", text: summary }],
    };
  }
);

server.tool(
  "cbrowser_extract_svgs",
  "Extract SVGs: inline markup, external URLs, icon/illustration classification.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
    limit: z.number().default(50).describe("Max SVGs"),
    download: z.boolean().default(false).describe("Download to output/assets/svgs/"),
  },
  async ({ url, limit, download }) => {
    await ensureBrowser();
    await navigateIfNeeded(url);
    const result = await page.evaluate(extractSvgsInBrowser, { limit });

    if (download) {
      const svgDir = path.join(config.OUTPUT_DIR, "assets", "svgs");
      fs.mkdirSync(svgDir, { recursive: true });
      let savedCount = 0;

      for (let i = 0; i < result.svgs.length; i++) {
        const svg = result.svgs[i];
        try {
          if (svg.type === "inline" && svg.markup && !svg.markup.endsWith("…")) {
            const filePath = path.join(svgDir, `inline_${i + 1}.svg`);
            fs.writeFileSync(filePath, svg.markup);
            svg.savedTo = filePath;
            savedCount++;
          } else if (svg.type === "external" && svg.src) {
            const response = await page.context().request.get(svg.src);
            if (response.ok()) {
              const body = await response.body();
              const filename = path.basename(new URL(svg.src, page.url()).pathname).replace(/[^a-zA-Z0-9._-]/g, "_") || `svg_${i + 1}.svg`;
              const filePath = path.join(svgDir, filename);
              fs.writeFileSync(filePath, body);
              svg.savedTo = filePath;
              savedCount++;
            }
          }
        } catch {}
      }
      result.downloaded = savedCount;
      result.downloadDir = svgDir;
    }

    const svgs = result.svgs || [];
    const inline = svgs.filter(s => s.type === 'inline').length;
    const external = svgs.filter(s => s.type === 'external').length;
    const icons = svgs.filter(s => s.classification === 'icon').length;
    const summary = `SVGs: ${svgs.length} total (${inline} inline, ${external} external) | Icons: ${icons}, Illustrations: ${svgs.length - icons}${result.downloaded != null ? ` | Downloaded: ${result.downloaded}` : ''}`;
    return summarizeResult('svgs', result, summary);
  }
);

server.tool(
  "cbrowser_extract_favicon",
  "Extract favicon and icon references. Optional download.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
    download: z.boolean().default(false).describe("Download to output/assets/favicons/"),
  },
  async ({ url, download }) => {
    await ensureBrowser();
    await navigateIfNeeded(url);
    const result = await page.evaluate(extractFaviconInBrowser);

    // If there's a manifest URL, try to fetch and extract its icons
    if (result.manifestUrl) {
      try {
        const response = await page.context().request.get(result.manifestUrl);
        if (response.ok()) {
          const manifest = JSON.parse(await response.text());
          if (manifest.icons && Array.isArray(manifest.icons)) {
            for (const icon of manifest.icons) {
              const src = new URL(icon.src, result.manifestUrl).href;
              result.icons.push({
                src,
                type: "manifest-icon",
                sizes: icon.sizes || null,
                mimeType: icon.type || null,
              });
            }
            result.total = result.icons.length;
          }
        }
      } catch {}
    }

    if (download) {
      const favDir = path.join(config.OUTPUT_DIR, "assets", "favicons");
      fs.mkdirSync(favDir, { recursive: true });
      let savedCount = 0;

      for (const icon of result.icons) {
        try {
          const response = await page.context().request.get(icon.src);
          if (response.ok()) {
            const body = await response.body();
            const urlObj = new URL(icon.src, page.url());
            let filename = path.basename(urlObj.pathname).replace(/[^a-zA-Z0-9._-]/g, "_") || "favicon";
            let savePath = path.join(favDir, filename);
            let counter = 1;
            while (fs.existsSync(savePath)) {
              const ext = path.extname(filename);
              const base = path.basename(filename, ext);
              savePath = path.join(favDir, `${base}_${counter}${ext}`);
              counter++;
            }
            fs.writeFileSync(savePath, body);
            icon.savedTo = savePath;
            savedCount++;
          }
        } catch {}
      }
      result.downloaded = savedCount;
      result.downloadDir = favDir;
    }

    const icons = result.icons || [];
    const types = {};
    icons.forEach(i => { types[i.type || 'icon'] = (types[i.type || 'icon'] || 0) + 1; });
    const typeStr = Object.entries(types).map(([k, v]) => `${k} (${v})`).join(', ');
    const sizes = icons.map(i => i.sizes).filter(Boolean).join(', ');
    const summary = `Favicons: ${icons.length} found | ${typeStr}\nSizes: ${sizes || 'none'}${result.downloaded != null ? `\nDownloaded: ${result.downloaded}` : ''}`;
    return summarizeResult('favicon', result, summary);
  }
);

// --- Phase 3: Layout Intelligence ---

/**
 * Format a layout tree node into an indented text representation.
 */
function formatLayoutTree(node, indent = "") {
  if (!node) return "";
  const attrs = [];
  if (node.display) attrs.push(node.display);
  if (node.direction) attrs.push(node.direction);
  if (node.columns) attrs.push(`cols: ${node.columns}`);
  if (node.rows) attrs.push(`rows: ${node.rows}`);
  if (node.gap) attrs.push(`gap: ${node.gap}`);
  if (node.justify) attrs.push(`justify: ${node.justify}`);
  if (node.align) attrs.push(`align: ${node.align}`);
  if (node.wrap) attrs.push(`wrap: ${node.wrap}`);
  if (node.position) attrs.push(`pos: ${node.position}`);
  const dims = `${node.w}×${node.h}`;
  const line = `${indent}${node.el} [${dims}] ${attrs.join(", ")}`;
  const lines = [line];
  if (node.children) {
    for (const child of node.children) {
      if (child === "…") {
        lines.push(`${indent}  …`);
      } else {
        lines.push(formatLayoutTree(child, indent + "  "));
      }
    }
  }
  return lines.join("\n");
}

server.tool(
  "cbrowser_extract_layout",
  "Extract layout tree: flex/grid/block containers with properties.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
    maxDepth: z.number().default(6).describe("Max tree depth"),
  },
  async ({ url, maxDepth }) => {
    await ensureBrowser();
    await navigateIfNeeded(url);
    const result = await page.evaluate(extractLayoutInBrowser, { maxDepth });
    const text = formatLayoutTree(result.layout);
    return {
      content: [{ type: "text", text }],
    };
  }
);

server.tool(
  "cbrowser_extract_components",
  "Detect repeated UI component patterns with instance counts.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
    minOccurrences: z.number().default(3).describe("Min occurrences to qualify"),
  },
  async ({ url, minOccurrences }) => {
    await ensureBrowser();
    await navigateIfNeeded(url);
    const result = await page.evaluate(extractComponentsInBrowser, { minOccurrences });
    const comps = result.components || [];
    const top5 = comps.slice(0, 5).map(c => `${c.tag}${c.classes ? '.' + c.classes.split(' ')[0] : ''} (${c.count}x)`).join('\n  ');
    const summary = `Components: ${comps.length} patterns detected\n  ${top5 || 'none'}`;
    return summarizeResult('components', result, summary);
  }
);

server.tool(
  "cbrowser_extract_breakpoints",
  "Extract CSS breakpoints and detect framework (Tailwind/Bootstrap/MUI).",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
  },
  async ({ url }) => {
    await ensureBrowser();
    await navigateIfNeeded(url);
    const result = await page.evaluate(extractBreakpointsInBrowser);
    const bps = result.breakpoints || [];
    const vals = bps.map(b => b.value || b.query || '').join(', ');
    const fw = (result.detectedFrameworks || []).length ? ` | Framework: ${result.detectedFrameworks.join(', ')}` : '';
    const summary = `Breakpoints: ${bps.length} found${fw}\nValues: ${vals || 'none'}\nViewport: ${result.viewport?.width || '?'}x${result.viewport?.height || '?'}`;
    return summarizeResult('breakpoints', result, summary);
  }
);

// --- Phase 4: Network Intelligence ---

// Resource types treated as static assets (filtered out by default)
const STATIC_RESOURCE_TYPES = new Set(["image", "stylesheet", "font", "media"]);

/**
 * Shared network capture helper. Sets up request/response listeners, waits for
 * `duration` seconds, then returns collected entries.
 */
async function captureNetwork({ duration, includeStatic, filterUrl, filterMethod }) {
  const entryMap = new Map(); // request -> entry object
  const bodyPromises = [];

  const onRequest = (req) => {
    if (!includeStatic && STATIC_RESOURCE_TYPES.has(req.resourceType())) return;
    const url = req.url();
    if (filterUrl && !url.includes(filterUrl)) return;
    if (filterMethod && req.method().toLowerCase() !== filterMethod.toLowerCase()) return;

    entryMap.set(req, {
      url,
      method: req.method(),
      resourceType: req.resourceType(),
      requestHeaders: req.headers(),
      postData: req.postData() || null,
    });
  };

  const onResponse = (res) => {
    const req = res.request();
    const entry = entryMap.get(req);
    if (!entry) return;

    entry.status = res.status();
    entry.responseHeaders = res.headers();
    entry.contentType = (res.headers()["content-type"] || "").split(";")[0].trim();

    const ct = entry.contentType;
    if (ct.includes("json") || ct.includes("text/plain") || ct.includes("text/html")) {
      const p = res.text().then((text) => {
        entry.responseBody = text.length > 10000 ? text.slice(0, 10000) + "…" : text;
      }).catch(() => {});
      bodyPromises.push(p);
    }
  };

  page.on("request", onRequest);
  page.on("response", onResponse);

  await page.waitForTimeout(duration * 1000);

  page.off("request", onRequest);
  page.off("response", onResponse);

  // Wait up to 2s for any pending body reads
  await Promise.all(bodyPromises.map((p) => Promise.race([p, new Promise((r) => setTimeout(r, 2000))])));

  return [...entryMap.values()].filter((e) => e.status !== undefined);
}

server.tool(
  "cbrowser_capture_network",
  "Capture network traffic for a duration. Filters static assets by default.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
    duration: z.number().default(10).describe("Seconds to capture"),
    includeStatic: z.boolean().default(false).describe("Include images/CSS/fonts"),
    filterUrl: z.string().optional().describe("Filter: URL contains string"),
    filterMethod: z.string().optional().describe("Filter: HTTP method (GET, POST)"),
  },
  async ({ url, duration, includeStatic, filterUrl, filterMethod }) => {
    await ensureBrowser();
    await navigateIfNeeded(url, 500);

    const requests = await captureNetwork({ duration, includeStatic, filterUrl, filterMethod });
    const data = { total: requests.length, requests };
    const byType = {};
    const byStatus = {};
    requests.forEach(r => {
      byType[r.resourceType || 'other'] = (byType[r.resourceType || 'other'] || 0) + 1;
      byStatus[r.status || '?'] = (byStatus[r.status || '?'] || 0) + 1;
    });
    const typeStr = Object.entries(byType).map(([k, v]) => `${k} (${v})`).join(', ');
    const statusStr = Object.entries(byStatus).map(([k, v]) => `${k} (${v})`).join(', ');
    const top5 = requests.slice(0, 5).map(r => `${r.method} ${r.url.slice(0, 60)} → ${r.status}`).join('\n  ');
    const summary = `Network: ${requests.length} requests (${duration}s)\nBy type: ${typeStr}\nBy status: ${statusStr}\nTop:\n  ${top5 || 'none'}`;
    return summarizeResult('network', data, summary);
  }
);

server.tool(
  "cbrowser_extract_api_schema",
  "Infer API schemas from captured network traffic.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
    duration: z.number().default(15).describe("Seconds to capture"),
    filterUrl: z.string().optional().describe("Filter: URL contains string"),
  },
  async ({ url, duration, filterUrl }) => {
    await ensureBrowser();
    await navigateIfNeeded(url, 500);

    const all = await captureNetwork({ duration, includeStatic: false, filterUrl, filterMethod: undefined });

    // Only analyze JSON responses
    const apiCalls = all.filter((r) => r.contentType && r.contentType.includes("json"));

    // Infer simple type schema from a parsed JSON value
    function inferSchema(value, depth = 0) {
      if (value === null) return "null";
      if (Array.isArray(value)) {
        if (value.length === 0) return "array<unknown>";
        const itemTypes = [...new Set(value.slice(0, 3).map((v) => inferSchema(v, depth + 1)))];
        return `array<${itemTypes.join("|")}>`;
      }
      const t = typeof value;
      if (t === "object") {
        if (depth >= 3) return "object";
        const schema = {};
        for (const [k, v] of Object.entries(value).slice(0, 30)) {
          schema[k] = inferSchema(v, depth + 1);
        }
        return schema;
      }
      return t;
    }

    // Normalize URL path: strip UUIDs and numeric IDs
    function normalizeUrl(rawUrl) {
      try {
        const u = new URL(rawUrl);
        const path = u.pathname
          .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/{uuid}")
          .replace(/\/\d{4,}/g, "/{id}")
          .replace(/\/\d+/g, "/{id}");
        return u.origin + path;
      } catch {
        return rawUrl;
      }
    }

    // Group by normalized endpoint
    const endpointMap = new Map(); // normalizedUrl+method -> aggregated info

    for (const req of apiCalls) {
      const normalized = normalizeUrl(req.url);
      const key = `${req.method} ${normalized}`;

      if (!endpointMap.has(key)) {
        endpointMap.set(key, {
          method: req.method,
          endpoint: normalized,
          calls: 0,
          statuses: [],
          requestSchema: null,
          responseSchema: null,
          hasAuth: false,
          pagination: false,
        });
      }

      const entry = endpointMap.get(key);
      entry.calls++;
      if (!entry.statuses.includes(req.status)) entry.statuses.push(req.status);

      // Auth headers
      const authHeader = req.requestHeaders["authorization"] || req.requestHeaders["x-auth-token"] || req.requestHeaders["x-api-key"];
      if (authHeader) entry.hasAuth = true;

      // Request body schema
      if (req.postData && !entry.requestSchema) {
        try {
          const parsed = JSON.parse(req.postData);
          entry.requestSchema = inferSchema(parsed);
        } catch {}
      }

      // Response body schema
      if (req.responseBody && !entry.responseSchema) {
        try {
          const parsed = JSON.parse(req.responseBody);
          entry.responseSchema = inferSchema(parsed);
          // Detect pagination keys
          const keys = Object.keys(typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {});
          if (keys.some((k) => ["page", "cursor", "next", "nextPage", "offset", "hasMore", "total_pages"].includes(k))) {
            entry.pagination = true;
          }
        } catch {}
      }
    }

    const endpoints = [...endpointMap.values()].sort((a, b) => b.calls - a.calls);

    const data = { totalApiCalls: apiCalls.length, uniqueEndpoints: endpoints.length, endpoints };
    const epLines = endpoints.slice(0, 8).map(e =>
      `${e.method} ${e.endpoint} — ${e.calls}x, [${e.statuses.join(',')}]${e.hasAuth ? ', auth' : ''}${e.pagination ? ', paginated' : ''}`
    ).join('\n  ');
    const summary = `API: ${endpoints.length} endpoints from ${apiCalls.length} calls (${duration}s)\n  ${epLines || 'none detected'}`;
    return summarizeResult('api-schema', data, summary);
  }
);

server.tool(
  "cbrowser_detect_stack",
  "Detect tech stack: frameworks, libraries, CMS, analytics, CDNs.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
  },
  async ({ url }) => {
    await ensureBrowser();

    let serverHeaders = null;

    if (url) {
      let mainResponse = null;
      try {
        mainResponse = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      } catch {}
      await page.waitForTimeout(1500);

      if (mainResponse) {
        const headers = mainResponse.headers();
        // Extract interesting server-side headers
        const interesting = ["server", "x-powered-by", "x-generator", "x-framework", "via", "cf-ray", "x-vercel-id", "x-amzn-requestid"];
        serverHeaders = {};
        for (const h of interesting) {
          if (headers[h]) serverHeaders[h] = headers[h];
        }
        if (Object.keys(serverHeaders).length === 0) serverHeaders = null;
      }
    }

    const stack = await page.evaluate(detectStackInBrowser);

    if (serverHeaders) {
      stack.serverHeaders = serverHeaders;

      // Infer hosting/CDN from response headers
      const hosting = [];
      if (serverHeaders["cf-ray"]) hosting.push("Cloudflare");
      if (serverHeaders["x-vercel-id"]) hosting.push("Vercel");
      if (serverHeaders["x-amzn-requestid"] || (serverHeaders["server"] || "").includes("AmazonS3")) hosting.push("AWS");
      if ((serverHeaders["server"] || "").toLowerCase().includes("nginx")) hosting.push("nginx");
      if ((serverHeaders["server"] || "").toLowerCase().includes("apache")) hosting.push("Apache");
      if ((serverHeaders["x-powered-by"] || "").toLowerCase().includes("php")) hosting.push("PHP");
      if ((serverHeaders["x-powered-by"] || "").toLowerCase().includes("express")) hosting.push("Express.js");
      if (hosting.length) stack.hosting = hosting;
    }

    const allTechs = [
      ...(stack.frameworks || []),
      ...(stack.cssFrameworks || []),
      ...(stack.buildTools || []),
      ...(stack.analytics || []),
      ...(stack.cms || []),
    ];
    const techs = allTechs.map(t => t.name + (t.version ? ` ${t.version}` : '')).join(', ');
    const hosting = (stack.hosting || []).join(', ');
    const summary = `Stack: ${techs || 'none detected'}${hosting ? `\nHosting: ${hosting}` : ''}`;
    return summarizeResult('stack', stack, summary);
  }
);

// --- Phase 5: Content Extraction ---

server.tool(
  "cbrowser_extract_metadata",
  "Extract metadata: OG, Twitter Cards, JSON-LD, RSS, canonical.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
  },
  async ({ url }) => {
    await ensureBrowser();
    await navigateIfNeeded(url, 1000);
    const result = await page.evaluate(extractMetadataInBrowser);
    const og = result.openGraph ? Object.keys(result.openGraph).length : 0;
    const tw = result.twitterCard ? Object.keys(result.twitterCard).length : 0;
    const ld = Array.isArray(result.jsonLd) ? result.jsonLd.length : 0;
    const summary = `Metadata: "${result.title || ''}" | OG: ${og} tags | Twitter: ${tw} tags | JSON-LD: ${ld}\nCanonical: ${result.canonical || 'none'} | Lang: ${result.lang || '?'}`;
    return summarizeResult('metadata', result, summary);
  }
);

server.tool(
  "cbrowser_extract_content",
  "Extract main content as clean markdown, stripping chrome.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
    selector: z.string().optional().describe("CSS selector to scope extraction"),
    includeImages: z.boolean().default(false).describe("Include images in output"),
  },
  async ({ url, selector, includeImages }) => {
    await ensureBrowser();
    await navigateIfNeeded(url, 1000);
    const result = await page.evaluate(extractContentInBrowser, { selector, includeImages });
    return {
      content: [{ type: "text", text: result.content }],
    };
  }
);

server.tool(
  "cbrowser_extract_forms",
  "Extract forms: fields, validation, actions, hidden fields.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
  },
  async ({ url }) => {
    await ensureBrowser();
    await navigateIfNeeded(url, 1000);
    const result = await page.evaluate(extractFormsInBrowser);
    const forms = result.forms || [];
    const totalFields = forms.reduce((sum, f) => sum + (f.fields || []).length, 0);
    const formLines = forms.slice(0, 5).map(f => {
      const names = (f.fields || []).slice(0, 5).map(fld => fld.name || fld.type).join(', ');
      return `${f.method || '?'} ${f.action || '?'} — ${(f.fields || []).length} fields [${names}]`;
    }).join('\n  ');
    const summary = `Forms: ${forms.length} found, ${totalFields} total fields\n  ${formLines || 'none'}`;
    return summarizeResult('forms', result, summary);
  }
);

// --- Phase 6: Multi-page ---

server.tool(
  "cbrowser_crawl",
  "BFS crawl with extraction per page. Writes to output/crawl-{ts}/.",
  {
    url: z.string().describe("Start URL"),
    maxPages: z.number().default(10).describe("Max pages"),
    maxDepth: z.number().default(2).describe("Max link depth"),
    extract: z.array(z.enum(["content", "metadata", "links", "colors", "fonts", "css_vars", "components", "forms"])).default(["content"]).describe("Extractions per page"),
    filterPath: z.string().optional().describe("Path prefix filter (e.g. '/blog/')"),
    sameDomain: z.boolean().default(true).describe("Same domain only"),
  },
  async ({ url, maxPages, maxDepth, extract, filterPath, sameDomain }) => {
    await ensureBrowser();

    const normalizeUrl = (u) => {
      try {
        const p = new URL(u);
        return `${p.origin}${p.pathname}`;
      } catch { return u; }
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const runDir = path.join(config.OUTPUT_DIR, `crawl-${timestamp}`);
    fs.mkdirSync(runDir, { recursive: true });

    const startUrl = new URL(url);
    const visited = new Set();
    const queue = [{ url: normalizeUrl(url), depth: 0 }];
    const results = [];

    while (queue.length > 0 && visited.size < maxPages) {
      const { url: currentUrl, depth } = queue.shift();
      if (visited.has(currentUrl)) continue;
      visited.add(currentUrl);

      const pageResult = { url: currentUrl, depth, extractions: {} };
      try {
        try { await page.goto(currentUrl, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
        await page.waitForTimeout(1000);

        for (const type of extract) {
          try {
            if (type === "content") pageResult.extractions.content = (await page.evaluate(extractContentInBrowser, { selector: null, includeImages: false })).content;
            else if (type === "metadata") pageResult.extractions.metadata = await page.evaluate(extractMetadataInBrowser);
            else if (type === "links") pageResult.extractions.links = await page.evaluate(() => {
              function isHiddenElement(el) {
                if (!el || el.nodeType !== 1) return false;
                const cs = getComputedStyle(el);
                if (cs.display === 'none') return true;
                if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
                if (parseFloat(cs.opacity) === 0) return true;
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0 && cs.overflow === 'hidden') return true;
                if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(100%)') return true;
                if (cs.position === 'absolute' || cs.position === 'fixed') {
                  if (rect.right < 0 || rect.bottom < 0 || rect.left > window.innerWidth || rect.top > window.innerHeight) {
                    if (rect.width < 2 || rect.height < 2) return true;
                  }
                }
                return false;
              }
              return [...document.querySelectorAll("a[href]")].filter(a => !isHiddenElement(a)).map(a => ({ text: a.textContent.trim().slice(0, 100), href: a.href }));
            });
            else if (type === "colors") pageResult.extractions.colors = await page.evaluate(extractColorsInBrowser, { limit: 50 });
            else if (type === "fonts") pageResult.extractions.fonts = await page.evaluate(extractFontsInBrowser);
            else if (type === "css_vars") pageResult.extractions.css_vars = await page.evaluate(extractCssVarsInBrowser, { includeAll: false });
            else if (type === "components") pageResult.extractions.components = await page.evaluate(extractComponentsInBrowser, { minOccurrences: 2 });
            else if (type === "forms") pageResult.extractions.forms = await page.evaluate(extractFormsInBrowser);
          } catch (e) {
            pageResult.extractions[type] = { error: e.message };
          }
        }

        // Enqueue linked pages if within depth
        if (depth < maxDepth) {
          const links = await page.evaluate(() =>
            [...document.querySelectorAll("a[href]")].map(a => a.href).filter(h => h.startsWith("http"))
          );
          for (const link of links) {
            try {
              const linkUrl = new URL(link);
              const normLink = `${linkUrl.origin}${linkUrl.pathname}`;
              if (visited.has(normLink)) continue;
              if (sameDomain && linkUrl.hostname !== startUrl.hostname) continue;
              if (filterPath && !linkUrl.pathname.startsWith(filterPath)) continue;
              queue.push({ url: normLink, depth: depth + 1 });
            } catch {}
          }
        }
      } catch (e) {
        pageResult.error = e.message;
      }

      results.push(pageResult);
      const filename = `page-${String(results.length).padStart(3, "0")}.json`;
      fs.writeFileSync(path.join(runDir, filename), JSON.stringify(pageResult, null, 2));
    }

    const summary = {
      startUrl: url,
      pagesVisited: results.length,
      outputDir: runDir,
      pages: results.map((r, i) => ({
        url: r.url,
        depth: r.depth,
        file: path.join(runDir, `page-${String(i + 1).padStart(3, "0")}.json`),
        error: r.error || null,
      })),
    };
    fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2));

    const pageList = summary.pages.map(p => `${p.depth > 0 ? '  '.repeat(p.depth) : ''}${p.url}${p.error ? ' (ERROR)' : ''}`).join('\n');
    const summaryText = `Crawl: ${summary.pagesVisited} pages from ${summary.startUrl}\nOutput: ${summary.outputDir}\n${pageList}`;
    return { content: [{ type: "text", text: summaryText }] };
  }
);

server.tool(
  "cbrowser_diff_pages",
  "Compare two URLs: structure, content, colors, images, metadata.",
  {
    url1: z.string().describe("First URL"),
    url2: z.string().describe("Second URL"),
    viewport1: z.object({ width: z.number(), height: z.number() }).optional().describe("Viewport for url1"),
    viewport2: z.object({ width: z.number(), height: z.number() }).optional().describe("Viewport for url2"),
  },
  async ({ url1, url2, viewport1, viewport2 }) => {
    await ensureBrowser();

    const capturePage = async (url, viewport) => {
      if (viewport) await page.setViewportSize(viewport);
      try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
      await page.waitForTimeout(1000);
      return page.evaluate(() => {
        const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(h => ({
          level: h.tagName.toLowerCase(),
          text: h.textContent.trim().slice(0, 200),
        }));
        const wordCount = (document.body.innerText || "").split(/\s+/).filter(Boolean).length;
        const title = document.title;
        const description = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
        const linkCount = document.querySelectorAll("a[href]").length;
        const imageCount = document.querySelectorAll("img").length;
        const formCount = document.querySelectorAll("form").length;
        const colorCounts = {};
        [...document.querySelectorAll("*")].slice(0, 500).forEach(el => {
          const s = window.getComputedStyle(el);
          [s.color, s.backgroundColor].forEach(c => {
            if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") {
              colorCounts[c] = (colorCounts[c] || 0) + 1;
            }
          });
        });
        const topColors = Object.entries(colorCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c]) => c);
        return { title, description, headings, wordCount, linkCount, imageCount, formCount, topColors };
      });
    };

    const data1 = await capturePage(url1, viewport1);
    const data2 = await capturePage(url2, viewport2);

    // Reset viewport to default if changed
    if (viewport1 || viewport2) await page.setViewportSize(config.VIEWPORT);

    const headingTexts1 = new Set(data1.headings.map(h => h.text));
    const headingTexts2 = new Set(data2.headings.map(h => h.text));

    const result = {
      url1: { url: url1, viewport: viewport1 || config.VIEWPORT, ...data1 },
      url2: { url: url2, viewport: viewport2 || config.VIEWPORT, ...data2 },
      diff: {
        title: data1.title !== data2.title ? { url1: data1.title, url2: data2.title } : "same",
        description: data1.description !== data2.description ? { url1: data1.description, url2: data2.description } : "same",
        wordCount: { url1: data1.wordCount, url2: data2.wordCount, delta: data2.wordCount - data1.wordCount },
        linkCount: { url1: data1.linkCount, url2: data2.linkCount, delta: data2.linkCount - data1.linkCount },
        imageCount: { url1: data1.imageCount, url2: data2.imageCount, delta: data2.imageCount - data1.imageCount },
        formCount: { url1: data1.formCount, url2: data2.formCount, delta: data2.formCount - data1.formCount },
        headings: {
          onlyIn1: data1.headings.filter(h => !headingTexts2.has(h.text)),
          onlyIn2: data2.headings.filter(h => !headingTexts1.has(h.text)),
          shared: data1.headings.filter(h => headingTexts2.has(h.text)).length,
        },
        colors: {
          onlyIn1: data1.topColors.filter(c => !data2.topColors.includes(c)),
          onlyIn2: data2.topColors.filter(c => !data1.topColors.includes(c)),
          shared: data1.topColors.filter(c => data2.topColors.includes(c)),
        },
      },
    };

    const d = result.diff;
    const lines = [];
    lines.push(`Title: ${d.title === 'same' ? 'same' : 'DIFFERENT'}`);
    lines.push(`Words: ${d.wordCount.url1} vs ${d.wordCount.url2} (${d.wordCount.delta >= 0 ? '+' : ''}${d.wordCount.delta})`);
    lines.push(`Links: ${d.linkCount.url1} vs ${d.linkCount.url2} | Images: ${d.imageCount.url1} vs ${d.imageCount.url2}`);
    lines.push(`Headings: ${d.headings.shared} shared, ${d.headings.onlyIn1.length} only in url1, ${d.headings.onlyIn2.length} only in url2`);
    lines.push(`Colors: ${d.colors.shared.length} shared, ${d.colors.onlyIn1.length} only in url1, ${d.colors.onlyIn2.length} only in url2`);
    const summary = `Diff: ${url1} vs ${url2}\n${lines.join('\n')}`;
    return summarizeResult('diff', result, summary);
  }
);

// --- Phase 7: Advanced ---

server.tool(
  "cbrowser_extract_animations",
  "Extract CSS animations, transitions, and detect animation libraries.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
  },
  async ({ url }) => {
    await ensureBrowser();
    await navigateIfNeeded(url);
    const result = await page.evaluate(extractAnimationsInBrowser);
    const kf = (result.keyframes || []).length;
    const tr = (result.transitions || []).length;
    const libs = [...(result.jsLibraries || []), ...(result.cssLibraries || [])].join(', ');
    const kfNames = (result.keyframes || []).slice(0, 5).map(k => k.name).join(', ');
    const summary = `Animations: ${kf} @keyframes, ${tr} transitions${libs ? ` | Libraries: ${libs}` : ''}\nKeyframes: ${kfNames || 'none'}`;
    return summarizeResult('animations', result, summary);
  }
);

server.tool(
  "cbrowser_extract_a11y",
  "Accessibility audit with score (0-100) and issues by severity.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
    standard: z.enum(["aa", "aaa"]).default("aa").describe("WCAG standard (aa or aaa)"),
  },
  async ({ url, standard }) => {
    await ensureBrowser();
    await navigateIfNeeded(url);
    const result = await page.evaluate(extractA11yInBrowser, { standard });
    const issues = result.issues || [];
    const bySev = {};
    issues.forEach(i => { bySev[i.severity || 'info'] = (bySev[i.severity || 'info'] || 0) + 1; });
    const sevStr = Object.entries(bySev).map(([k, v]) => `${v} ${k}`).join(', ');
    const topIssues = issues.filter(i => i.severity === 'critical' || i.severity === 'error').slice(0, 3).map(i => i.message || i.type).join('; ');
    const summary = `A11y Score: ${result.score ?? '?'}/100 (WCAG ${standard.toUpperCase()}) | ${sevStr || 'no issues'}\nTop issues: ${topIssues || 'none critical'}`;
    return summarizeResult('a11y', result, summary);
  }
);

server.tool(
  "cbrowser_detect_darkmode",
  "Detect dark mode support. Optionally capture dark palette.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
    activateDark: z.boolean().default(false).describe("Emulate dark mode and capture palette"),
  },
  async ({ url, activateDark }) => {
    await ensureBrowser();
    await navigateIfNeeded(url);

    const result = await page.evaluate(detectDarkmodeInBrowser);

    if (activateDark) {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(500);
      const darkPalette = await page.evaluate(() => {
        const counts = {};
        for (const el of document.querySelectorAll("body *")) {
          if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") continue;
          const cs = getComputedStyle(el);
          for (const prop of ["color", "background-color"]) {
            const c = cs.getPropertyValue(prop);
            if (c && c !== "transparent" && c !== "rgba(0, 0, 0, 0)") {
              counts[c] = (counts[c] || 0) + 1;
            }
          }
        }
        return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => c);
      });
      result.darkPalette = darkPalette;
      await page.emulateMedia({ colorScheme: "no-preference" });
    }

    const method = result.hasDarkmodeMedia ? 'prefers-color-scheme' : (result.darkmodeClasses?.length ? 'css-classes' : 'unknown');
    const darkColors = (result.darkPalette || []).slice(0, 5).join(', ');
    const summary = `Dark mode: ${result.supported ? 'supported' : 'not detected'} (${method})${darkColors ? `\nDark palette: ${darkColors}` : ''}`;
    return summarizeResult('darkmode', result, summary);
  }
);

server.tool(
  "cbrowser_extract_perf",
  "Performance metrics: Web Vitals, resource sizes, timing.",
  {
    url: z.string().optional().describe("URL (omit for current page)"),
  },
  async ({ url }) => {
    await ensureBrowser();
    await navigateIfNeeded(url, 2000);
    const result = await page.evaluate(extractPerfInBrowser);
    const t = result.timing || {};
    const dom = result.dom || {};
    const res = result.resources || {};
    const byType = res.byType || {};
    const resStr = Object.entries(byType).map(([k, v]) => `${k}: ${v.count} files, ${v.transferKB}KB`).join(' | ');
    const summary = `Perf: TTFB ${t.ttfbMs ?? '?'}ms, DOMContentLoaded ${t.domContentLoadedMs ?? '?'}ms, Load ${t.loadMs ?? '?'}ms | DOM: ${dom.nodeCount ?? '?'} nodes (${dom.domSizeKB ?? '?'}KB)\nResources: ${res.total ?? '?'} total | ${resStr || 'none'}`;
    return summarizeResult('perf', result, summary);
  }
);

// --- Phase 8: Export ---

server.tool(
  "cbrowser_export_design_report",
  "Full design system report: HTML + W3C tokens JSON + CSS vars.",
  {
    url: z.string().describe("URL to analyze"),
    include: z
      .array(z.enum(["colors", "fonts", "css_vars", "spacing", "components", "breakpoints"]))
      .default(["colors", "fonts", "css_vars", "spacing", "components", "breakpoints"])
      .describe("Sections to include"),
  },
  async ({ url, include }) => {
    await ensureBrowser();
    await navigateIfNeeded(url);

    const data = {};
    if (include.includes("colors"))      data.colors      = await page.evaluate(extractColorsInBrowser, { limit: 50 });
    if (include.includes("fonts"))       data.fonts       = await page.evaluate(extractFontsInBrowser);
    if (include.includes("css_vars"))    data.cssVars     = await page.evaluate(extractCssVarsInBrowser, { includeAll: false });
    if (include.includes("spacing"))     data.spacing     = await page.evaluate(extractSpacingInBrowser, { sampleSize: 200 });
    if (include.includes("components")) data.components  = await page.evaluate(extractComponentsInBrowser, { minOccurrences: 2 });
    if (include.includes("breakpoints")) data.breakpoints = await page.evaluate(extractBreakpointsInBrowser);

    // --- Build design-tokens.json (W3C Design Tokens format) ---
    const tokens = {};

    if (data.colors?.colors?.length) {
      tokens.color = {};
      data.colors.colors.forEach((c, i) => {
        const name = `color-${i + 1}`;
        tokens.color[name] = { $value: c.hex, $type: "color", $description: `count: ${c.count}` };
      });
    }

    if (data.fonts?.families?.length) {
      tokens.fontFamily = {};
      data.fonts.families.forEach((f, i) => {
        tokens.fontFamily[`font-${i + 1}`] = { $value: f.value, $type: "fontFamily", $description: `${f.count} use(s)` };
      });
      if (data.fonts.sizes?.length) {
        tokens.fontSize = {};
        data.fonts.sizes.forEach((s, i) => {
          tokens.fontSize[`size-${i + 1}`] = { $value: s.value, $type: "dimension", $description: `count: ${s.count}` };
        });
      }
    }

    if (data.spacing?.spacing?.length) {
      tokens.spacing = {};
      data.spacing.spacing.forEach((s, i) => {
        tokens.spacing[`space-${i + 1}`] = { $value: s.value, $type: "dimension", $description: `count: ${s.count}` };
      });
    }

    if (data.cssVars?.variables?.length) {
      tokens.cssCustomProperty = {};
      for (const v of data.cssVars.variables) {
        const key = v.name.replace(/^--/, '').replace(/[^a-zA-Z0-9-]/g, '-');
        tokens.cssCustomProperty[key] = { $value: v.value, $type: "string" };
      }
    }

    // --- Build design-tokens.css ---
    const cssLines = [':root {'];
    if (data.colors?.colors?.length) {
      cssLines.push('  /* Colors */');
      data.colors.colors.forEach((c, i) => { cssLines.push(`  --color-${i + 1}: ${c.hex};`); });
    }
    if (data.fonts?.families?.length) {
      cssLines.push('  /* Font Families */');
      data.fonts.families.forEach((f, i) => { cssLines.push(`  --font-family-${i + 1}: ${f.value};`); });
    }
    if (data.fonts?.sizes?.length) {
      cssLines.push('  /* Font Sizes */');
      data.fonts.sizes.forEach((s, i) => { cssLines.push(`  --font-size-${i + 1}: ${s.value};`); });
    }
    if (data.spacing?.spacing?.length) {
      cssLines.push('  /* Spacing Scale */');
      data.spacing.spacing.forEach((s, i) => { cssLines.push(`  --space-${i + 1}: ${s.value};`); });
    }
    if (data.cssVars?.variables?.length) {
      cssLines.push('  /* Original CSS Custom Properties */');
      for (const v of data.cssVars.variables) { cssLines.push(`  ${v.name}: ${v.value};`); }
    }
    cssLines.push('}');

    // --- Build report.html ---
    function esc(s) {
      return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    let body = '';

    if (data.colors?.colors?.length) {
      body += `<section id="colors"><h2>Colors <span class="count">${data.colors.colors.length}</span></h2>
        <div class="swatches">`;
      for (const c of data.colors.colors) {
        const isLight = parseInt(c.hex.slice(1, 3), 16) * 0.299 +
                        parseInt(c.hex.slice(3, 5), 16) * 0.587 +
                        parseInt(c.hex.slice(5, 7), 16) * 0.114 > 186;
        body += `<div class="swatch" style="background:${c.hex};color:${isLight ? '#222' : '#fff'}">
          <span class="swatch-hex">${esc(c.hex)}</span>
          <span class="swatch-count">${c.count}×</span></div>`;
      }
      body += '</div></section>';
    }

    if (data.fonts?.families?.length) {
      body += `<section id="typography"><h2>Typography</h2><table>
        <thead><tr><th>Family</th><th>Usage</th></tr></thead><tbody>`;
      for (const f of data.fonts.families) {
        body += `<tr><td style="font-family:${esc(f.value)}">${esc(f.value)}</td>
          <td>${f.count}</td></tr>`;
      }
      if (data.fonts.sizes?.length) {
        body += `</tbody></table><h3>Font Sizes</h3><table><thead><tr><th>Size</th><th>Count</th></tr></thead><tbody>`;
        for (const s of data.fonts.sizes.slice(0, 15)) {
          body += `<tr><td>${esc(s.value)}</td><td>${s.count}</td></tr>`;
        }
      }
      body += '</tbody></table></section>';
    }

    if (data.cssVars?.variables?.length) {
      body += `<section id="css-vars"><h2>CSS Custom Properties <span class="count">${data.cssVars.variables.length}</span></h2><table>
        <thead><tr><th>Variable</th><th>Value</th><th>Category</th></tr></thead><tbody>`;
      for (const v of data.cssVars.variables) {
        const isColor = /^#|^rgb/.test(v.value);
        const swatch = isColor ? `<span class="inline-swatch" style="background:${esc(v.value)}"></span>` : '';
        body += `<tr><td><code>${esc(v.name)}</code></td><td>${swatch}${esc(v.value)}</td><td>${esc(v.category || '')}</td></tr>`;
      }
      body += '</tbody></table></section>';
    }

    if (data.spacing?.spacing?.length) {
      body += `<section id="spacing"><h2>Spacing Scale</h2><div class="spacing-list">`;
      for (const s of data.spacing.spacing) {
        const px = parseFloat(s.value) || 0;
        const barW = Math.min(px * 2, 300);
        body += `<div class="spacing-row">
          <code>${esc(s.value)}</code>
          <div class="spacing-bar" style="width:${barW}px"></div>
          <span class="spacing-count">${s.count}×</span></div>`;
      }
      body += '</div></section>';
    }

    if (data.components?.components?.length) {
      body += `<section id="components"><h2>Components <span class="count">${data.components.components.length}</span></h2><table>
        <thead><tr><th>Pattern</th><th>Count</th><th>Tag</th></tr></thead><tbody>`;
      for (const c of data.components.components) {
        body += `<tr><td><code>${esc(c.signature)}</code></td><td>${c.count}</td><td>${esc(c.tag || '')}</td></tr>`;
      }
      body += '</tbody></table></section>';
    }

    if (data.breakpoints?.breakpoints?.length) {
      body += `<section id="breakpoints"><h2>Breakpoints</h2><table>
        <thead><tr><th>Query</th><th>Min</th><th>Max</th></tr></thead><tbody>`;
      for (const bp of data.breakpoints.breakpoints) {
        body += `<tr><td><code>${esc(bp.query)}</code></td><td>${esc(bp.minWidth ?? '')}</td><td>${esc(bp.maxWidth ?? '')}</td></tr>`;
      }
      body += '</tbody></table></section>';
    }

    const reportHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Design System Report</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 1100px; margin: 0 auto; padding: 2rem; color: #1a1a1a; background: #fafafa; }
    header { margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 2px solid #e5e7eb; }
    header h1 { margin: 0 0 .25rem; font-size: 1.6rem; }
    header p { margin: 0; color: #6b7280; font-size: .9rem; }
    nav { display: flex; gap: 1rem; margin: 1rem 0 2rem; flex-wrap: wrap; }
    nav a { font-size: .85rem; color: #4f46e5; text-decoration: none; padding: .3rem .7rem; border: 1px solid #c7d2fe; border-radius: 999px; }
    nav a:hover { background: #ede9fe; }
    section { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; }
    h2 { margin: 0 0 1rem; font-size: 1.1rem; display: flex; align-items: center; gap: .5rem; }
    .count { font-size: .75rem; font-weight: 400; background: #f3f4f6; color: #6b7280; padding: .1rem .45rem; border-radius: 999px; }
    table { border-collapse: collapse; width: 100%; font-size: .875rem; }
    th, td { border: 1px solid #e5e7eb; padding: 7px 12px; text-align: left; }
    th { background: #f9fafb; font-weight: 600; }
    code { font-family: ui-monospace, monospace; font-size: .8rem; background: #f3f4f6; padding: .1rem .3rem; border-radius: 3px; }
    .swatches { display: flex; flex-wrap: wrap; gap: .5rem; }
    .swatch { width: 80px; height: 80px; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: .65rem; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
    .swatch-hex { margin-bottom: 2px; }
    .swatch-count { opacity: .7; }
    .inline-swatch { display: inline-block; width: 12px; height: 12px; border-radius: 2px; border: 1px solid rgba(0,0,0,.15); vertical-align: middle; margin-right: 4px; }
    .spacing-list { display: flex; flex-direction: column; gap: .4rem; }
    .spacing-row { display: flex; align-items: center; gap: 1rem; font-size: .85rem; }
    .spacing-row code { width: 70px; flex-shrink: 0; }
    .spacing-bar { height: 16px; background: #4f46e5; border-radius: 3px; flex-shrink: 0; }
    .spacing-count { color: #9ca3af; font-size: .75rem; }
    footer { color: #9ca3af; font-size: .8rem; text-align: center; margin-top: 2rem; }
  </style>
</head>
<body>
  <header>
    <h1>Design System Report</h1>
    <p>${esc(url)} &mdash; ${new Date().toISOString()}</p>
  </header>
  <nav>
    ${include.map(s => `<a href="#${s.replace('_', '-')}">${s.replace('_', ' ')}</a>`).join('\n    ')}
  </nav>
  ${body}
  <footer>Generated by cbrowser</footer>
</body>
</html>`;

    // Write output files
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outDir = path.join(config.OUTPUT_DIR, `design-report-${timestamp}`);
    fs.mkdirSync(outDir, { recursive: true });

    const htmlFile   = path.join(outDir, 'report.html');
    const tokensFile = path.join(outDir, 'design-tokens.json');
    const cssFile    = path.join(outDir, 'design-tokens.css');

    fs.writeFileSync(htmlFile,   reportHtml);
    fs.writeFileSync(tokensFile, JSON.stringify(tokens, null, 2));
    fs.writeFileSync(cssFile,    cssLines.join('\n'));

    const sections = Object.keys(data).join(', ');
    return {
      content: [{
        type: "text",
        text: [
          `Design system report for ${url}`,
          `Sections: ${sections}`,
          `  HTML:             ${htmlFile}`,
          `  Design Tokens JSON: ${tokensFile}`,
          `  Design Tokens CSS:  ${cssFile}`,
        ].join('\n'),
      }],
    };
  }
);

server.tool(
  "cbrowser_close",
  "Close the browser session.",
  {},
  async () => {
    await closeBrowser();
    return {
      content: [{ type: "text", text: "Browser session closed." }],
    };
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
