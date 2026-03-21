#!/usr/bin/env node

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { chromium } = require("playwright");
const { inspectPage, inspectPageV2 } = require("./inspector");
const { createRunDir, screenshotPath, exportJSON, exportMarkdown } = require("./exporter");
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
  "Export inspection results for one or more URLs as Markdown report + JSON + screenshots.",
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

    return {
      content: [
        {
          type: "text",
          text: `Exported ${results.length} page(s):\n  JSON: ${jsonPath}\n  Markdown: ${mdPath}\n  Screenshots: ${runDir}/screenshots/`,
        },
      ],
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
