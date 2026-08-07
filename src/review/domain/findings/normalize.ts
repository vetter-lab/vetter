import { SEVERITIES } from "../severity.js";
import type { Finding, FindingDraft, Severity } from "../types.js";
import { computeFingerprint } from "./fingerprint.js";

const VALID_SEVERITIES: readonly Severity[] = SEVERITIES;

/**
 * Normalizes a raw finding draft into a stable `Finding`: trims free text,
 * validates the severity enum, derives `scopeKey`, and attaches the
 * fingerprint computed from the normalized fields.
 */
export function normalizeFinding(draft: FindingDraft): Finding {
  if (!VALID_SEVERITIES.includes(draft.severity)) {
    throw new Error(`invalid severity: ${String(draft.severity)}`);
  }

  const normalized: FindingDraft = {
    ...draft,
    title: draft.title.trim(),
    body: draft.body.trim(),
    scopeKey: `${draft.source}:${draft.ruleId}:${draft.path}`
  };

  return {
    ...normalized,
    fingerprint: computeFingerprint(normalized)
  };
}
