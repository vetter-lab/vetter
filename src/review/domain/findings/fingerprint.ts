import { createHash } from "node:crypto";
import { normalize } from "./text.js";
import type { ExistingFinding, Finding, FindingDraft } from "../types.js";

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
 * Providers can report the same logical finding more than once. Keep the
 * first normalized finding for a fingerprint so one review run cannot create
 * duplicate inline comments or summary rows.
 */
export function deduplicateFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    if (seen.has(finding.fingerprint)) {
      return false;
    }
    seen.add(finding.fingerprint);
    return true;
  });
}

/**
 * Matches a normalized finding against existing findings for the same PR.
 * Prefers the first exact fingerprint match. If none exists, falls back to
 * matching by rule + path, but only when that fallback is unambiguous:
 * if more than one existing finding shares the same rule and path, there is
 * no reliable way to tell which one the new finding corresponds to, so the
 * match is rejected. Exact duplicate persisted comments are the same logical
 * finding, so the first one is used as the canonical comment.
 */
export function matchExistingFinding(
  finding: Finding,
  existing: ExistingFinding[],
  fallbackFingerprints?: Set<string>
): ExistingFinding | null {
  const exactMatch = existing.find((candidate) => candidate.fingerprint === finding.fingerprint);
  if (exactMatch) {
    return exactMatch;
  }

  const fallbackMatches = existing.filter(
    (candidate) =>
      candidate.ruleId === finding.ruleId &&
      candidate.path === finding.path &&
      (fallbackFingerprints === undefined || fallbackFingerprints.has(candidate.fingerprint))
  );
  if (fallbackMatches.length === 1) {
    return fallbackMatches[0] ?? null;
  }

  return null;
}
