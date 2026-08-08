import type { ReviewStateSnapshot } from "../../integrations/github/types.js";
import { parseFindingMarker } from "../domain/reconciliation/markers.js";
import { wasResolvedByBot } from "../domain/reconciliation/reconcile.js";
import type { ExistingFinding, FindingState } from "../domain/types.js";

/**
 * Reconstructs existing findings from GitHub comments and review threads.
 * GitHub comments are the persisted state, so every finding field comes from
 * the hidden marker and the surrounding thread state.
 */
export function toExistingFindings(snapshot: ReviewStateSnapshot, botLogins: Set<string>): ExistingFinding[] {
  const findingsByFingerprint = new Map<string, ExistingFinding>();

  for (const thread of snapshot.reviewThreads) {
    for (const comment of thread.comments) {
      const marker = parseFindingMarker(comment.body);
      if (!marker) {
        continue;
      }

      const lastAction: ExistingFinding["lastAction"] = marker.botResolved ? "bot-resolved" : "updated";
      const resolvedByBot = wasResolvedByBot({ resolvedByLogin: thread.resolvedByLogin, lastAction }, botLogins);
      const state: FindingState = !thread.isResolved ? "open" : resolvedByBot ? "fixed" : "suppressed";

      const finding: ExistingFinding = {
        fingerprint: marker.fingerprint,
        ruleId: marker.ruleId,
        source: marker.source,
        scopeKey: marker.scopeKey,
        severity: marker.severity,
        title: marker.title,
        body: comment.body,
        path: comment.path,
        line: comment.line,
        commentId: comment.commentId,
        ...(comment.htmlUrl !== undefined ? { commentUrl: comment.htmlUrl } : {}),
        threadId: thread.threadId,
        isResolved: thread.isResolved,
        resolvedByLogin: thread.resolvedByLogin,
        lastAction,
        state
      };

      const previous = findingsByFingerprint.get(finding.fingerprint);
      if (!previous || shouldPrefer(finding, previous)) {
        findingsByFingerprint.set(finding.fingerprint, finding);
      }
    }
  }

  return [...findingsByFingerprint.values()];
}

/**
 * A duplicate fingerprint can be left behind by overlapping workflow runs.
 * Prefer a human suppression over any reopenable state, then prefer an open
 * thread over a bot-fixed duplicate so a regression can be handled normally.
 */
function shouldPrefer(candidate: ExistingFinding, current: ExistingFinding): boolean {
  const rank = (finding: ExistingFinding): number => {
    if (finding.state === "suppressed") {
      return 0;
    }
    if (finding.state === "open") {
      return 1;
    }
    return 2;
  };

  return rank(candidate) < rank(current);
}
