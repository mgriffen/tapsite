'use strict';

/**
 * BM25 content filter — scores text blocks by relevance to a query,
 * drops blocks below a score threshold.
 *
 * @param {string[]} blocks - Array of text block strings
 * @param {string} query - Search query string
 * @param {object} opts
 * @param {number} opts.threshold - Minimum BM25 score to keep a block (default 0.1)
 * @returns {string[]} Filtered array of relevant blocks
 */
function bm25Filter(blocks, query, opts = {}) {
  const threshold = opts.threshold !== undefined ? opts.threshold : 0.1;

  // If query is empty, return all blocks
  if (!query || query.trim() === '') {
    return blocks.slice();
  }

  const k1 = 1.5;
  const b = 0.75;

  // Tokenize helper: lowercase words longer than 1 char
  function tokenize(text) {
    return (text || '').toLowerCase().match(/\b[a-z0-9]{2,}\b/g) || [];
  }

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) {
    return blocks.slice();
  }

  // Tokenize all blocks
  const tokenizedBlocks = blocks.map(block => tokenize(block));

  const N = blocks.length;

  // Compute average block length
  const totalLen = tokenizedBlocks.reduce((sum, toks) => sum + toks.length, 0);
  const avgLen = N > 0 ? totalLen / N : 1;

  // Compute document frequency for each query term
  const df = {};
  for (const term of queryTerms) {
    if (df[term] !== undefined) continue;
    let count = 0;
    for (const toks of tokenizedBlocks) {
      if (toks.includes(term)) count++;
    }
    df[term] = count;
  }

  // Score each block
  const scored = blocks.map((block, i) => {
    const toks = tokenizedBlocks[i];
    const len = toks.length;

    // Build term frequency map for this block
    const tf = {};
    for (const tok of toks) {
      tf[tok] = (tf[tok] || 0) + 1;
    }

    let score = 0;
    for (const term of queryTerms) {
      const termTf = tf[term] || 0;
      if (termTf === 0) continue;

      const termDf = df[term] || 0;
      // IDF with smoothing to avoid division by zero or negative values
      const idf = Math.log((N - termDf + 0.5) / (termDf + 0.5) + 1);

      const numerator = termTf * (k1 + 1);
      const denominator = termTf + k1 * (1 - b + b * (len / (avgLen || 1)));
      score += idf * (numerator / denominator);
    }

    return { block, score };
  });

  return scored.filter(s => s.score >= threshold).map(s => s.block);
}

/**
 * Pruning filter — removes noise blocks based on text length and link density.
 *
 * @param {Array<{text: string, linkDensity: number}>} blocks - Array of block objects
 * @param {object} opts
 * @param {number} opts.minLength - Minimum text length to keep a block (default 10)
 * @param {number} opts.maxLinkDensity - Maximum link density to keep a block (default 0.5)
 * @returns {Array<{text: string, linkDensity: number}>} Filtered array
 */
function pruningFilter(blocks, opts = {}) {
  const minLength = opts.minLength !== undefined ? opts.minLength : 10;
  const maxLinkDensity = opts.maxLinkDensity !== undefined ? opts.maxLinkDensity : 0.5;

  return blocks.filter(block => {
    const textLen = (block.text || '').length;
    if (textLen < minLength) return false;
    if (block.linkDensity > maxLinkDensity) return false;
    return true;
  });
}

module.exports = { bm25Filter, pruningFilter };
