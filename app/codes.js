// Rules for discount code names, shared by the pages (live checks) and the
// server (checked again on save). Codes are saved in capitals; Shopify
// treats codes as case-insensitive anyway.

export const MAX_CODE_LENGTH = 255;
export const MAX_BULK_CODES = 100;

/** "  ware-priya " → "WARE-PRIYA" */
export function normalizeCode(raw) {
  return String(raw ?? "")
    .trim()
    .toUpperCase();
}

/** Error for a normalized code, or null when it's fine. */
export function codeFormatError(code) {
  if (!code) return "Enter a code";
  if (/\s/.test(code)) return "Codes can't contain spaces";
  if (!/^[A-Z0-9_-]+$/.test(code)) {
    return "Use only letters, numbers, - and _";
  }
  if (code.length > MAX_CODE_LENGTH) {
    return `Keep codes to ${MAX_CODE_LENGTH} characters or fewer`;
  }
  return null;
}

/**
 * Reads bulk-create text: one code per line. Blank lines are skipped,
 * repeats are counted once (ignoring case), and invalid lines are reported
 * with their line number.
 * @returns {{ codes: string[], invalid: {line:number, text:string, error:string}[],
 *   repeats: string[], overLimit: number }}
 */
export function parseBulkCodes(text) {
  const codes = [];
  const seen = new Set();
  const invalid = [];
  const repeats = [];
  String(text ?? "")
    .split("\n")
    .forEach((rawLine, index) => {
      const code = normalizeCode(rawLine);
      if (!code) return;
      const error = codeFormatError(code);
      if (error) {
        invalid.push({ line: index + 1, text: rawLine.trim(), error });
      } else if (seen.has(code)) {
        if (!repeats.includes(code)) repeats.push(code);
      } else {
        seen.add(code);
        codes.push(code);
      }
    });
  const overLimit = Math.max(0, codes.length - MAX_BULK_CODES);
  return { codes: codes.slice(0, MAX_BULK_CODES), invalid, repeats, overLimit };
}
