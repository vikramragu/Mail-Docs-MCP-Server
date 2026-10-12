/**
 * Google Docs indexes count UTF-16 code units. JavaScript strings are
 * already represented as UTF-16 code units internally, so `.length` gives
 * the right value directly — a surrogate-pair emoji naturally counts as 2.
 * This wrapper exists purely so call sites read as intentional, not
 * accidental use of `.length`.
 */
export function utf16Length(text: string): number {
  return text.length;
}
