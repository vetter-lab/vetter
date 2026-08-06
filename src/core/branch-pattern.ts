function globToRegExp(pattern: string): RegExp {
  let result = "";
  let i = 0;

  while (i < pattern.length) {
    if (pattern.startsWith("**", i)) {
      result += ".*";
      i += 2;
      continue;
    }

    const char = pattern[i];
    if (char === "*") {
      result += "[^/]*";
    } else if (char === "?") {
      result += "[^/]";
    } else {
      result += (char ?? "").replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    i += 1;
  }

  return new RegExp(`^${result}$`);
}

/**
 * Matches a branch name against configured `branchPatterns` glob strings.
 * `**` matches across path segments, `*` matches within one segment; used
 * to gate which pushed branches trigger a review (design doc section 4).
 */
export function matchesAnyBranchPattern(branch: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(branch));
}
