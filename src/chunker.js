'use strict';

/**
 * Splits Markdown text into LLM-sized chunks using one of three strategies:
 *   - 'fixed'    : split by word count with overlap
 *   - 'semantic' : split on heading boundaries (h1-h6)
 *   - 'sentence' : split by sentence count
 *
 * @param {string} text  - Markdown content to chunk
 * @param {object} opts
 * @param {'fixed'|'semantic'|'sentence'} [opts.strategy='fixed']
 * @param {number} [opts.chunkSize]  - words (fixed, default 750) or sentences (sentence, default 5)
 * @param {number} [opts.overlap=75] - word overlap for fixed mode
 * @returns {string[]} array of chunk strings
 */
function chunkMarkdown(text, opts = {}) {
  if (!text || text.trim() === '') return [''];

  const strategy = opts.strategy || 'fixed';

  switch (strategy) {
    case 'semantic':
      return chunkSemantic(text);
    case 'sentence':
      return chunkSentence(text, opts.chunkSize || 5);
    case 'fixed':
    default:
      return chunkFixed(text, opts.chunkSize || 750, opts.overlap !== undefined ? opts.overlap : 75);
  }
}

/**
 * Fixed-size chunking by word count with overlap.
 */
function chunkFixed(text, chunkSize, overlap) {
  const words = text.split(/\s+/).filter(w => w.length > 0);

  if (words.length <= chunkSize) {
    return [text];
  }

  // Build word boundary offsets from the original text
  const offsets = []; // { start, end } for each word
  const wordRe = /\S+/g;
  let m;
  while ((m = wordRe.exec(text)) !== null) {
    offsets.push({ start: m.index, end: m.index + m[0].length });
  }

  const chunks = [];
  let startIdx = 0;

  while (startIdx < offsets.length) {
    const endIdx = Math.min(startIdx + chunkSize, offsets.length);
    // Slice from start of first word to end of last word
    const chunkStart = offsets[startIdx].start;
    const chunkEnd = offsets[endIdx - 1].end;
    chunks.push(text.slice(chunkStart, chunkEnd));

    if (endIdx === offsets.length) break;

    const advance = chunkSize - overlap;
    startIdx += advance > 0 ? advance : 1;
  }

  return chunks;
}

/**
 * Semantic chunking on heading boundaries (h1-h6).
 */
function chunkSemantic(text) {
  const lines = text.split('\n');
  const headingPattern = /^#{1,6}\s/;

  const chunks = [];
  let current = [];

  for (const line of lines) {
    if (headingPattern.test(line) && current.length > 0) {
      chunks.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }

  if (current.length > 0) {
    chunks.push(current.join('\n'));
  }

  // If no headings were found, the entire text is one chunk
  return chunks.length > 0 ? chunks : [text];
}

/**
 * Sentence chunking — splits on sentence boundaries, groups N sentences per chunk.
 */
function chunkSentence(text, sentencesPerChunk) {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);

  if (sentences.length === 0) return [text];

  const chunks = [];
  for (let i = 0; i < sentences.length; i += sentencesPerChunk) {
    chunks.push(sentences.slice(i, i + sentencesPerChunk).join(' '));
  }

  return chunks;
}

module.exports = { chunkMarkdown };
