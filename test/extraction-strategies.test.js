import { describe, it, expect, beforeAll } from 'vitest';

describe('ExtractionStrategies', () => {
  let cssExtract, xpathExtract, regexExtract, buildSchemaSuggestion;

  beforeAll(async () => {
    const mod = await import('../src/extraction-strategies.js');
    cssExtract = mod.cssExtract;
    xpathExtract = mod.xpathExtract;
    regexExtract = mod.regexExtract;
    buildSchemaSuggestion = mod.buildSchemaSuggestion;
  });

  describe('CSS Strategy', () => {
    it('should build extraction function from schema', () => {
      const schema = {
        strategy: 'css',
        baseSelector: '.card',
        fields: {
          title: 'h3',
          price: '.price',
          link: { selector: 'a', attribute: 'href' },
        },
      };
      const fn = cssExtract(schema);
      expect(typeof fn).toBe('function');
    });
  });

  describe('XPath Strategy', () => {
    it('should build extraction function from schema', () => {
      const schema = {
        strategy: 'xpath',
        baseXPath: '//div[@class="card"]',
        fields: { title: './/h3', link: { xpath: './/a', attribute: 'href' } },
      };
      const fn = xpathExtract(schema);
      expect(typeof fn).toBe('function');
    });
  });

  describe('Regex Strategy', () => {
    it('should extract patterns from text', () => {
      const html = 'Prices: $19.99 and $42.50. Contact: test@example.com';
      const schema = {
        strategy: 'regex',
        source: 'html',
        patterns: {
          prices: '\\$[\\d,]+\\.\\d{2}',
          emails: '[\\w.-]+@[\\w.-]+\\.\\w+',
        },
      };
      const result = regexExtract(schema, html);
      expect(result.prices).toEqual(['$19.99', '$42.50']);
      expect(result.emails).toEqual(['test@example.com']);
    });

    it('should return empty arrays for no matches', () => {
      const result = regexExtract({
        strategy: 'regex',
        source: 'html',
        patterns: { phones: '\\d{3}-\\d{4}' },
      }, 'no phones here');
      expect(result.phones).toEqual([]);
    });
  });

  describe('buildSchemaSuggestion', () => {
    it('should return null for empty component data', () => {
      expect(buildSchemaSuggestion(null)).toBeNull();
      expect(buildSchemaSuggestion({ components: [] })).toBeNull();
    });

    it('should generate a schema from component data', () => {
      const componentData = {
        components: [
          {
            selector: '.product-card',
            count: 5,
            children: [
              { tag: 'h3', class: 'title', selector: '.title' },
              { tag: 'span', class: 'price', selector: '.price' },
              { tag: 'a', class: 'link', selector: '.link' },
            ],
          },
        ],
      };
      const schema = buildSchemaSuggestion(componentData);
      expect(schema).not.toBeNull();
      expect(schema.strategy).toBe('css');
      expect(schema.baseSelector).toBe('.product-card');
      expect(schema.fields.title).toBe('.title');
      expect(schema.fields.link).toEqual({ selector: '.link', attribute: 'href' });
      expect(schema.confidence).toBe('high');
    });
  });
});
