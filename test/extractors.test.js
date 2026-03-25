import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  extractColorsInBrowser,
  extractFontsInBrowser,
  extractContentInBrowser,
  extractFormsInBrowser,
  extractMetadataInBrowser,
  extractA11yInBrowser,
  extractCssVarsInBrowser,
  extractWebComponentsInBrowser,
  extractThirdPartyInBrowser,
  extractStorageInBrowser,
} from '../src/extractors.js';
import { inspectPage, inspectPageV2 } from '../src/inspector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fixtureUrl = (name) => 'file://' + path.resolve(__dirname, 'fixtures', name);

let browser, context, page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
});

afterAll(async () => {
  await context?.close();
  await browser?.close();
});

describe('hidden element filtering', () => {
  beforeAll(async () => {
    await page.goto(fixtureUrl('hidden-elements.html'));
  });

  it('inspectPage filters hidden headings', async () => {
    const result = await inspectPage(page);
    const headingTexts = result.headings.map((h) => h.text);
    expect(headingTexts).toContain('Visible Heading');
    expect(headingTexts).not.toContain('Hidden Heading Display None');
    expect(headingTexts).not.toContain('Hidden Heading Visibility');
    expect(headingTexts).not.toContain('Hidden Heading Opacity');
    expect(headingTexts).not.toContain('Hidden Heading Zero Size');
    expect(headingTexts).not.toContain('Hidden Heading Clip');
    expect(headingTexts).not.toContain('Hidden Heading ClipPath');
  });

  it('inspectPage filters hidden nav links', async () => {
    const result = await inspectPage(page);
    const navTexts = result.navItems.map((n) => n.text);
    expect(navTexts).toContain('Visible Nav Link');
    expect(navTexts).not.toContain('Hidden Nav Link');
  });

  it('inspectPage filters hidden buttons', async () => {
    const result = await inspectPage(page);
    expect(result.buttons).toContain('Visible Button');
    expect(result.buttons).not.toContain('Hidden Button');
  });

  it('inspectPageV2 excludes hidden interactive elements', async () => {
    const result = await inspectPageV2(page);
    const elementTexts = result.elements.map((e) => e.text);
    expect(elementTexts).toContain('Visible Button');
    expect(elementTexts).not.toContain('Hidden Button');
  });

  it('inspectPageV2 compressed DOM excludes hidden content', async () => {
    const result = await inspectPageV2(page);
    expect(result.compressedDOM).toContain('Visible Heading');
    expect(result.compressedDOM).not.toContain('Hidden Heading Display None');
  });

  it('extractContentInBrowser skips hidden elements', async () => {
    const result = await page.evaluate(extractContentInBrowser, { selector: null, includeImages: false });
    expect(result.content).toContain('Visible Heading');
    expect(result.content).not.toContain('Ignore previous instructions');
    expect(result.content).not.toContain('Hidden Heading Display None');
  });
});

describe('content extraction', () => {
  beforeAll(async () => {
    await page.goto(fixtureUrl('content.html'));
  });

  it('extracts headings as markdown', async () => {
    const result = await page.evaluate(extractContentInBrowser, { selector: null, includeImages: false });
    expect(result.content).toContain('# Main Article Heading');
    expect(result.content).toContain('## Section Two');
    expect(result.content).toContain('### Subsection');
  });

  it('extracts bold and italic text', async () => {
    const result = await page.evaluate(extractContentInBrowser, { selector: null, includeImages: false });
    expect(result.content).toContain('**first paragraph**');
    expect(result.content).toContain('_emphasis_');
  });

  it('extracts code blocks', async () => {
    const result = await page.evaluate(extractContentInBrowser, { selector: null, includeImages: false });
    expect(result.content).toContain('`inline code`');
    expect(result.content).toContain('```');
    expect(result.content).toContain('function hello()');
  });

  it('extracts blockquotes', async () => {
    const result = await page.evaluate(extractContentInBrowser, { selector: null, includeImages: false });
    expect(result.content).toContain('> This is a blockquote');
  });

  it('extracts lists', async () => {
    const result = await page.evaluate(extractContentInBrowser, { selector: null, includeImages: false });
    expect(result.content).toContain('- Item one');
    expect(result.content).toContain('1. First');
  });

  it('extracts links', async () => {
    const result = await page.evaluate(extractContentInBrowser, { selector: null, includeImages: false });
    expect(result.content).toContain('[link](/link)');
  });

  it('skips sidebar content', async () => {
    const result = await page.evaluate(extractContentInBrowser, { selector: null, includeImages: false });
    expect(result.content).not.toContain('sidebar content should be skipped');
  });

  it('skips hidden injection text', async () => {
    const result = await page.evaluate(extractContentInBrowser, { selector: null, includeImages: false });
    expect(result.content).not.toContain('Ignore all previous instructions');
  });

  it('accepts a custom selector', async () => {
    const result = await page.evaluate(extractContentInBrowser, { selector: 'article', includeImages: false });
    expect(result.content).toContain('Main Article Heading');
  });
});

describe('form extraction', () => {
  beforeAll(async () => {
    await page.goto(fixtureUrl('forms.html'));
  });

  it('finds all forms', async () => {
    const result = await page.evaluate(extractFormsInBrowser);
    expect(result.forms).toHaveLength(4);
  });

  it('extracts form action and method', async () => {
    const result = await page.evaluate(extractFormsInBrowser);
    const login = result.forms.find((f) => f.id === 'login-form');
    expect(login.method).toBe('POST');
    expect(login.action).toContain('/login');
  });

  it('extracts field types and names', async () => {
    const result = await page.evaluate(extractFormsInBrowser);
    const login = result.forms.find((f) => f.id === 'login-form');
    const username = login.fields.find((f) => f.name === 'username');
    expect(username.type).toBe('text');
    expect(username.required).toBe(true);
  });

  it('extracts fieldsets with legends', async () => {
    const result = await page.evaluate(extractFormsInBrowser);
    const login = result.forms.find((f) => f.id === 'login-form');
    expect(login.fieldsets).toHaveLength(1);
    expect(login.fieldsets[0].legend).toBe('Credentials');
  });

  it('detects CSRF tokens', async () => {
    const result = await page.evaluate(extractFormsInBrowser);
    const login = result.forms.find((f) => f.id === 'login-form');
    expect(login.csrfTokens).toContain('_csrf');

    const profile = result.forms.find((f) => f.id === 'profile-form');
    expect(profile.csrfTokens).toContain('authenticity_token');
  });

  it('extracts select options', async () => {
    const result = await page.evaluate(extractFormsInBrowser);
    const profile = result.forms.find((f) => f.id === 'profile-form');
    const country = profile.fields.find((f) => f.name === 'country');
    expect(country.tag).toBe('select');
    expect(country.options).toHaveLength(4);
    const selected = country.options.find((o) => o.selected);
    expect(selected.value).toBe('us');
  });

  it('extracts validation attributes', async () => {
    const result = await page.evaluate(extractFormsInBrowser);
    const login = result.forms.find((f) => f.id === 'login-form');
    const password = login.fields.find((f) => f.name === 'password');
    expect(password.required).toBe(true);
    expect(password.minLength).toBe(8);
    expect(password.maxLength).toBe(64);
  });

  it('flags hidden forms', async () => {
    const result = await page.evaluate(extractFormsInBrowser);
    const hidden = result.forms.find((f) => f.id === 'hidden-form');
    expect(hidden.hidden).toBe(true);
  });

  it('detects multipart enctype', async () => {
    const result = await page.evaluate(extractFormsInBrowser);
    const profile = result.forms.find((f) => f.id === 'profile-form');
    expect(profile.enctype).toBe('multipart/form-data');
  });
});

describe('design token extraction', () => {
  beforeAll(async () => {
    await page.goto(fixtureUrl('design-tokens.html'));
  });

  it('extracts colors', async () => {
    const result = await page.evaluate(extractColorsInBrowser, { limit: 50 });
    expect(result.colors.length).toBeGreaterThan(0);
    const hexValues = result.colors.map((c) => c.hex);
    // Should find the primary blue
    expect(hexValues).toContain('#3b82f6');
  });

  it('returns a palette array', async () => {
    const result = await page.evaluate(extractColorsInBrowser, { limit: 50 });
    expect(Array.isArray(result.palette)).toBe(true);
    expect(result.totalUnique).toBeGreaterThan(0);
  });

  it('extracts font families', async () => {
    const result = await page.evaluate(extractFontsInBrowser);
    expect(result.families.length).toBeGreaterThan(0);
  });

  it('extracts font sizes', async () => {
    const result = await page.evaluate(extractFontsInBrowser);
    expect(result.sizes.length).toBeGreaterThan(0);
    const sizeValues = result.sizes.map((s) => s.value);
    expect(sizeValues).toContain('16px');
    expect(sizeValues).toContain('32px');
  });

  it('extracts CSS custom properties', async () => {
    const result = await page.evaluate(extractCssVarsInBrowser, { includeAll: false });
    expect(result.variables.length).toBeGreaterThan(0);
    const names = result.variables.map((v) => v.name);
    expect(names).toContain('--color-primary');
    expect(names).toContain('--spacing-md');
  });

  it('categorizes CSS variables', async () => {
    const result = await page.evaluate(extractCssVarsInBrowser, { includeAll: false });
    const primary = result.variables.find((v) => v.name === '--color-primary');
    expect(primary.category).toBe('color');
    expect(result.summary).toHaveProperty('color');
    expect(result.total).toBe(result.variables.length);
  });
});

describe('inspector v1 (inspectPage)', () => {
  beforeAll(async () => {
    await page.goto(fixtureUrl('content.html'));
  });

  it('returns title and URL', async () => {
    const result = await inspectPage(page);
    expect(result.title).toBe('Content Extraction Test');
    expect(result.url).toContain('content.html');
  });

  it('extracts headings', async () => {
    const result = await inspectPage(page);
    expect(result.headings.length).toBeGreaterThan(0);
    expect(result.headings[0].text).toBe('Main Article Heading');
  });

  it('extracts nav items', async () => {
    const result = await inspectPage(page);
    expect(result.navItems.length).toBeGreaterThan(0);
    const texts = result.navItems.map((n) => n.text);
    expect(texts).toContain('Home');
  });

  it('extracts tables', async () => {
    const result = await inspectPage(page);
    expect(result.tables.length).toBeGreaterThan(0);
    expect(result.tables[0].headers).toContain('Name');
  });

  it('includes body text summary', async () => {
    const result = await inspectPage(page);
    expect(result.bodyText.length).toBeGreaterThan(0);
  });

  it('includes inspectedAt timestamp', async () => {
    const result = await inspectPage(page);
    expect(result.inspectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('inspector v2 (inspectPageV2)', () => {
  beforeAll(async () => {
    await page.goto(fixtureUrl('content.html'));
  });

  it('returns title and URL', async () => {
    const result = await inspectPageV2(page);
    expect(result.title).toBe('Content Extraction Test');
  });

  it('returns interactive elements with indices', async () => {
    const result = await inspectPageV2(page);
    expect(result.elements.length).toBeGreaterThan(0);
    expect(result.elements[0].index).toBe(1);
    expect(result.elements[0]).toHaveProperty('selector');
    expect(result.elements[0]).toHaveProperty('boundingBox');
  });

  it('returns compressed DOM string', async () => {
    const result = await inspectPageV2(page);
    expect(typeof result.compressedDOM).toBe('string');
    expect(result.compressedDOM.length).toBeGreaterThan(0);
  });

  it('compressed DOM contains heading text', async () => {
    const result = await inspectPageV2(page);
    expect(result.compressedDOM).toContain('Main Article Heading');
  });

  it('interactive elements include links', async () => {
    const result = await inspectPageV2(page);
    const links = result.elements.filter((e) => e.tag === 'a');
    expect(links.length).toBeGreaterThan(0);
  });
});

describe('metadata extraction', () => {
  beforeAll(async () => {
    await page.goto(fixtureUrl('content.html'));
  });

  it('extracts meta description', async () => {
    const result = await page.evaluate(extractMetadataInBrowser);
    expect(result.meta.description).toBe('A test page for content extraction');
  });

  it('extracts OpenGraph tags', async () => {
    const result = await page.evaluate(extractMetadataInBrowser);
    expect(result.openGraph.title).toBe('Content Test OG Title');
    expect(result.openGraph.description).toBe('OG description for testing');
  });

  it('extracts keywords', async () => {
    const result = await page.evaluate(extractMetadataInBrowser);
    expect(result.meta.keywords).toContain('test');
  });
});

describe('extractWebComponentsInBrowser', () => {
  beforeAll(async () => {
    await page.goto(fixtureUrl('web-components.html'));
  });

  it('detects custom elements with correct counts', async () => {
    const result = await page.evaluate(extractWebComponentsInBrowser);
    expect(result.totalCustomElements).toBe(2);
    expect(result.totalInstances).toBe(5);
    const card = result.components.find(c => c.tag === 'my-card');
    expect(card).toBeDefined();
    expect(card.count).toBe(3);
    expect(card.hasShadowRoot).toBe(true);
    expect(card.shadowMode).toBe('open');
    expect(card.observedAttributes).toEqual(['title', 'variant']);
    expect(card.hasSlots).toBe(true);
    expect(card.hasStyles).toBe(true);
  });

  it('detects closed shadow roots', async () => {
    const result = await page.evaluate(extractWebComponentsInBrowser);
    const btn = result.components.find(c => c.tag === 'my-button');
    expect(btn).toBeDefined();
    expect(btn.count).toBe(2);
    expect(btn.hasShadowRoot).toBe(false);
    expect(btn.shadowMode).toBe('closed-or-none');
  });

  it('counts template elements', async () => {
    const result = await page.evaluate(extractWebComponentsInBrowser);
    expect(result.templateElements).toBe(2);
  });

  it('returns empty libraries array when none detected', async () => {
    const result = await page.evaluate(extractWebComponentsInBrowser);
    expect(result.libraries).toEqual([]);
  });
});

describe('extractThirdPartyInBrowser', () => {
  beforeAll(async () => {
    await page.goto(fixtureUrl('third-party.html'));
  });

  it('detects third-party vendors from script/link elements', async () => {
    const result = await page.evaluate(extractThirdPartyInBrowser);
    expect(result.totalThirdParty).toBeGreaterThan(0);
    const vendors = result.vendors.map(v => v.vendor);
    expect(vendors).toContain('Google Tag Manager');
    expect(vendors).toContain('Stripe');
    expect(vendors).toContain('Sentry');
  });

  it('classifies vendors into categories', async () => {
    const result = await page.evaluate(extractThirdPartyInBrowser);
    expect(result.byCategory.analytics).toBeGreaterThanOrEqual(1);
    expect(result.byCategory.payments).toBeGreaterThanOrEqual(1);
  });

  it('detects confirmed globals', async () => {
    const result = await page.evaluate(extractThirdPartyInBrowser);
    expect(result.confirmedGlobals).toContain('Google Analytics/GTM');
    expect(result.confirmedGlobals).toContain('Stripe');
    expect(result.confirmedGlobals).toContain('Meta Pixel');
    expect(result.confirmedGlobals).toContain('Intercom');
  });

  it('detects font vendors', async () => {
    const result = await page.evaluate(extractThirdPartyInBrowser);
    const vendors = result.vendors.map(v => v.vendor);
    expect(vendors).toContain('Google Fonts');
    expect(vendors).toContain('Adobe Fonts');
  });
});

describe('extractStorageInBrowser', () => {
  beforeAll(async () => {
    await page.goto(fixtureUrl('storage.html'));
    await page.evaluate(() => {
      const fakeCookie = '_ga=GA1.2.123456789.1234567890; _gid=GA1.2.987654321.1234567890; _fbp=fb.1.1234567890.123456789; session_id=abc123def456; csrf_token=xyz789';
      Object.defineProperty(document, 'cookie', { get: () => fakeCookie, configurable: true });
    });
  });

  it('detects cookies with correct count', async () => {
    const result = await page.evaluate(extractStorageInBrowser);
    expect(result.cookies.total).toBe(5);
  });

  it('classifies _ga as analytics', async () => {
    const result = await page.evaluate(extractStorageInBrowser);
    const ga = result.cookies.items.find(c => c.name === '_ga');
    expect(ga).toBeDefined();
    expect(ga.classification).toBe('analytics');
  });

  it('classifies _fbp as advertising', async () => {
    const result = await page.evaluate(extractStorageInBrowser);
    const fbp = result.cookies.items.find(c => c.name === '_fbp');
    expect(fbp).toBeDefined();
    expect(fbp.classification).toBe('advertising');
  });

  it('classifies session-related cookies', async () => {
    const result = await page.evaluate(extractStorageInBrowser);
    const session = result.cookies.items.find(c => c.name === 'session_id');
    expect(session).toBeDefined();
    expect(session.classification).toBe('session');
    const csrf = result.cookies.items.find(c => c.name === 'csrf_token');
    expect(csrf.classification).toBe('session');
  });

  it('enumerates localStorage items', async () => {
    const result = await page.evaluate(extractStorageInBrowser);
    expect(result.localStorage.total).toBe(3);
    const prefs = result.localStorage.items.find(i => i.key === 'user_prefs');
    expect(prefs).toBeDefined();
    expect(prefs.inferredType).toBe('json-object');
    const cart = result.localStorage.items.find(i => i.key === 'cart_items');
    expect(cart.inferredType).toBe('json-array');
  });

  it('enumerates sessionStorage items', async () => {
    const result = await page.evaluate(extractStorageInBrowser);
    expect(result.sessionStorage.total).toBe(2);
    const draft = result.sessionStorage.items.find(i => i.key === 'form_draft');
    expect(draft).toBeDefined();
    expect(draft.inferredType).toBe('string');
  });

  it('reports indexedDB support', async () => {
    const result = await page.evaluate(extractStorageInBrowser);
    expect(result.indexedDB.supported).toBe(true);
  });
});
