Crawl a site starting from the given URL. Uses BFS with same-domain filtering, extracting content and metadata from each page.

Use `tapsite_crawl` with:
- The provided URL as the start
- `maxPages`: 10 (unless specified)
- `maxDepth`: 2 (unless specified)
- `extract`: ["content", "metadata", "links"]
- `sameDomain`: true

After the crawl, summarize what was found across all pages.

URL: $ARGUMENTS
