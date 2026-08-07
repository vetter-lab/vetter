import type { Severity } from "./types.js";

export const SEVERITIES = ["P0", "P1", "P2", "P3"] as const satisfies readonly Severity[];

export const LEGACY_SEVERITY_ALIASES = {
  critical: "P0",
  major: "P1",
  minor: "P3"
} as const satisfies Record<string, Severity>;

export function parseSeverity(value: unknown): Severity | null {
  if (typeof value !== "string") {
    return null;
  }

  if ((SEVERITIES as readonly string[]).includes(value)) {
    return value as Severity;
  }

  return LEGACY_SEVERITY_ALIASES[value as keyof typeof LEGACY_SEVERITY_ALIASES] ?? null;
}
