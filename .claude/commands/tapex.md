Run a full extraction suite on a URL. Extract colors, fonts, metadata, content, forms, components, accessibility, and tech stack — all in one pass.

Steps:
1. Use `tapsite_navigate` to go to the URL (skip if already on the page)
2. Run these extractions in sequence:
   - `tapsite_extract_colors`
   - `tapsite_extract_fonts`
   - `tapsite_extract_metadata`
   - `tapsite_extract_content`
   - `tapsite_extract_forms`
   - `tapsite_extract_components`
   - `tapsite_extract_a11y`
   - `tapsite_detect_stack`
3. Provide a consolidated summary of all findings

URL: $ARGUMENTS
