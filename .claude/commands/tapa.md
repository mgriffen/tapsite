Run a comprehensive audit on a URL covering accessibility, performance, and security-relevant findings.

Steps:
1. Use `tapsite_navigate` to go to the URL (skip if already on the page)
2. Run these in sequence:
   - `tapsite_extract_a11y` with standard "aa"
   - `tapsite_extract_perf`
   - `tapsite_extract_forms` (check for missing CSRF, insecure actions)
   - `tapsite_extract_metadata` (check for missing SEO tags)
3. Provide a consolidated audit report with scores, top issues, and recommendations

URL: $ARGUMENTS
