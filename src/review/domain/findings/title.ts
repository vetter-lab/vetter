import type { Severity } from "../types.js";

const MAX_TITLE_WORDS = 10;
const MAX_TITLE_LENGTH = 96;
const ELLIPSIS = "...";

const SEVERITY_COLORS: Record<Severity, string> = {
  P0: "#cf222e",
  P1: "#bc4c00",
  P2: "#9a6700",
  P3: "#6e7781"
};

/**
 * Keeps user-visible finding titles useful in compact comment tables while
 * leaving the original title available for the hidden finding marker.
 */
export function shortenFindingTitle(title: string): string {
  const normalized = title.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) {
    return "Finding";
  }

  const words = normalized.split(" ");
  if (words.length <= MAX_TITLE_WORDS && normalized.length <= MAX_TITLE_LENGTH) {
    return normalized;
  }

  const maxPrefixLength = MAX_TITLE_LENGTH - ELLIPSIS.length;
  let prefix = "";
  for (const word of words.slice(0, MAX_TITLE_WORDS - 1)) {
    const candidate = prefix.length === 0 ? word : `${prefix} ${word}`;
    if (candidate.length > maxPrefixLength) {
      break;
    }
    prefix = candidate;
  }

  if (prefix.length === 0) {
    prefix = normalized.slice(0, maxPrefixLength).trimEnd();
  }

  return `${prefix}${ELLIPSIS}`;
}

/** Renders the visible inline comment heading with a severity-specific color. */
export function renderFindingTitle(severity: Severity, title: string): string {
  return `**[<font color="${SEVERITY_COLORS[severity]}">${severity}</font>] ${shortenFindingTitle(title)}**`;
}
