const MAX_TITLE_WORDS = 10;
const MAX_TITLE_LENGTH = 96;
const ELLIPSIS = "...";

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
