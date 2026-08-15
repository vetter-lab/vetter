import type { GitHubGateway } from "../../integrations/github/gateway.js";
import type { CreateReviewCommentInput, PullRequestRef } from "../../integrations/github/types.js";
import { renderFindingTitle } from "../domain/findings/title.js";
import { buildFindingMarker } from "../domain/reconciliation/markers.js";
import type { ReconciliationPlan, RenderableFinding } from "../domain/reconciliation/reconcile.js";

export function renderInlineBody(finding: RenderableFinding, botResolved: boolean): string {
  const marker = buildFindingMarker({
    fingerprint: finding.fingerprint,
    ruleId: finding.ruleId,
    severity: finding.severity,
    source: finding.source,
    scopeKey: finding.scopeKey,
    title: finding.title,
    codeAnchor: finding.codeAnchor,
    botResolved
  });

  return [
    renderFindingTitle(finding.severity, finding.title),
    "",
    finding.body,
    "",
    marker
  ].join("\n");
}

export async function applyReconciliationPlan(input: {
  gateway: GitHubGateway;
  pullRequestRef: PullRequestRef;
  headSha: string;
  plan: ReconciliationPlan;
}): Promise<void> {
  const { gateway, pullRequestRef, headSha, plan } = input;

  const reviewComments: CreateReviewCommentInput[] = plan.createInline.map(({ finding, anchor }) => ({
    path: anchor.path,
    line: anchor.line,
    side: anchor.side,
    body: renderInlineBody(finding, false)
  }));

  const createdComments = await gateway.createReview({ ...pullRequestRef, commitId: headSha, comments: reviewComments });

  // Backfill the newly created comment references into plan.rows so the
  // summary can link to them immediately rather than waiting for the next run.
  const fingerprintToComment = new Map<string, { commentId: number; htmlUrl?: string }>();
  for (const [i, ci] of plan.createInline.entries()) {
    const fp = ci.finding.fingerprint;
    const createdComment = createdComments[i];
    if (createdComment !== undefined) {
      fingerprintToComment.set(fp, createdComment);
    }
  }
  for (const row of plan.rows) {
    const createdComment = fingerprintToComment.get(row.fingerprint);
    if (createdComment !== undefined) {
      row.commentId = createdComment.commentId;
      if (createdComment.htmlUrl !== undefined) {
        row.commentUrl = createdComment.htmlUrl;
      }
    }
  }

  for (const update of plan.updateInline) {
    await gateway.updateReviewComment({
      owner: pullRequestRef.owner,
      repo: pullRequestRef.repo,
      commentId: update.commentId,
      body: renderInlineBody(update.finding, update.botResolved)
    });
  }

  for (const threadId of plan.resolveThreads) {
    await gateway.resolveThread({ threadId });
  }

  for (const threadId of plan.reopenThreads) {
    await gateway.reopenThread({ threadId });
  }
}
