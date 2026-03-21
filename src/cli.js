#!/usr/bin/env node

const readline = require('readline');
const { launchPersistent } = require('./browser');
const { inspectPage } = require('./inspector');
const { createRunDir, screenshotPath, exportJSON, exportMarkdown } = require('./exporter');

const command = process.argv[2];
const args = process.argv.slice(3);

async function login() {
  console.log('Launching browser for manual login...');
  console.log('Log in and complete MFA, then close the browser when done.');
  console.log('Your session will be saved automatically.\n');

  const context = await launchPersistent();
  const page = context.pages()[0] || await context.newPage();

  // If a URL was provided, navigate there
  if (args[0]) {
    await page.goto(args[0]);
  }

  // Wait for the user to close the browser
  await new Promise((resolve) => {
    context.on('close', resolve);
  });

  console.log('Session saved.');
}

async function inspect() {
  const urls = args;
  if (!urls.length) {
    console.error('Usage: cbrowser inspect <url1> [url2] ...');
    process.exit(1);
  }

  console.log(`Inspecting ${urls.length} page(s)...\n`);

  const context = await launchPersistent();
  const runDir = createRunDir();
  const results = [];

  try {
    for (const [i, url] of urls.entries()) {
      const page = await context.newPage();
      console.log(`[${i + 1}/${urls.length}] ${url}`);

      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      } catch (err) {
        console.log(`  Warning: page did not reach network idle (${err.message}), inspecting current state`);
      }

      // Brief pause to let any client-side rendering finish
      await page.waitForTimeout(1500);

      const data = await inspectPage(page);
      await page.screenshot({ path: screenshotPath(runDir, i), fullPage: true });
      results.push(data);

      console.log(`  Title: ${data.title}`);
      console.log(`  Nav items: ${data.navItems.length}, Headings: ${data.headings.length}, Buttons: ${data.buttons.length}`);

      await page.close();
    }

    const jsonPath = exportJSON(runDir, results);
    const mdPath = exportMarkdown(runDir, results);

    console.log(`\nDone! Output saved to:`);
    console.log(`  JSON:       ${jsonPath}`);
    console.log(`  Markdown:   ${mdPath}`);
    console.log(`  Screenshots: ${runDir}/screenshots/`);
  } finally {
    await context.close();
  }
}

/**
 * Interactive session: login, then inspect pages without closing the browser.
 * Keeps session cookies alive for sites that use non-persistent sessions.
 */
async function session() {
  console.log('Launching browser for interactive session...');
  console.log('Log in manually, then come back here to inspect pages.\n');

  const context = await launchPersistent();
  const page = context.pages()[0] || await context.newPage();

  if (args[0]) {
    await page.goto(args[0]);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => new Promise((resolve) => rl.question('\ncbrowser> ', resolve));

  console.log('Commands:');
  console.log('  capture                    Inspect the current page (use after navigating in browser)');
  console.log('  inspect <url> [url2] ...   Navigate to URL(s) and inspect');
  console.log('  screenshot [url]           Take a screenshot (current page if no URL)');
  console.log('  pages                      List open pages');
  console.log('  quit                       Save session and exit\n');

  const runDir = createRunDir();
  const results = [];
  let pageIndex = 0;
  let running = true;

  // If browser is closed externally, exit gracefully
  context.on('close', () => {
    if (running) {
      running = false;
      console.log('\nBrowser closed. Saving results...');
      rl.close();
    }
  });

  try {
    while (running) {
      let input;
      try {
        input = await prompt();
      } catch {
        break;
      }

      const parts = input.trim().split(/\s+/);
      const cmd = parts[0]?.toLowerCase();
      const cmdArgs = parts.slice(1);

      if (!cmd) continue;

      if (cmd === 'quit' || cmd === 'exit') {
        break;
      }

      if (cmd === 'capture') {
        // Inspect whatever page is currently active in the browser
        const pages = context.pages();
        if (!pages.length) {
          console.log('No pages open in browser.');
          continue;
        }
        // Use the last page (most recently opened/focused)
        const activePage = pages[pages.length - 1];
        console.log(`Capturing current page: ${activePage.url()}`);

        await activePage.waitForTimeout(500);

        const data = await inspectPage(activePage);
        await activePage.screenshot({ path: screenshotPath(runDir, pageIndex), fullPage: true });
        results.push(data);

        console.log(`  Title: ${data.title}`);
        console.log(`  Nav items: ${data.navItems.length}, Headings: ${data.headings.length}, Buttons: ${data.buttons.length}`);
        pageIndex++;
        continue;
      }

      if (cmd === 'inspect') {
        if (!cmdArgs.length) {
          console.log('Usage: inspect <url> [url2] ...');
          continue;
        }

        for (const url of cmdArgs) {
          // Reuse the existing page instead of opening a new tab
          // This preserves URL-based session tokens (e.g. PHPSESSID in URL)
          const pages = context.pages();
          const inspectTarget = pages[pages.length - 1] || await context.newPage();
          console.log(`Inspecting: ${url}`);

          try {
            await inspectTarget.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
          } catch (err) {
            console.log(`  Warning: page did not reach network idle (${err.message}), inspecting current state`);
          }

          await inspectTarget.waitForTimeout(1500);

          const data = await inspectPage(inspectTarget);
          await inspectTarget.screenshot({ path: screenshotPath(runDir, pageIndex), fullPage: true });
          results.push(data);

          console.log(`  Title: ${data.title}`);
          console.log(`  Nav items: ${data.navItems.length}, Headings: ${data.headings.length}, Buttons: ${data.buttons.length}`);

          pageIndex++;
        }
        continue;
      }

      if (cmd === 'pages') {
        const pages = context.pages();
        if (!pages.length) {
          console.log('No pages open.');
        } else {
          for (const [i, p] of pages.entries()) {
            console.log(`  [${i}] ${p.url()}`);
          }
        }
        continue;
      }

      if (cmd === 'screenshot') {
        const pages = context.pages();
        const ssPage = cmdArgs[0]
          ? await (async () => {
              const p = pages[pages.length - 1] || await context.newPage();
              try { await p.goto(cmdArgs[0], { waitUntil: 'networkidle', timeout: 30000 }); } catch {}
              await p.waitForTimeout(1500);
              return p;
            })()
          : pages[pages.length - 1];

        if (!ssPage) {
          console.log('No page open. Provide a URL or navigate in the browser first.');
          continue;
        }
        const ssPath = screenshotPath(runDir, pageIndex);
        await ssPage.screenshot({ path: ssPath, fullPage: true });
        console.log(`  Saved: ${ssPath}`);
        pageIndex++;
        continue;
      }

      console.log(`Unknown command: ${cmd}. Try: capture, inspect, pages, screenshot, quit`);
    }
  } finally {
    rl.close();
  }

  if (results.length) {
    const jsonPath = exportJSON(runDir, results);
    const mdPath = exportMarkdown(runDir, results);
    console.log(`\nResults saved:`);
    console.log(`  JSON:       ${jsonPath}`);
    console.log(`  Markdown:   ${mdPath}`);
    console.log(`  Screenshots: ${runDir}/screenshots/`);
  } else {
    console.log('\nNo pages inspected.');
  }

  if (running) {
    await context.close();
  }

  console.log('Session saved.');
}

async function main() {
  switch (command) {
    case 'login':
      await login();
      break;
    case 'inspect':
      await inspect();
      break;
    case 'session':
      await session();
      break;
    default:
      console.log('cbrowser — Authenticated Dashboard Discovery Tool\n');
      console.log('Commands:');
      console.log('  cbrowser login [url]            Open browser to log in and save session');
      console.log('  cbrowser inspect <url> [...]     Inspect pages using saved session');
      console.log('  cbrowser session [url]           Login + inspect in one session (interactive)');
      process.exit(0);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
