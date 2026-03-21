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
  return `Title: ${result.title}\nURL: ${result.url}\n\nInteractive elements: ${result.elements.length}\n\n${result.compressedDOM}`;
}

const server = new McpServer({
  name: "cbrowser",
  version: "1.0.0",
});

// --- Tools ---

server.tool(
  "cbrowser_login",
  "Log into a website by navigating to the URL, filling credentials, and submitting. Keeps the browser session alive for subsequent tool calls.",
  {
    url: z.string().describe("Login page URL"),
    username: z.string().describe("Username to fill"),
    password: z.string().describe("Password to fill"),
    usernameSelector: z
      .string()
      .default('input[name="username"]')
      .describe("CSS selector for username field"),
    passwordSelector: z
      .string()
      .default('input[name="password"]')
      .describe("CSS selector for password field"),
    submitSelector: z
      .string()
      .default('input[type="submit"]')
      .describe("CSS selector for submit button"),
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
  "Launch a VISIBLE browser window for manual login (for sites requiring MFA/authenticator). The user logs in themselves. Call cbrowser_login_check to verify when they're done.",
  {
    url: z.string().describe("Login page URL to open"),
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
  "Check the current state of the browser after manual login. Returns the current page title, URL, and content preview to verify the user is authenticated.",
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
  "Navigate the current browser session to a URL. Returns a compressed DOM with numbered interactive elements that can be used with cbrowser_act.",
  {
    url: z.string().describe("URL to navigate to"),
  },
  async ({ url }) => {
    await ensureBrowser();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    } catch {
      // Continue with whatever loaded
    }
    await page.waitForTimeout(1500);

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
  "Inspect the current page or a URL — returns compressed DOM with numbered interactive elements. Optionally includes a screenshot.",
  {
    url: z.string().optional().describe("URL to inspect (omit to inspect current page)"),
    screenshot: z.boolean().default(false).describe("Include a screenshot alongside the DOM"),
  },
  async ({ url, screenshot }) => {
    await ensureBrowser();
    if (url) {
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      } catch {}
      await page.waitForTimeout(1500);
    }

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
  "Take a screenshot of the current page or a URL. Optionally highlight interactive elements with numbered badges.",
  {
    url: z.string().optional().describe("URL to screenshot (omit for current page)"),
    fullPage: z.boolean().default(true).describe("Capture full scrollable page"),
    highlight: z
      .boolean()
      .default(false)
      .describe("Overlay numbered badges on interactive elements"),
  },
  async ({ url, fullPage, highlight }) => {
    await ensureBrowser();
    if (url) {
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      } catch {}
      await page.waitForTimeout(1500);
    }

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
  "Extract structured table data from the current page. Useful for customer lists, data grids, etc.",
  {
    url: z.string().optional().describe("URL to extract from (omit for current page)"),
    minColumns: z.number().default(2).describe("Minimum columns a row must have to be included"),
    limit: z.number().default(50).describe("Maximum number of rows to return"),
  },
  async ({ url, minColumns, limit }) => {
    await ensureBrowser();
    if (url) {
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      } catch {}
      await page.waitForTimeout(1500);
    }

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

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(tableData, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "cbrowser_extract_links",
  "Extract all links from the current page, including image-only links (with alt text).",
  {
    url: z.string().optional().describe("URL to extract from (omit for current page)"),
    filter: z.string().optional().describe("Only return links whose href contains this string"),
  },
  async ({ url, filter }) => {
    await ensureBrowser();
    if (url) {
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      } catch {}
      await page.waitForTimeout(1500);
    }

    let links = await page.evaluate(() => {
      return [...document.querySelectorAll("a[href]")].map((a) => ({
        text: a.textContent.trim() || a.querySelector("img")?.alt || "(image link)",
        href: a.href,
      }));
    });

    if (filter) {
      links = links.filter((l) => l.href.includes(filter));
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(links, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "cbrowser_run_js",
  "Execute JavaScript in the current page context and return the result. Useful for custom data extraction.",
  {
    script: z.string().describe("JavaScript to evaluate in the page (must return a value)"),
  },
  async ({ script }) => {
    await ensureBrowser();
    const result = await page.evaluate(script);
    return {
      content: [
        {
          type: "text",
          text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "cbrowser_export",
  "Export inspection results for one or more URLs as Markdown report + HTML report + JSON + CSV tables + screenshots.",
  {
    urls: z.array(z.string()).describe("URLs to inspect and export"),
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
  "Interact with a page element by its index number (from navigate/inspect output). Performs click, fill, select, check, or hover. Returns updated page state with new element indices.",
  {
    action: z
      .enum(["click", "fill", "select", "check", "hover"])
      .describe("Action to perform"),
    index: z.number().describe("Element index from inspect/navigate output"),
    value: z
      .string()
      .optional()
      .describe("Value to fill or option to select (required for fill/select)"),
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
  "Scroll the page in a direction, or scroll a specific element into view.",
  {
    direction: z
      .enum(["up", "down", "top", "bottom"])
      .optional()
      .describe("Scroll direction (ignored if index is provided)"),
    index: z
      .number()
      .optional()
      .describe("Element index to scroll into view"),
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
  "Extract the color palette from the current page — all unique colors from computed styles, sorted by frequency.",
  {
    url: z.string().optional().describe("URL to extract from (omit for current page)"),
    limit: z.number().default(30).describe("Maximum number of colors to return"),
  },
  async ({ url, limit }) => {
    await ensureBrowser();
    if (url) {
      try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
      await page.waitForTimeout(1500);
    }
    const result = await page.evaluate(extractColorsInBrowser, { limit });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "cbrowser_extract_fonts",
  "Extract typography information — font families, sizes, weights, line-heights, and font sources (Google Fonts, Typekit, self-hosted).",
  {
    url: z.string().optional().describe("URL to extract from (omit for current page)"),
  },
  async ({ url }) => {
    await ensureBrowser();
    if (url) {
      try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
      await page.waitForTimeout(1500);
    }
    const result = await page.evaluate(extractFontsInBrowser);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "cbrowser_extract_css_vars",
  "Extract all CSS custom properties (variables) from :root and body, auto-categorized by type (color, spacing, typography, etc.).",
  {
    url: z.string().optional().describe("URL to extract from (omit for current page)"),
    includeAll: z.boolean().default(false).describe("Also scan inline styles on all elements"),
  },
  async ({ url, includeAll }) => {
    await ensureBrowser();
    if (url) {
      try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
      await page.waitForTimeout(1500);
    }
    const result = await page.evaluate(extractCssVarsInBrowser, { includeAll });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "cbrowser_extract_spacing",
  "Extract the spacing scale — unique margin, padding, gap, and border-radius values with inferred base unit.",
  {
    url: z.string().optional().describe("URL to extract from (omit for current page)"),
    sampleSize: z.number().default(200).describe("Max elements to sample"),
  },
  async ({ url, sampleSize }) => {
    await ensureBrowser();
    if (url) {
      try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
      await page.waitForTimeout(1500);
    }
    const result = await page.evaluate(extractSpacingInBrowser, { sampleSize });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- Phase 2: Visual Asset Extraction ---

server.tool(
  "cbrowser_extract_images",
  "Discover all images on the page: <img>, CSS background-image, <picture> sources, OG/meta images. Returns metadata: src, dimensions, alt text, format.",
  {
    url: z.string().optional().describe("URL to extract from (omit for current page)"),
    minWidth: z.number().default(1).describe("Minimum width in px to include"),
    filter: z.string().optional().describe("Only return images whose src contains this string"),
  },
  async ({ url, minWidth, filter }) => {
    await ensureBrowser();
    if (url) {
      try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
      await page.waitForTimeout(1500);
    }
    const result = await page.evaluate(extractImagesInBrowser, { minWidth, filter: filter || "" });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "cbrowser_download_images",
  "Download discovered images to output/assets/images/. Uses browser session cookies for authenticated assets.",
  {
    url: z.string().optional().describe("URL to extract from (omit for current page)"),
    minWidth: z.number().default(50).describe("Minimum width in px to include"),
    filter: z.string().optional().describe("Only download images whose src contains this string"),
    limit: z.number().default(50).describe("Maximum number of images to download"),
    formats: z.array(z.string()).optional().describe("Only download images with these extensions (e.g. ['png', 'jpg'])"),
  },
  async ({ url, minWidth, filter, limit, formats }) => {
    await ensureBrowser();
    if (url) {
      try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
      await page.waitForTimeout(1500);
    }

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
  "Extract inline SVG markup (cleaned/minified) and external SVG URLs. Classifies as icon vs illustration by size. Detects currentColor usage.",
  {
    url: z.string().optional().describe("URL to extract from (omit for current page)"),
    limit: z.number().default(50).describe("Maximum number of SVGs to return"),
    download: z.boolean().default(false).describe("Also download SVGs to output/assets/svgs/"),
  },
  async ({ url, limit, download }) => {
    await ensureBrowser();
    if (url) {
      try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
      await page.waitForTimeout(1500);
    }
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

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "cbrowser_extract_favicon",
  "Extract all favicon and icon references: link[rel=icon], apple-touch-icon, manifest icons, msapplication-TileImage. Optionally download them.",
  {
    url: z.string().optional().describe("URL to extract from (omit for current page)"),
    download: z.boolean().default(false).describe("Download favicons to output/assets/favicons/"),
  },
  async ({ url, download }) => {
    await ensureBrowser();
    if (url) {
      try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
      await page.waitForTimeout(1500);
    }
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

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
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
  "Map the layout structure of the page — display type (flex/grid/block), direction, template, gap, alignment per container. Returns a compressed layout tree.",
  {
    url: z.string().optional().describe("URL to extract from (omit for current page)"),
    maxDepth: z.number().default(6).describe("Maximum tree depth to traverse"),
  },
  async ({ url, maxDepth }) => {
    await ensureBrowser();
    if (url) {
      try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
      await page.waitForTimeout(1500);
    }
    const result = await page.evaluate(extractLayoutInBrowser, { maxDepth });
    const text = formatLayoutTree(result.layout);
    return {
      content: [{ type: "text", text }],
    };
  }
);

server.tool(
  "cbrowser_extract_components",
  "Detect repeated visual patterns — groups of elements with the same class structure appearing multiple times. Returns pattern templates, class names, instance count, and sample HTML.",
  {
    url: z.string().optional().describe("URL to extract from (omit for current page)"),
    minOccurrences: z.number().default(3).describe("Minimum number of occurrences to qualify as a component"),
  },
  async ({ url, minOccurrences }) => {
    await ensureBrowser();
    if (url) {
      try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
      await page.waitForTimeout(1500);
    }
    const result = await page.evaluate(extractComponentsInBrowser, { minOccurrences });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "cbrowser_extract_breakpoints",
  "Extract all CSS media query breakpoints from stylesheets. Detects framework breakpoints (Tailwind, Bootstrap, MUI). Reports current viewport.",
  {
    url: z.string().optional().describe("URL to extract from (omit for current page)"),
  },
  async ({ url }) => {
    await ensureBrowser();
    if (url) {
      try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
      await page.waitForTimeout(1500);
    }
    const result = await page.evaluate(extractBreakpointsInBrowser);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
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
  "Capture all network requests/responses on the current page for a configurable duration. Records URL, method, status, content-type, headers, and request/response bodies (JSON/text). Filters out static assets by default.",
  {
    url: z.string().optional().describe("Navigate to this URL before capturing (omit to capture on current page)"),
    duration: z.number().default(10).describe("How many seconds to capture (default 10)"),
    includeStatic: z.boolean().default(false).describe("Include image/CSS/font/media requests"),
    filterUrl: z.string().optional().describe("Only capture requests whose URL contains this string"),
    filterMethod: z.string().optional().describe("Only capture requests with this HTTP method (e.g. GET, POST)"),
  },
  async ({ url, duration, includeStatic, filterUrl, filterMethod }) => {
    await ensureBrowser();
    if (url) {
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      } catch {}
      await page.waitForTimeout(500);
    }

    const requests = await captureNetwork({ duration, includeStatic, filterUrl, filterMethod });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ total: requests.length, requests }, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "cbrowser_extract_api_schema",
  "Capture API calls and infer JSON schemas from responses. Groups endpoints by normalized path (strips IDs), detects pagination patterns and auth headers.",
  {
    url: z.string().optional().describe("Navigate to this URL before capturing (omit to capture on current page)"),
    duration: z.number().default(15).describe("How many seconds to capture (default 15)"),
    filterUrl: z.string().optional().describe("Only analyze requests whose URL contains this string"),
  },
  async ({ url, duration, filterUrl }) => {
    await ensureBrowser();
    if (url) {
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      } catch {}
      await page.waitForTimeout(500);
    }

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

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              totalApiCalls: apiCalls.length,
              uniqueEndpoints: endpoints.length,
              endpoints,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "cbrowser_detect_stack",
  "Fingerprint the technology stack: JS frameworks (React, Vue, Angular, Next.js, Svelte), CSS frameworks (Tailwind, Bootstrap, MUI), build tools, analytics, CMS, CDNs. Uses globals, DOM attributes, script URLs, meta tags, and response headers.",
  {
    url: z.string().optional().describe("Navigate to this URL before detecting (omit for current page)"),
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

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(stack, null, 2),
        },
      ],
    };
  }
);

// --- Phase 5: Content Extraction ---

server.tool(
  "cbrowser_extract_metadata",
  "Extract all page metadata: meta tags, OpenGraph, Twitter Cards, JSON-LD/schema.org, RSS/Atom feeds, canonical URL, manifest, theme-color.",
  {
    url: z.string().optional().describe("URL to extract from (omit for current page)"),
  },
  async ({ url }) => {
    await ensureBrowser();
    if (url) {
      try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
      await page.waitForTimeout(1000);
    }
    const result = await page.evaluate(extractMetadataInBrowser);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "cbrowser_extract_content",
  "Extract main page content as clean structured markdown. Detects article containers, strips nav/sidebar/footer chrome. Preserves heading hierarchy, lists, links, inline formatting.",
  {
    url: z.string().optional().describe("URL to extract from (omit for current page)"),
    selector: z.string().optional().describe("Scope extraction to this CSS selector (e.g. 'article', '.post-body')"),
    includeImages: z.boolean().default(false).describe("Include image markdown in output"),
  },
  async ({ url, selector, includeImages }) => {
    await ensureBrowser();
    if (url) {
      try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
      await page.waitForTimeout(1000);
    }
    const result = await page.evaluate(extractContentInBrowser, { selector, includeImages });
    return {
      content: [{ type: "text", text: result.content }],
    };
  }
);

server.tool(
  "cbrowser_extract_forms",
  "Detailed form analysis: fields, validation rules (pattern, required, min/max), action URLs, methods, fieldset grouping, select options, hidden fields, CSRF tokens.",
  {
    url: z.string().optional().describe("URL to extract from (omit for current page)"),
  },
  async ({ url }) => {
    await ensureBrowser();
    if (url) {
      try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
      await page.waitForTimeout(1000);
    }
    const result = await page.evaluate(extractFormsInBrowser);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- Phase 6: Multi-page ---

server.tool(
  "cbrowser_crawl",
  "Crawl a site using BFS, visiting up to maxPages pages within maxDepth link hops. Runs configurable extraction on each page and writes results to output/crawl-{timestamp}/. Returns a summary JSON with per-page file paths.",
  {
    url: z.string().describe("Starting URL"),
    maxPages: z.number().default(10).describe("Max pages to visit (default 10)"),
    maxDepth: z.number().default(2).describe("Max BFS depth from start URL (default 2)"),
    extract: z.array(z.enum(["content", "metadata", "links", "colors", "fonts", "css_vars", "components", "forms"])).default(["content"]).describe("Extraction types to run on each page"),
    filterPath: z.string().optional().describe("Only follow links whose path starts with this prefix (e.g. '/blog/')"),
    sameDomain: z.boolean().default(true).describe("Only follow links on the same domain (default true)"),
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
            else if (type === "links") pageResult.extractions.links = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map(a => ({ text: a.textContent.trim().slice(0, 100), href: a.href })));
            else if (type === "colors") pageResult.extractions.colors = await page.evaluate(extractColorsInBrowser);
            else if (type === "fonts") pageResult.extractions.fonts = await page.evaluate(extractFontsInBrowser);
            else if (type === "css_vars") pageResult.extractions.css_vars = await page.evaluate(extractCssVarsInBrowser);
            else if (type === "components") pageResult.extractions.components = await page.evaluate(extractComponentsInBrowser);
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

    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
    };
  }
);

server.tool(
  "cbrowser_diff_pages",
  "Compare two URLs: DOM structure (headings), text content (word count), colors, images, forms, and metadata. Useful for responsive testing (same URL at two viewports) or staging vs prod.",
  {
    url1: z.string().describe("First URL"),
    url2: z.string().describe("Second URL"),
    viewport1: z.object({ width: z.number(), height: z.number() }).optional().describe("Viewport for url1 (e.g. {width:375,height:667})"),
    viewport2: z.object({ width: z.number(), height: z.number() }).optional().describe("Viewport for url2 (e.g. {width:1440,height:900})"),
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

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- Phase 7: Advanced ---

server.tool(
  "cbrowser_extract_animations",
  "Extract CSS @keyframes, transition properties, and per-element animation assignments. Detect JS animation libraries (GSAP, Framer Motion, anime.js, Lottie, etc.) and CSS animation libraries (Animate.css, AOS).",
  {
    url: z.string().optional().describe("URL to extract from (omit for current page)"),
  },
  async ({ url }) => {
    await ensureBrowser();
    if (url) {
      try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
      await page.waitForTimeout(1500);
    }
    const result = await page.evaluate(extractAnimationsInBrowser);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "cbrowser_extract_a11y",
  "Accessibility audit: missing alt text, unlabelled form fields, buttons/links without accessible names, heading hierarchy, landmark roles, color contrast (WCAG AA/AAA), positive tabindex, lang attribute, page title. Returns a score (0-100) and issues by severity.",
  {
    url: z.string().optional().describe("URL to audit (omit for current page)"),
    standard: z.enum(["aa", "aaa"]).default("aa").describe("WCAG contrast standard to apply (aa or aaa)"),
  },
  async ({ url, standard }) => {
    await ensureBrowser();
    if (url) {
      try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
      await page.waitForTimeout(1500);
    }
    const result = await page.evaluate(extractA11yInBrowser, { standard });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "cbrowser_detect_darkmode",
  "Detect dark mode support: prefers-color-scheme media queries, CSS class-toggle patterns (e.g. .dark, [data-theme='dark']). Optionally activates dark mode via emulateMedia and captures the dark palette alongside the light palette.",
  {
    url: z.string().optional().describe("URL to check (omit for current page)"),
    activateDark: z.boolean().default(false).describe("If true, emulate prefers-color-scheme:dark and capture dark palette"),
  },
  async ({ url, activateDark }) => {
    await ensureBrowser();
    if (url) {
      try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
      await page.waitForTimeout(1500);
    }

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

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "cbrowser_extract_perf",
  "Performance metrics: navigation timing (TTFB, DOMContentLoaded, load), Core Web Vitals (LCP, CLS), resource waterfall summary by type (JS, CSS, images, fonts), total transfer sizes, DOM node count, and JS heap size.",
  {
    url: z.string().optional().describe("URL to measure (omit for current page)"),
  },
  async ({ url }) => {
    await ensureBrowser();
    if (url) {
      try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
      await page.waitForTimeout(2000);
    }
    const result = await page.evaluate(extractPerfInBrowser);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- Phase 8: Export ---

server.tool(
  "cbrowser_export_design_report",
  "Orchestrate Phase 1-3 design extraction tools to produce a full design system report for a URL. Outputs: report.html (visual), design-tokens.json (W3C format), design-tokens.css (copy-pasteable CSS variables).",
  {
    url: z.string().describe("URL to extract design system from"),
    include: z
      .array(z.enum(["colors", "fonts", "css_vars", "spacing", "components", "breakpoints"]))
      .default(["colors", "fonts", "css_vars", "spacing", "components", "breakpoints"])
      .describe("Sections to include in the report"),
  },
  async ({ url, include }) => {
    await ensureBrowser();
    try { await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }); } catch {}
    await page.waitForTimeout(1500);

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

    if (data.fonts?.fonts?.length) {
      tokens.fontFamily = {};
      data.fonts.fonts.forEach((f, i) => {
        tokens.fontFamily[`font-${i + 1}`] = { $value: f.family, $type: "fontFamily", $description: `${f.usage} use(s)` };
      });
      if (data.fonts.fontSizes?.length) {
        tokens.fontSize = {};
        data.fonts.fontSizes.forEach((s, i) => {
          tokens.fontSize[`size-${i + 1}`] = { $value: s.size, $type: "dimension", $description: `count: ${s.count}` };
        });
      }
    }

    if (data.spacing?.scale?.length) {
      tokens.spacing = {};
      data.spacing.scale.forEach((s, i) => {
        tokens.spacing[`space-${i + 1}`] = { $value: s.value, $type: "dimension", $description: `count: ${s.count}` };
      });
    }

    if (data.cssVars?.vars?.length) {
      tokens.cssCustomProperty = {};
      for (const v of data.cssVars.vars) {
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
    if (data.fonts?.fonts?.length) {
      cssLines.push('  /* Font Families */');
      data.fonts.fonts.forEach((f, i) => { cssLines.push(`  --font-family-${i + 1}: ${f.family};`); });
    }
    if (data.fonts?.fontSizes?.length) {
      cssLines.push('  /* Font Sizes */');
      data.fonts.fontSizes.forEach((s, i) => { cssLines.push(`  --font-size-${i + 1}: ${s.size};`); });
    }
    if (data.spacing?.scale?.length) {
      cssLines.push('  /* Spacing Scale */');
      data.spacing.scale.forEach((s, i) => { cssLines.push(`  --space-${i + 1}: ${s.value};`); });
    }
    if (data.cssVars?.vars?.length) {
      cssLines.push('  /* Original CSS Custom Properties */');
      for (const v of data.cssVars.vars) { cssLines.push(`  ${v.name}: ${v.value};`); }
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

    if (data.fonts?.fonts?.length) {
      body += `<section id="typography"><h2>Typography</h2><table>
        <thead><tr><th>Family</th><th>Weights</th><th>Sizes</th><th>Usage</th></tr></thead><tbody>`;
      for (const f of data.fonts.fonts) {
        body += `<tr><td style="font-family:${esc(f.family)}">${esc(f.family)}</td>
          <td>${(f.weights || []).join(', ')}</td>
          <td>${(f.sizes || []).slice(0, 5).join(', ')}</td>
          <td>${f.usage}</td></tr>`;
      }
      body += '</tbody></table></section>';
    }

    if (data.cssVars?.vars?.length) {
      body += `<section id="css-vars"><h2>CSS Custom Properties <span class="count">${data.cssVars.vars.length}</span></h2><table>
        <thead><tr><th>Variable</th><th>Value</th><th>Category</th></tr></thead><tbody>`;
      for (const v of data.cssVars.vars) {
        const isColor = /^#|^rgb/.test(v.value);
        const swatch = isColor ? `<span class="inline-swatch" style="background:${esc(v.value)}"></span>` : '';
        body += `<tr><td><code>${esc(v.name)}</code></td><td>${swatch}${esc(v.value)}</td><td>${esc(v.category || '')}</td></tr>`;
      }
      body += '</tbody></table></section>';
    }

    if (data.spacing?.scale?.length) {
      body += `<section id="spacing"><h2>Spacing Scale</h2><div class="spacing-list">`;
      for (const s of data.spacing.scale) {
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
        <thead><tr><th>Selector</th><th>Count</th><th>Role</th></tr></thead><tbody>`;
      for (const c of data.components.components) {
        body += `<tr><td><code>${esc(c.selector)}</code></td><td>${c.count}</td><td>${esc(c.role || '')}</td></tr>`;
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
