const PROFILES = {
  core: [],
  design: [
    'tapsite_extract_colors', 'tapsite_extract_fonts', 'tapsite_extract_css_vars',
    'tapsite_extract_spacing', 'tapsite_extract_shadows', 'tapsite_extract_icons',
    'tapsite_extract_svgs', 'tapsite_extract_images', 'tapsite_extract_components',
    'tapsite_extract_breakpoints', 'tapsite_extract_darkmode', 'tapsite_extract_layout',
    'tapsite_extract_animations', 'tapsite_extract_web_components',
    'tapsite_designsystem', 'tapsite_export_design_report',
    'tapsite_export', 'tapsite_diff_pages',
  ],
  content: [
    'tapsite_extract_metadata', 'tapsite_extract_content', 'tapsite_extract_links',
    'tapsite_extract_forms', 'tapsite_extract_a11y', 'tapsite_extract_images',
    'tapsite_extract_favicon', 'tapsite_extract_table', 'tapsite_extract_perf',
    'tapsite_extract_i18n', 'tapsite_extract_pwa',
    'tapsite_crawl', 'tapsite_harvest',
    'tapsite_export', 'tapsite_diff_pages',
  ],
  security: [
    'tapsite_extract_third_party', 'tapsite_extract_storage', 'tapsite_extract_security',
    'tapsite_extract_contrast', 'tapsite_extract_perf',
    'tapsite_capture_network', 'tapsite_extract_api_schema',
    'tapsite_extract_stack', 'tapsite_audit',
    'tapsite_export', 'tapsite_diff_pages',
  ],
  recon: null,
};

function getProfileFilter(argv) {
  const idx = argv.indexOf('--profile');
  const value = idx !== -1 && argv[idx + 1] ? argv[idx + 1] : 'recon';

  if (value === 'recon') return () => true;

  const names = value.split(',').map(s => s.trim());
  const allowed = new Set();

  for (const name of names) {
    const profile = PROFILES[name];
    if (profile === undefined) {
      console.error(`[tapsite] Unknown profile "${name}", falling back to recon`);
      return () => true;
    }
    if (profile === null) return () => true;
    for (const tool of profile) allowed.add(tool);
  }

  return (toolName) => allowed.has(toolName);
}

module.exports = { PROFILES, getProfileFilter };
