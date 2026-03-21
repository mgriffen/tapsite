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
