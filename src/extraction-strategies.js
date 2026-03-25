'use strict';

/**
 * Flexible extraction strategies — CSS, XPath, Regex.
 * CSS and XPath return functions designed for page.evaluate().
 * Regex runs on the Node.js side against raw HTML or text.
 */

function cssExtract(schema) {
  return function extractInBrowser(schema) {
    const { baseSelector, fields } = schema;
    const items = document.querySelectorAll(baseSelector);
    return [...items].map(item => {
      const result = {};
      for (const [key, selector] of Object.entries(fields)) {
        if (typeof selector === 'string') {
          const el = item.querySelector(selector);
          result[key] = el ? el.textContent.trim() : null;
        } else if (typeof selector === 'object') {
          const el = item.querySelector(selector.selector);
          if (!el) {
            result[key] = null;
          } else if (selector.attribute) {
            result[key] = el.getAttribute(selector.attribute);
          } else {
            result[key] = el.textContent.trim();
          }
        }
      }
      return result;
    });
  };
}

function xpathExtract(schema) {
  return function extractInBrowser(schema) {
    const { baseXPath, fields } = schema;
    const iterator = document.evaluate(baseXPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const results = [];
    for (let i = 0; i < iterator.snapshotLength; i++) {
      const node = iterator.snapshotItem(i);
      const item = {};
      for (const [key, xpath] of Object.entries(fields)) {
        const fieldResult = document.evaluate(
          typeof xpath === 'string' ? xpath : xpath.xpath,
          node, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        );
        const fieldNode = fieldResult.singleNodeValue;
        if (!fieldNode) {
          item[key] = null;
        } else if (typeof xpath === 'object' && xpath.attribute) {
          item[key] = fieldNode.getAttribute(xpath.attribute);
        } else {
          item[key] = fieldNode.textContent.trim();
        }
      }
      results.push(item);
    }
    return results;
  };
}

const MAX_REGEX_PATTERN_LENGTH = 500;
const REGEX_EXEC_TIMEOUT_MS = 5000;

function regexExtract(schema, source) {
  const { patterns } = schema;
  const result = {};
  for (const [key, pattern] of Object.entries(patterns)) {
    if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
      result[key] = { error: `Pattern exceeds max length (${MAX_REGEX_PATTERN_LENGTH} chars)` };
      continue;
    }
    let re;
    try {
      re = new RegExp(pattern, 'g');
    } catch (e) {
      result[key] = { error: `Invalid regex: ${e.message}` };
      continue;
    }
    const matches = [];
    let match;
    const start = Date.now();
    while ((match = re.exec(source)) !== null) {
      matches.push(match[0]);
      if (Date.now() - start > REGEX_EXEC_TIMEOUT_MS) {
        matches.push('...(truncated, regex timeout)');
        break;
      }
    }
    result[key] = matches;
  }
  return result;
}

function buildSchemaSuggestion(componentData) {
  if (!componentData || !componentData.components || componentData.components.length === 0) {
    return null;
  }

  const top = componentData.components.sort((a, b) => b.count - a.count)[0];
  if (!top.selector) return null;

  const fields = {};
  if (top.children) {
    for (const child of top.children) {
      const name = child.class
        ? child.class.split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g, '_')
        : child.tag;
      if (child.tag === 'a') {
        fields[name] = { selector: child.selector || child.tag, attribute: 'href' };
      } else if (child.tag === 'img') {
        fields[name] = { selector: child.selector || child.tag, attribute: 'src' };
      } else {
        fields[name] = child.selector || child.tag;
      }
    }
  }

  return {
    strategy: 'css',
    baseSelector: top.selector,
    fields,
    confidence: top.count >= 5 ? 'high' : top.count >= 3 ? 'medium' : 'low',
    instanceCount: top.count,
  };
}

module.exports = { cssExtract, xpathExtract, regexExtract, buildSchemaSuggestion };
