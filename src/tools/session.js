const { z } = require('zod');
const { sanitizeForLLM } = require('../sanitizer');
const browser = require('../browser');
const { navigateIfNeeded, indexPage, resolveElement, formatIndexResult } = require('../helpers');

module.exports = function registerSessionTools(server) {

  server.tool(
    'cbrowser_login',
    'Auto-login with credentials. Session persists across calls.',
    {
      url: z.string().describe('Login page URL'),
      username: z.string().describe('Username'),
      password: z.string().describe('Password'),
      usernameSelector: z.string().default('input[name="username"]').describe('Username field selector'),
      passwordSelector: z.string().default('input[name="password"]').describe('Password field selector'),
      submitSelector: z.string().default('input[type="submit"]').describe('Submit button selector'),
    },
    async ({ url, username, password, usernameSelector, passwordSelector, submitSelector }) => {
      await browser.ensureBrowser();
      await browser.page.goto(url);
      await browser.page.fill(usernameSelector, username);
      await browser.page.fill(passwordSelector, password);
      await browser.page.click(submitSelector);
      await browser.page.waitForLoadState('networkidle').catch(() => {});
      await browser.page.waitForTimeout(2000);

      const title = await browser.page.title();
      const currentUrl = browser.page.url();
      const bodyPreview = await browser.page.evaluate(() =>
        (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500)
      );

      return {
        content: [{
          type: 'text',
          text: `Logged in successfully.\nTitle: ${title}\nURL: ${currentUrl}\n\nPage preview:\n${bodyPreview}`,
        }],
      };
    }
  );

  server.tool(
    'cbrowser_login_manual',
    'Open headed browser for manual login (MFA). Call login_check when done.',
    {
      url: z.string().describe('Login page URL'),
    },
    async ({ url }) => {
      await browser.ensureBrowser(false);
      await browser.page.goto(url);

      const title = await browser.page.title();
      return {
        content: [{
          type: 'text',
          text: `Browser window opened to: ${url}\nPage title: ${title}\n\nThe user should now log in manually (including MFA/authenticator). Once they confirm they are logged in, use cbrowser_login_check to verify the session.`,
        }],
      };
    }
  );

  server.tool(
    'cbrowser_login_check',
    'Verify auth state after manual login. Returns title, URL, content preview.',
    {},
    async () => {
      if (!browser.context || !browser.page) {
        return {
          content: [{
            type: 'text',
            text: 'No browser session active. Use cbrowser_login_manual to open a browser first.',
          }],
        };
      }

      const title = await browser.page.title();
      const currentUrl = browser.page.url();
      const bodyPreview = await browser.page.evaluate(() =>
        (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1000)
      );

      return {
        content: [{
          type: 'text',
          text: `Current page:\nTitle: ${title}\nURL: ${currentUrl}\n\nContent preview:\n${bodyPreview}`,
        }],
      };
    }
  );

  server.tool(
    'cbrowser_navigate',
    'Navigate to URL. Returns compressed DOM with numbered interactive elements.',
    {
      url: z.string().describe('URL to navigate to'),
    },
    async ({ url }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);

      const result = await indexPage();
      return {
        content: [{ type: 'text', text: formatIndexResult(result) }],
      };
    }
  );

  server.tool(
    'cbrowser_inspect',
    'Inspect page DOM with numbered interactive elements. Optional screenshot.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
      screenshot: z.boolean().default(false).describe('Include screenshot'),
    },
    async ({ url, screenshot }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);

      const result = await indexPage();
      const content = [{ type: 'text', text: formatIndexResult(result) }];

      if (screenshot) {
        const buffer = await browser.page.screenshot({ fullPage: true });
        content.push({
          type: 'image',
          data: buffer.toString('base64'),
          mimeType: 'image/png',
        });
      }

      return { content };
    }
  );

  server.tool(
    'cbrowser_screenshot',
    'Screenshot the page. Optional element highlighting with numbered badges.',
    {
      url: z.string().optional().describe('URL (omit for current page)'),
      fullPage: z.boolean().default(true).describe('Full scrollable page'),
      highlight: z.boolean().default(false).describe('Overlay numbered element badges'),
    },
    async ({ url, fullPage, highlight }) => {
      await browser.ensureBrowser();
      await navigateIfNeeded(url);

      if (highlight) {
        if (!browser.elementMap.length) {
          await indexPage();
        }
        await browser.page.evaluate((elements) => {
          const container = document.createElement('div');
          container.id = '__cbrowser_highlights__';
          container.style.cssText = 'position:absolute;top:0;left:0;z-index:999999;pointer-events:none;';
          for (const el of elements) {
            const badge = document.createElement('div');
            badge.className = '__cbrowser_badge__';
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
        }, browser.elementMap);
      }

      const imageBuffer = await browser.page.screenshot({ fullPage });

      if (highlight) {
        await browser.page.evaluate(() => {
          document.getElementById('__cbrowser_highlights__')?.remove();
        });
      }

      return {
        content: [{
          type: 'image',
          data: imageBuffer.toString('base64'),
          mimeType: 'image/png',
        }],
      };
    }
  );

  server.tool(
    'cbrowser_act',
    'Click, fill, select, check, or hover an indexed element. Returns updated DOM.',
    {
      action: z.enum(['click', 'fill', 'select', 'check', 'hover']).describe('Action type'),
      index: z.number().describe('Element index from inspect/navigate'),
      value: z.string().optional().describe('Value for fill/select'),
    },
    async ({ action, index, value }) => {
      await browser.ensureBrowser();
      if (!browser.elementMap.length) {
        return {
          content: [{
            type: 'text',
            text: 'No element map available. Use cbrowser_navigate or cbrowser_inspect first to index the page.',
          }],
        };
      }

      const { locator, element } = resolveElement(index);

      try {
        switch (action) {
          case 'click':
            await locator.click();
            break;
          case 'fill':
            if (!value && value !== '')
              return { content: [{ type: 'text', text: 'Error: "value" is required for fill action.' }] };
            await locator.fill(value);
            break;
          case 'select':
            if (!value)
              return { content: [{ type: 'text', text: 'Error: "value" is required for select action.' }] };
            await locator.selectOption(value);
            break;
          case 'check': {
            const checked = await locator.isChecked().catch(() => false);
            if (checked) { await locator.uncheck(); } else { await locator.check(); }
            break;
          }
          case 'hover':
            await locator.hover();
            break;
        }
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `Action "${action}" on [${index}] (${element.tag}) failed: ${err.message}`,
          }],
        };
      }

      await browser.page.waitForLoadState('networkidle').catch(() => {});
      await browser.page.waitForTimeout(500);

      const result = await indexPage();
      return {
        content: [{
          type: 'text',
          text: `Action "${action}" on [${index}] (${element.tag} "${element.text || ''}") completed.\n\n${formatIndexResult(result)}`,
        }],
      };
    }
  );

  server.tool(
    'cbrowser_scroll',
    'Scroll page or scroll an element into view.',
    {
      direction: z.enum(['up', 'down', 'top', 'bottom']).optional().describe('Direction (ignored if index set)'),
      index: z.number().optional().describe('Element index to scroll to'),
    },
    async ({ direction, index }) => {
      await browser.ensureBrowser();

      if (index !== undefined) {
        const { locator } = resolveElement(index);
        await locator.scrollIntoViewIfNeeded();
      } else {
        const scrollMap = {
          up: 'window.scrollBy(0, -window.innerHeight * 0.8)',
          down: 'window.scrollBy(0, window.innerHeight * 0.8)',
          top: 'window.scrollTo(0, 0)',
          bottom: 'window.scrollTo(0, document.body.scrollHeight)',
        };
        await browser.page.evaluate(scrollMap[direction || 'down']);
      }

      await browser.page.waitForTimeout(300);

      const result = await indexPage();
      return {
        content: [{
          type: 'text',
          text: `Scrolled ${index !== undefined ? `element [${index}] into view` : direction || 'down'}.\n\n${formatIndexResult(result)}`,
        }],
      };
    }
  );

  server.tool(
    'cbrowser_run_js',
    'Run JS in page context. Large results (>2KB) write to disk.',
    {
      script: z.string().describe('JS expression (must return a value)'),
    },
    async ({ script }) => {
      await browser.ensureBrowser();
      const result = await browser.page.evaluate(script);
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      if (text.length > 2000) {
        const preview = text.slice(0, 500) + '\n…(truncated)';
        const { summarizeResult } = require('../helpers');
        return summarizeResult('run-js', result, `Result (${text.length} chars, truncated):\n${preview}`, { tool: 'cbrowser_run_js', description: 'JavaScript evaluation result from page context' });
      }
      return { content: [{ type: 'text', text: sanitizeForLLM(text) }] };
    }
  );

  server.tool(
    'cbrowser_close',
    'Close the browser session.',
    {},
    async () => {
      await browser.closeBrowser();
      return {
        content: [{ type: 'text', text: 'Browser session closed.' }],
      };
    }
  );

};
