import { LEGACY_SEVERITY_ALIASES } from "../core/severity.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function migrateSeverityConfigLayer(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.severity)) {
    return value;
  }

  const severity = { ...value.severity };
  for (const [legacy, canonical] of Object.entries(LEGACY_SEVERITY_ALIASES)) {
    if (severity[canonical] === undefined && severity[legacy] !== undefined) {
      severity[canonical] = severity[legacy];
    }
    delete severity[legacy];
  }

  return { ...value, severity };
}
