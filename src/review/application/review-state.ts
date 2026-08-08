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
  const findings: ExistingFinding[] = [];

  for (const thread of snapshot.reviewThreads) {
    for (const comment of thread.comments) {
      const marker = parseFindingMarker(comment.body);
      if (!marker) {
        continue;
      }

      const lastAction: ExistingFinding["lastAction"] = marker.botResolved ? "bot-resolved" : "updated";
      const resolvedByBot = wasResolvedByBot({ resolvedByLogin: thread.resolvedByLogin, lastAction }, botLogins);
      const state: FindingState = !thread.isResolved ? "open" : resolvedByBot ? "fixed" : "suppressed";

      findings.push({
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
      });
    }
  }

  return findings;
}
