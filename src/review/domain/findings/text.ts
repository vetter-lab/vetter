/**
 * Normalizes text for identity comparisons: collapses CRLF/CR to LF,
 * trims each line and collapses repeated horizontal whitespace within it,
 * then trims the overall result. This keeps fingerprints stable across
 * incidental formatting differences (line-ending changes, re-indentation,
 * trailing whitespace) without masking substantive content changes.
 */
export function normalize(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
    .join("\n")
    .trim();
}
