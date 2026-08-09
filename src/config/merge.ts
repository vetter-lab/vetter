function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merges plain objects left to right: later sources win. Arrays and
 * other non-object values are replaced wholesale rather than concatenated,
 * so a repository or external override can fully redefine a list such as
 * `branchPatterns`.
 */
export function deepMerge(...sources: unknown[]): unknown {
  return sources.reduce((accumulator, source) => mergeTwo(accumulator, source), {} as unknown);
}

function mergeTwo(base: unknown, override: unknown): unknown {
  if (override === undefined) {
    return base;
  }

  if (isPlainObject(base) && isPlainObject(override)) {
    const result: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) {
      result[key] = mergeTwo(base[key], value);
    }
    return result;
  }

  return override;
}
