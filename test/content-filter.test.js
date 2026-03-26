import { describe, it, expect } from 'vitest';
import { bm25Filter, pruningFilter } from '../src/content-filter.js';

describe('bm25Filter', () => {
  it('filters blocks by relevance to query', () => {
    const blocks = [
      'The quick brown fox jumps over the lazy dog',
      'JavaScript is a programming language used for web development',
      'Bananas are yellow and monkeys like them',
    ];
    const query = 'JavaScript programming web';
    const result = bm25Filter(blocks, query);
    expect(result).toContain(blocks[1]);
    expect(result).not.toContain(blocks[2]);
  });

  it('returns all blocks when query is empty', () => {
    const blocks = ['Hello world', 'Foo bar baz', 'Another block here'];
    const result = bm25Filter(blocks, '');
    expect(result).toEqual(blocks);
  });

  it('returns empty array when no blocks match', () => {
    const blocks = [
      'The sky is blue today',
      'Cats and dogs are common pets',
    ];
    const query = 'quantum cryptography blockchain';
    // Use a high threshold to force no matches
    const result = bm25Filter(blocks, query, { threshold: 100 });
    expect(result).toEqual([]);
  });
});

describe('pruningFilter', () => {
  it('removes short blocks', () => {
    const blocks = [
      { text: 'Hi', linkDensity: 0 },
      { text: 'This is a longer block of text that should pass.', linkDensity: 0 },
    ];
    const result = pruningFilter(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('This is a longer block of text that should pass.');
  });

  it('removes high link-density blocks', () => {
    const blocks = [
      { text: 'Click here for more information about our services.', linkDensity: 0.9 },
      { text: 'This paragraph contains useful content with few links.', linkDensity: 0.1 },
    ];
    const result = pruningFilter(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('This paragraph contains useful content with few links.');
  });

  it('keeps blocks that pass both criteria', () => {
    const blocks = [
      { text: 'Short', linkDensity: 0 },                                              // fails minLength
      { text: 'Navigation menu with links everywhere', linkDensity: 0.8 },            // fails linkDensity
      { text: 'This is a quality block with relevant content.', linkDensity: 0.2 },  // passes both
    ];
    const result = pruningFilter(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('This is a quality block with relevant content.');
  });
});
