/**
 * Extract UI structure from a document (or frame's document).
 * Runs inside page.evaluate / frame.evaluate.
 */
function extractStructure() {
  const textOf = (el) => (el.textContent || '').trim();
  const unique = (arr) => [...new Set(arr.filter(Boolean))];

  // Navigation items — links inside nav elements, or common nav patterns
  const navItems = unique(
    [...document.querySelectorAll('nav a, [role="navigation"] a, .nav a, .sidebar a, .menu a')]
      .map((a) => ({ text: textOf(a), href: a.getAttribute('href') }))
      .filter((n) => n.text)
      .map((n) => JSON.stringify(n))
  ).map((s) => JSON.parse(s));

  // Also grab all links as potential nav if no semantic nav found
  const allLinks = [...document.querySelectorAll('a[href]')]
    .map((a) => ({
      text: textOf(a),
      href: a.getAttribute('href'),
    }))
    .filter((l) => l.text && l.href && !l.href.startsWith('javascript:') && !l.href.startsWith('#'));

  // Headings
  const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
    .map((h) => ({ level: parseInt(h.tagName[1]), text: textOf(h) }))
    .filter((h) => h.text);

  // Buttons
  const buttons = unique(
    [...document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]')]
      .map((b) => textOf(b) || b.getAttribute('value') || b.getAttribute('aria-label') || '')
  );

  // Form fields
  const formFields = [...document.querySelectorAll('input, select, textarea')]
    .map((f) => ({
      type: f.type || f.tagName.toLowerCase(),
      name: f.name || undefined,
      label:
        f.getAttribute('aria-label') ||
        (f.id && document.querySelector(`label[for="${f.id}"]`)?.textContent?.trim()) ||
        f.placeholder ||
        undefined,
    }))
    .filter((f) => f.type !== 'hidden');

  // Table headers
  const tables = [...document.querySelectorAll('table')].map((table) => {
    const headers = [...table.querySelectorAll('th')].map((th) => textOf(th));
    const caption = table.querySelector('caption')?.textContent?.trim();
    const rowCount = table.querySelectorAll('tr').length;
    return { caption, headers, rowCount };
  });

  // Links (non-nav)
  const links = unique(
    [...document.querySelectorAll('a[href]')]
      .map((a) => a.getAttribute('href'))
      .filter((h) => h && !h.startsWith('javascript:') && !h.startsWith('#'))
  );

  // Detect frames/iframes
  const frameCount = document.querySelectorAll('frame, iframe').length;
  const frameInfo = [...document.querySelectorAll('frame, iframe')].map((f) => ({
    tag: f.tagName.toLowerCase(),
    name: f.name || undefined,
    src: f.src || undefined,
    id: f.id || undefined,
  }));

  // Body text summary (first 500 chars, stripped of excess whitespace)
  const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500);

  return { navItems, allLinks, headings, buttons, formFields, tables, links, frameCount, frameInfo, bodyText };
}

/**
 * Inspect a page and extract UI structure metadata.
 * Handles framesets and iframes by inspecting each frame separately.
 */
async function inspectPage(page) {
  const title = await page.title();
  const url = page.url();

  // First, check if page uses frames
  const topLevel = await page.evaluate(extractStructure);

  const frameResults = [];

  if (topLevel.frameCount > 0) {
    console.log(`  Detected ${topLevel.frameCount} frame(s), inspecting each...`);

    for (const frame of page.frames()) {
      // Skip the main frame (already captured in topLevel)
      if (frame === page.mainFrame()) continue;

      try {
        const frameData = await frame.evaluate(extractStructure);
        const frameName = frame.name() || frame.url();
        frameResults.push({
          frameName,
          frameUrl: frame.url(),
          ...frameData,
        });
        console.log(`    Frame "${frameName}": ${frameData.headings.length} headings, ${frameData.allLinks.length} links, ${frameData.buttons.length} buttons`);
      } catch (err) {
        console.log(`    Frame skipped (cross-origin or not loaded): ${frame.url()}`);
      }
    }
  }

  // Merge frame data into a combined view
  const combined = { ...topLevel };
  for (const fr of frameResults) {
    combined.navItems = [...combined.navItems, ...fr.navItems];
    combined.allLinks = [...combined.allLinks, ...fr.allLinks];
    combined.headings = [...combined.headings, ...fr.headings];
    combined.buttons = [...combined.buttons, ...fr.buttons];
    combined.formFields = [...combined.formFields, ...fr.formFields];
    combined.tables = [...combined.tables, ...fr.tables];
    combined.bodyText += '\n---\n' + (fr.bodyText || '');
  }

  return {
    title,
    url,
    ...combined,
    frames: frameResults.length ? frameResults : undefined,
    inspectedAt: new Date().toISOString(),
  };
}

module.exports = { inspectPage };
