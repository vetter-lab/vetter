import type { GitHubGateway } from "../../integrations/github/gateway.js";
import type { CreateReviewCommentInput, PullRequestRef } from "../../integrations/github/types.js";
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
    botResolved
  });

  return [`**[${finding.severity.toUpperCase()}] ${finding.title}**`, "", finding.body, "", marker].join("\n");
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

  await gateway.createReview({ ...pullRequestRef, commitId: headSha, comments: reviewComments });

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
