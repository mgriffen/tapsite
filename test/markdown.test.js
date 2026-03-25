import { describe, it, expect, beforeAll } from 'vitest';
import { generateMarkdown } from '../src/markdown.js';

describe('generateMarkdown — raw mode', () => {
  it('converts headings', () => {
    const html = '<h1>Title</h1><h2>Subtitle</h2><h3>Section</h3>';
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('# Title');
    expect(md).toContain('## Subtitle');
    expect(md).toContain('### Section');
  });

  it('converts bold and italic', () => {
    const html = '<p>This is <strong>bold</strong> and <em>italic</em> text.</p>';
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('**bold**');
    expect(md).toContain('_italic_');
  });

  it('converts links', () => {
    const html = '<p>Visit <a href="https://example.com">Example</a> for more.</p>';
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('[Example](https://example.com)');
  });

  it('converts unordered lists', () => {
    const html = '<ul><li>Apple</li><li>Banana</li><li>Cherry</li></ul>';
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('- Apple');
    expect(md).toContain('- Banana');
    expect(md).toContain('- Cherry');
  });

  it('converts ordered lists', () => {
    const html = '<ol><li>First</li><li>Second</li><li>Third</li></ol>';
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('1. First');
    expect(md).toContain('2. Second');
    expect(md).toContain('3. Third');
  });

  it('converts images', () => {
    const html = '<img src="photo.jpg" alt="A photo" />';
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('![A photo](photo.jpg)');
  });

  it('preserves nav and footer in raw mode', () => {
    const html = '<nav>Navigation</nav><main>Content</main><footer>Footer</footer>';
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('Navigation');
    expect(md).toContain('Content');
    expect(md).toContain('Footer');
  });
});

describe('generateMarkdown — fit mode (default)', () => {
  it('strips nav elements', () => {
    const html = '<nav><a href="/">Home</a></nav><main><p>Main content here.</p></main>';
    const md = generateMarkdown(html, { mode: 'fit' });
    expect(md).not.toContain('Home');
    expect(md).toContain('Main content here');
  });

  it('strips footer elements', () => {
    const html = '<article><p>Article text.</p></article><footer><p>Copyright 2024</p></footer>';
    const md = generateMarkdown(html, { mode: 'fit' });
    expect(md).toContain('Article text');
    expect(md).not.toContain('Copyright 2024');
  });

  it('strips aside elements', () => {
    const html = '<main><p>Body content.</p></main><aside><p>Sidebar content.</p></aside>';
    const md = generateMarkdown(html, { mode: 'fit' });
    expect(md).toContain('Body content');
    expect(md).not.toContain('Sidebar content');
  });

  it('strips header elements', () => {
    const html = '<header><h1>Site Header</h1></header><main><h2>Page Title</h2><p>Text.</p></main>';
    const md = generateMarkdown(html, { mode: 'fit' });
    expect(md).not.toContain('Site Header');
    expect(md).toContain('Page Title');
  });

  it('fit mode is the default when no mode is specified', () => {
    const html = '<nav>Navigation</nav><main><p>Content.</p></main>';
    const md = generateMarkdown(html);
    expect(md).not.toContain('Navigation');
    expect(md).toContain('Content');
  });
});

describe('generateMarkdown — citations mode', () => {
  it('replaces links with numbered references', () => {
    const html = '<p>Visit <a href="https://example.com">Example</a> and <a href="https://google.com">Google</a>.</p>';
    const md = generateMarkdown(html, { mode: 'citations' });
    expect(md).toContain('Example[1]');
    expect(md).toContain('Google[2]');
  });

  it('appends a references section', () => {
    const html = '<p>See <a href="https://example.com">here</a>.</p>';
    const md = generateMarkdown(html, { mode: 'citations' });
    expect(md).toContain('---');
    expect(md).toContain('**References**');
    expect(md).toContain('[1]: https://example.com');
  });

  it('references include the link text', () => {
    const html = '<p><a href="https://example.com">Example Site</a></p>';
    const md = generateMarkdown(html, { mode: 'citations' });
    expect(md).toContain('"Example Site"');
  });

  it('multiple links get sequential numbers', () => {
    const html = '<ul><li><a href="https://a.com">A</a></li><li><a href="https://b.com">B</a></li><li><a href="https://c.com">C</a></li></ul>';
    const md = generateMarkdown(html, { mode: 'citations' });
    expect(md).toContain('A[1]');
    expect(md).toContain('B[2]');
    expect(md).toContain('C[3]');
    expect(md).toContain('[1]: https://a.com');
    expect(md).toContain('[2]: https://b.com');
    expect(md).toContain('[3]: https://c.com');
  });

  it('does not add references section when there are no links', () => {
    const html = '<p>No links here.</p>';
    const md = generateMarkdown(html, { mode: 'citations' });
    expect(md).not.toContain('**References**');
  });
});

describe('generateMarkdown — tables', () => {
  it('converts table with header row to pipe format', () => {
    const html = `
      <table>
        <thead>
          <tr><th>Name</th><th>Age</th><th>City</th></tr>
        </thead>
        <tbody>
          <tr><td>Alice</td><td>30</td><td>NYC</td></tr>
          <tr><td>Bob</td><td>25</td><td>LA</td></tr>
        </tbody>
      </table>
    `;
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('| Name | Age | City |');
    expect(md).toContain('| --- | --- | --- |');
    expect(md).toContain('| Alice | 30 | NYC |');
    expect(md).toContain('| Bob | 25 | LA |');
  });

  it('handles table without thead (no separator)', () => {
    const html = `
      <table>
        <tr><td>Alpha</td><td>Beta</td></tr>
        <tr><td>Gamma</td><td>Delta</td></tr>
      </table>
    `;
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('| Alpha | Beta |');
    expect(md).toContain('| Gamma | Delta |');
    // No separator since no thead
    expect(md).not.toContain('| --- |');
  });
});

describe('generateMarkdown — code blocks', () => {
  it('wraps inline code in backticks', () => {
    const html = '<p>Use the <code>npm install</code> command.</p>';
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('`npm install`');
  });

  it('wraps pre blocks in triple backticks', () => {
    const html = '<pre>function hello() {\n  console.log("hi");\n}</pre>';
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('```');
    expect(md).toContain('function hello()');
  });

  it('handles pre > code combination', () => {
    const html = '<pre><code>const x = 1;\nconst y = 2;</code></pre>';
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('```');
    expect(md).toContain('const x = 1;');
  });
});

describe('generateMarkdown — edge cases', () => {
  it('returns empty string for empty input', () => {
    expect(generateMarkdown('')).toBe('');
  });

  it('returns empty string for null input', () => {
    expect(generateMarkdown(null)).toBe('');
  });

  it('returns empty string for undefined input', () => {
    expect(generateMarkdown(undefined)).toBe('');
  });

  it('handles HTML with no meaningful content', () => {
    const html = '<div><span></span></div>';
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toBe('');
  });

  it('strips script tags and their content', () => {
    const html = '<p>Visible text.</p><script>alert("xss")</script>';
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('Visible text');
    expect(md).not.toContain('alert');
  });

  it('strips style tags and their content', () => {
    const html = '<style>body { color: red; }</style><p>Styled content.</p>';
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('Styled content');
    expect(md).not.toContain('color: red');
  });

  it('decodes HTML entities', () => {
    const html = '<p>Price: &amp;100 &lt;discount&gt;</p>';
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('Price: &100 <discount>');
  });

  it('does not produce excessive blank lines', () => {
    const html = '<p>One</p><p>Two</p><p>Three</p>';
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).not.toMatch(/\n{3,}/);
  });
});

describe('generateMarkdown — nested elements', () => {
  it('handles bold inside a link (raw mode)', () => {
    const html = '<a href="https://example.com"><strong>Bold Link</strong></a>';
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('[');
    expect(md).toContain('](https://example.com)');
    expect(md).toContain('Bold Link');
  });

  it('handles nested lists', () => {
    const html = `
      <ul>
        <li>Top level
          <ul>
            <li>Nested item</li>
          </ul>
        </li>
        <li>Another top</li>
      </ul>
    `;
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('- Top level');
    expect(md).toContain('  - Nested item');
    expect(md).toContain('- Another top');
  });

  it('handles em inside strong', () => {
    const html = '<p><strong>Bold <em>and italic</em></strong></p>';
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('**');
    expect(md).toContain('_');
    expect(md).toContain('Bold');
    expect(md).toContain('and italic');
  });

  it('handles link inside list item', () => {
    const html = '<ul><li><a href="https://example.com">Click here</a></li></ul>';
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('- ');
    expect(md).toContain('[Click here](https://example.com)');
  });

  it('handles heading with link in citations mode', () => {
    const html = '<h2>See <a href="https://docs.example.com">the docs</a> for details</h2>';
    const md = generateMarkdown(html, { mode: 'citations' });
    expect(md).toContain('## ');
    expect(md).toContain('the docs[1]');
    expect(md).toContain('[1]: https://docs.example.com');
  });

  it('should handle blockquotes', () => {
    const html = '<blockquote><p>This is a quote.</p></blockquote>';
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('> ');
    expect(md).toContain('This is a quote.');
  });

  it('should handle multi-paragraph blockquotes', () => {
    const html = '<blockquote><p>First paragraph.</p><p>Second paragraph.</p></blockquote>';
    const md = generateMarkdown(html, { mode: 'raw' });
    expect(md).toContain('> ');
    expect(md).toContain('First paragraph.');
    expect(md).toContain('Second paragraph.');
  });
});
