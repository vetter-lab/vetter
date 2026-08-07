import { createHash } from "node:crypto";
import { normalize } from "./normalize.js";
import { SEVERITIES } from "./severity.js";
import type { ExistingFinding, Finding, FindingDraft, Severity } from "./types.js";

const VALID_SEVERITIES: readonly Severity[] = SEVERITIES;

/**
 * Versioned identity fingerprint for a finding. Deliberately excludes the
 * line number so that unrelated line shifts elsewhere in the file don't
 * change a finding's identity, while a change to the rule, file, normalized
 * code anchor, or normalized title is treated as a new finding.
 */
export function computeFingerprint(
  draft: Pick<FindingDraft, "ruleId" | "path" | "codeAnchor" | "title">
): string {
  return createHash("sha256")
    .update([draft.ruleId, draft.path, normalize(draft.codeAnchor), normalize(draft.title)].join("\n"))
    .digest("hex");
}

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

/**
 * Matches a normalized finding against existing findings for the same PR.
 * Prefers an exact fingerprint match. If none exists, falls back to
 * matching by rule + path, but only when that fallback is unambiguous:
 * if more than one existing finding shares the same rule and path (and
 * none has the exact fingerprint), there is no reliable way to tell which
 * one the new finding corresponds to, so the match is rejected.
 */
export function matchExistingFinding(finding: Finding, existing: ExistingFinding[]): ExistingFinding | null {
  const exactMatches = existing.filter((candidate) => candidate.fingerprint === finding.fingerprint);
  if (exactMatches.length === 1) {
    return exactMatches[0] ?? null;
  }
  if (exactMatches.length > 1) {
    return null;
  }

  const fallbackMatches = existing.filter(
    (candidate) => candidate.ruleId === finding.ruleId && candidate.path === finding.path
  );
  if (fallbackMatches.length === 1) {
    return fallbackMatches[0] ?? null;
  }

  return null;
}
