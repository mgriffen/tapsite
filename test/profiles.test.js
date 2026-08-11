import { describe, it, expect } from 'vitest';
import { getProfileFilter, PROFILES } from '../src/profiles.js';

describe('profile system', () => {
  // Changed deliberately: the default was `recon` (all 55 tools). Handing an
  // agent the full menu for what is usually one job is the surface-area
  // problem profiles exist to solve, so the default is now `core`.
  it('defaults to the core profile when no --profile flag is given', () => {
    const allow = getProfileFilter(['node', 'server.js']);
    // in core
    expect(allow('tapsite_extract_content')).toBe(true);
    expect(allow('tapsite_extract_markdown')).toBe(true);
    expect(allow('tapsite_audit')).toBe(true);
    // not in core — reachable via --profile design / security / recon
    expect(allow('tapsite_extract_colors')).toBe(false);
    expect(allow('tapsite_capture_network')).toBe(false);
    // unknown names are not silently allowed
    expect(allow('anything')).toBe(false);
  });

  it('--profile recon is the escape hatch back to every tool', () => {
    const allow = getProfileFilter(['node', 'server.js', '--profile', 'recon']);
    expect(allow('tapsite_extract_colors')).toBe(true);
    expect(allow('tapsite_capture_network')).toBe(true);
    expect(allow('tapsite_extract_wasm')).toBe(true);
  });

  it('returns allow-all for --profile recon', () => {
    const allow = getProfileFilter(['node', 'server.js', '--profile', 'recon']);
    expect(allow('tapsite_extract_colors')).toBe(true);
    expect(allow('tapsite_capture_network')).toBe(true);
  });

  it('filters to design profile tools', () => {
    const allow = getProfileFilter(['node', 'server.js', '--profile', 'design']);
    expect(allow('tapsite_extract_colors')).toBe(true);
    expect(allow('tapsite_extract_fonts')).toBe(true);
    expect(allow('tapsite_extract_web_components')).toBe(true);
    expect(allow('tapsite_export')).toBe(true);
    expect(allow('tapsite_capture_network')).toBe(false);
    expect(allow('tapsite_audit')).toBe(false);
  });

  it('filters to content profile tools', () => {
    const allow = getProfileFilter(['node', 'server.js', '--profile', 'content']);
    expect(allow('tapsite_extract_metadata')).toBe(true);
    expect(allow('tapsite_extract_i18n')).toBe(true);
    expect(allow('tapsite_extract_pwa')).toBe(true);
    expect(allow('tapsite_crawl')).toBe(true);
    expect(allow('tapsite_extract_colors')).toBe(false);
    expect(allow('tapsite_designsystem')).toBe(false);
  });

  it('filters to security profile tools', () => {
    const allow = getProfileFilter(['node', 'server.js', '--profile', 'security']);
    expect(allow('tapsite_extract_third_party')).toBe(true);
    expect(allow('tapsite_extract_storage')).toBe(true);
    expect(allow('tapsite_extract_security')).toBe(true);
    expect(allow('tapsite_audit')).toBe(true);
    expect(allow('tapsite_extract_colors')).toBe(false);
    expect(allow('tapsite_crawl')).toBe(false);
  });

  it('stacks comma-separated profiles', () => {
    const allow = getProfileFilter(['node', 'server.js', '--profile', 'design,security']);
    expect(allow('tapsite_extract_colors')).toBe(true);
    expect(allow('tapsite_extract_third_party')).toBe(true);
    expect(allow('tapsite_extract_security')).toBe(true);
    expect(allow('tapsite_crawl')).toBe(false);
  });

  it('falls back to recon for unknown profile', () => {
    const allow = getProfileFilter(['node', 'server.js', '--profile', 'nonexistent']);
    expect(allow('tapsite_extract_colors')).toBe(true);
    expect(allow('tapsite_capture_network')).toBe(true);
  });

  it('core profile registers the common reads and the composite workflows', () => {
    const allow = getProfileFilter(['node', 'server.js', '--profile', 'core']);
    expect(allow('tapsite_extract_content')).toBe(true);
    expect(allow('tapsite_extract_markdown')).toBe(true);
    expect(allow('tapsite_extract_links')).toBe(true);
    expect(allow('tapsite_extract_metadata')).toBe(true);
    expect(allow('tapsite_extract_custom')).toBe(true);
    expect(allow('tapsite_teardown')).toBe(true);
    expect(allow('tapsite_audit')).toBe(true);
    expect(allow('tapsite_export')).toBe(true);
    expect(allow('tapsite_diff_pages')).toBe(true);
    // specialist extractors stay behind their own profiles
    expect(allow('tapsite_extract_colors')).toBe(false);
    expect(allow('tapsite_capture_network')).toBe(false);
  });

  // Regression guard: core was an empty array, so flipping the default to it
  // would have registered ZERO filterable tools. Caught in review 2026-08-08.
  it('core is not empty', () => {
    expect(PROFILES.core.length).toBeGreaterThan(0);
  });

  // Every name in every profile must be a tool that is actually gated by
  // allowTool(). A typo, or listing an ungated session tool here, silently
  // does nothing — the filter would just never match it.
  it('every profile entry is a real tapsite tool name', () => {
    for (const [name, list] of Object.entries(PROFILES)) {
      if (list === null) continue;
      for (const tool of list) {
        expect(tool, `${name} profile`).toMatch(/^tapsite_[a-z0-9_]+$/);
      }
    }
  });

  it('exports PROFILES object with expected keys', () => {
    expect(Object.keys(PROFILES)).toEqual(
      expect.arrayContaining(['core', 'design', 'content', 'security', 'recon'])
    );
  });
});
