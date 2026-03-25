import { describe, it, expect } from 'vitest';
import { getProfileFilter, PROFILES } from '../src/profiles.js';

describe('profile system', () => {
  it('returns allow-all when no --profile flag', () => {
    const allow = getProfileFilter(['node', 'server.js']);
    expect(allow('tapsite_extract_colors')).toBe(true);
    expect(allow('tapsite_capture_network')).toBe(true);
    expect(allow('anything')).toBe(true);
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

  it('core profile allows nothing beyond session tools', () => {
    const allow = getProfileFilter(['node', 'server.js', '--profile', 'core']);
    expect(allow('tapsite_extract_colors')).toBe(false);
    expect(allow('tapsite_capture_network')).toBe(false);
    expect(allow('tapsite_audit')).toBe(false);
  });

  it('exports PROFILES object with expected keys', () => {
    expect(Object.keys(PROFILES)).toEqual(
      expect.arrayContaining(['core', 'design', 'content', 'security', 'recon'])
    );
  });
});
