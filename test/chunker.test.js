import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { chunkMarkdown } = require('../src/chunker.js');

describe('chunkMarkdown', () => {
  // 1. Return single chunk when content is small (fixed mode)
  it('returns a single chunk when content is smaller than chunkSize', () => {
    const text = 'This is a short piece of text with only a few words.';
    const chunks = chunkMarkdown(text, { strategy: 'fixed', chunkSize: 750 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  // 2. Split by word count with overlap (verify overlap words match)
  it('splits by word count with overlap and overlapping words match', () => {
    // Build text with 200 words
    const words = Array.from({ length: 200 }, (_, i) => `word${i}`);
    const text = words.join(' ');

    const chunkSize = 100;
    const overlap = 20;
    const chunks = chunkMarkdown(text, { strategy: 'fixed', chunkSize, overlap });

    // Should produce more than one chunk
    expect(chunks.length).toBeGreaterThan(1);

    // Verify overlap: last `overlap` words of chunk[0] === first `overlap` words of chunk[1]
    const chunk0Words = chunks[0].split(' ');
    const chunk1Words = chunks[1].split(' ');

    const tailOfChunk0 = chunk0Words.slice(-overlap);
    const headOfChunk1 = chunk1Words.slice(0, overlap);

    expect(tailOfChunk0).toEqual(headOfChunk1);
  });

  // 3. Split on heading boundaries (semantic mode, verify each chunk starts with heading)
  it('splits on heading boundaries in semantic mode', () => {
    const text = [
      '# Introduction',
      'Some intro text here.',
      '',
      '## Section One',
      'Content for section one.',
      '',
      '### Subsection',
      'Subsection content.',
      '',
      '## Section Two',
      'Content for section two.',
    ].join('\n');

    const chunks = chunkMarkdown(text, { strategy: 'semantic' });

    expect(chunks.length).toBeGreaterThan(1);

    // Every chunk (except possibly the first if it has no heading before it)
    // should start with a heading — in this case the very first line is a heading
    for (const chunk of chunks) {
      expect(chunk.trimStart()).toMatch(/^#{1,6}\s/);
    }
  });

  // 4. Split by sentences (sentence mode)
  it('splits by sentence count in sentence mode', () => {
    const sentences = [
      'The quick brown fox jumps over the lazy dog.',
      'Pack my box with five dozen liquor jugs.',
      'How vexingly quick daft zebras jump.',
      'The five boxing wizards jump quickly.',
      'Sphinx of black quartz, judge my vow.',
      'Two driven jocks help fax my big quiz.',
      'Five quacking zephyrs jolt my wax bed.',
      'The jay, pig, fox, zebra and my wolves quack.',
      'Blowzy red vixens fight for a quick jump.',
      'Joaquin Phoenix was gazed by the proud wolf.',
    ];
    const text = sentences.join(' ');

    const chunks = chunkMarkdown(text, { strategy: 'sentence', chunkSize: 3 });

    // 10 sentences / 3 per chunk = 4 chunks (3+3+3+1)
    expect(chunks.length).toBe(4);

    // Each chunk (except the last) should contain 3 sentences
    const firstChunkSentences = chunks[0].split(/(?<=[.!?])\s+/).filter(s => s.trim());
    expect(firstChunkSentences.length).toBe(3);
  });

  // 5. Handle empty input
  it('handles empty input gracefully', () => {
    expect(chunkMarkdown('')).toEqual(['']);
    expect(chunkMarkdown('   ')).toEqual(['']);
    expect(chunkMarkdown(null)).toEqual(['']);
    expect(chunkMarkdown(undefined)).toEqual(['']);
  });

  // 6. Handle text with no headings in semantic mode (returns single chunk)
  it('returns a single chunk when no headings found in semantic mode', () => {
    const text = 'This is a paragraph without any headings.\n\nAnother paragraph here.';
    const chunks = chunkMarkdown(text, { strategy: 'semantic' });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });
});
