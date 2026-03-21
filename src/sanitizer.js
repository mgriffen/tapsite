/**
 * Prompt injection sanitizer — scans text returned to the LLM for patterns
 * that attempt to override instructions. Flags suspicious content inline
 * so the LLM and user can see it was detected, without silently dropping data.
 */
const INJECTION_PATTERNS = [
  // Direct instruction overrides
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|context)/i,
  /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|context)/i,
  /forget\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|context)/i,
  // System prompt leaking
  /reveal\s+(your\s+)?(system\s+prompt|instructions|hidden|secret)/i,
  /show\s+(me\s+)?(your\s+)?(system\s+prompt|instructions|hidden|secret)/i,
  /what\s+(are|is)\s+your\s+(system\s+prompt|instructions|rules)/i,
  // Role hijacking
  /you\s+are\s+now\s+a/i,
  /act\s+as\s+(a\s+|an\s+)?different/i,
  /new\s+instructions?\s*:/i,
  /\bsystem\s*:\s/i,
  // Exfiltration attempts
  /write\s+(the\s+)?(contents?|data|text)\s+(of|from)\s+.*(\.ssh|\.env|credentials|secrets|tokens|password)/i,
  /read\s+(the\s+)?(file|contents?)\s+.*(\.ssh|\.env|credentials|secrets|password)/i,
  /send\s+(to|this|data)\s+(https?:\/\/|http)/i,
  /curl\s+.*https?:\/\//i,
  /fetch\s*\(\s*['"]https?:\/\//i,
  // Tool manipulation
  /run\s+(this\s+)?(command|script|code)\s*:/i,
  /execute\s+(this\s+)?(command|script|code)\s*:/i,
  /\bIMPORTANT\s*:/i,
  /\bCRITICAL\s*:/i,
  /\bURGENT\s*:/i,
];

function sanitizeForLLM(text) {
  if (typeof text !== 'string') return text;
  let flagged = false;
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      flagged = true;
      // Replace the match with a flagged version so it's visible but neutered
      text = text.replace(pattern, (match) => `[INJECTION_DETECTED: ${match}]`);
    }
  }
  if (flagged) {
    text = `⚠ PROMPT INJECTION DETECTED — the following web content contained text that may attempt to manipulate LLM behavior. Suspicious patterns have been flagged.\n\n${text}`;
  }
  return text;
}

module.exports = { sanitizeForLLM, INJECTION_PATTERNS };
