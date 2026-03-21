#!/usr/bin/env node

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { chromium } = require("playwright");
const { inspectPage } = require("./inspector");
const { createRunDir, screenshotPath, exportJSON, exportMarkdown } = require("./exporter");
const config = require("./config");
const fs = require("fs");
const path = require("path");

// Shared browser state
let context = null;
let page = null;
let isHeadless = null;

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
  }
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
  "Navigate the current browser session to a URL and return page content summary.",
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

    const title = await page.title();
    const currentUrl = page.url();
    const bodyText = await page.evaluate(() =>
      (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 3000)
    );

    return {
      content: [
        {
          type: "text",
          text: `Title: ${title}\nURL: ${currentUrl}\n\nContent:\n${bodyText}`,
        },
      ],
    };
  }
);

server.tool(
  "cbrowser_inspect",
  "Inspect the current page or a URL — extracts navigation, headings, buttons, forms, tables, links, and body text. Returns structured data.",
  {
    url: z.string().optional().describe("URL to inspect (omit to inspect current page)"),
  },
  async ({ url }) => {
    await ensureBrowser();
    if (url) {
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      } catch {}
      await page.waitForTimeout(1500);
    }

    const data = await inspectPage(page);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "cbrowser_screenshot",
  "Take a screenshot of the current page or a URL. Returns the screenshot as an image.",
  {
    url: z.string().optional().describe("URL to screenshot (omit for current page)"),
    fullPage: z.boolean().default(true).describe("Capture full scrollable page"),
  },
  async ({ url, fullPage }) => {
    await ensureBrowser();
    if (url) {
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      } catch {}
      await page.waitForTimeout(1500);
    }

    const buffer = await page.screenshot({ fullPage });
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
