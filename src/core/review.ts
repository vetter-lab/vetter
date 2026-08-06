import type { ChangedFileEntry, GitHubGateway } from "../github/gateway.js";
import type { CreateReviewCommentInput, PullRequestRef, ReviewStateSnapshot } from "../github/types.js";
import type { ReviewConfig } from "../config/schema.js";
import type { AnalyzerProvider } from "../providers/analyzer.js";
import type { ModelProvider } from "../providers/model.js";
import { findReviewAnchor, parseChangedFiles } from "./diff.js";
import { normalizeFinding } from "./fingerprint.js";
import { buildFindingMarker, parseFindingMarker } from "./markers.js";
import { evaluateCheckRun } from "./check-run.js";
import {
  reconcileFindings,
  wasResolvedByBot,
  type CurrentFindingInput,
  type ReconciliationPlan,
  type RenderableFinding,
  type SummaryRow
} from "./reconcile.js";
import { renderSummaryComment } from "./summary.js";
import type { ExistingFinding, FindingDraft, FindingState, ReviewContext } from "./types.js";

export interface RunReviewInput {
  gateway: GitHubGateway;
  context: ReviewContext;
  config: ReviewConfig;
  modelProvider: ModelProvider;
  analyzerProviders: AnalyzerProvider[];
  botLogins: Set<string>;
  /** Local checkout path analyzers read from; provided by the runtime layer. */
  repositoryPath: string;
  /** Read-only file contents made available to the model provider as supporting context. */
  contextFiles: Array<{ path: string; content: string }>;
  /**
   * Latest-wins cancellation signal from the calling runtime (App scheduler
   * or Action concurrency group). Checked immediately before the fresh head
   * SHA read and again before applying any GitHub mutation, so a superseded
   * run never writes stale comments.
   */
  signal?: AbortSignal;
}

export type RunReviewResult =
  | { status: "stale" }
  | { status: "aborted" }
  | { status: "completed"; conclusion: "success" | "failure"; rows: SummaryRow[] };

interface ProviderTask {
  name: string;
  run: () => Promise<{ findings: FindingDraft[]; scopeKeys: string[] }>;
}

/**
 * Reconstructs a full unified-diff-with-headers string for one file from
 * GitHub's per-file `patch` field, which contains only `@@` hunks. `parse-diff`
 * (used by `parseChangedFiles`) needs `diff --git`/`---`/`+++` lines to
 * attribute chunks to a path, so this synthesizes them from the already-known
 * path rather than depending on GitHub to include them.
 */
function toSyntheticPatch(entry: ChangedFileEntry): string {
  const patch = entry.patch.trim();
  if (patch.length === 0) {
    return "";
  }
  return [`diff --git a/${entry.path} b/${entry.path}`, `--- a/${entry.path}`, `+++ b/${entry.path}`, patch].join(
    "\n"
  );
}

function toPullRequestRef(context: ReviewContext): PullRequestRef {
  return {
    owner: context.repository.owner,
    repo: context.repository.name,
    number: context.pullRequestNumber
  };
}

/**
 * Reconstructs `ExistingFinding`s from the previous run's bot-owned comments.
 * GitHub comments are the only persisted state (no SQL), so every field is
 * read back from the hidden marker (`core/markers.ts`) and the surrounding
 * thread's resolution state.
 */
function toExistingFindings(snapshot: ReviewStateSnapshot, botLogins: Set<string>): ExistingFinding[] {
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

function renderInlineBody(finding: RenderableFinding, botResolved: boolean): string {
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

async function applyReconciliationPlan(input: {
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

/**
 * Orchestrates one review run end to end: loads the diff and provider
 * findings, guards against a stale head SHA, reconciles against existing
 * GitHub state, and applies the resulting mutations (review comments, thread
 * resolve/reopen, summary comment, Check Run) through the gateway.
 *
 * Providers run concurrently via `Promise.allSettled`; a failed provider
 * contributes no findings and no completed scope, so `reconcileFindings`
 * never closes a finding in the scope it was responsible for.
 */
export async function runReview(input: RunReviewInput): Promise<RunReviewResult> {
  const {
    gateway,
    context,
    config,
    modelProvider,
    analyzerProviders,
    botLogins,
    repositoryPath,
    contextFiles,
    signal
  } = input;
  const pullRequestRef = toPullRequestRef(context);

  const changedFileEntries = await gateway.listChangedFiles(pullRequestRef);
  const changedPaths = changedFileEntries.map((file) => file.path);
  const parsedDiff = parseChangedFiles(changedFileEntries.map(toSyntheticPatch).filter((patch) => patch.length > 0));
  const rawDiff = changedFileEntries.map((file) => file.patch).join("\n");

  const tasks: ProviderTask[] = [];

  if (config.review.enabled) {
    tasks.push({
      name: "llm",
      run: async () => {
        const result = await modelProvider.review({ diff: rawDiff, contextFiles, model: config.review.model });
        return { findings: result.findings, scopeKeys: result.scopeKeys };
      }
    });
  }

  for (const analyzer of analyzerProviders) {
    tasks.push({
      name: analyzer.name,
      run: async () => {
        const result = await analyzer.run({
          repositoryPath,
          changedPaths,
          timeoutMs: config.limits.analyzerTimeoutMs,
          maxOutputBytes: config.limits.maxAnalyzerOutputBytes
        });
        return { findings: result.findings, scopeKeys: result.completedScopes };
      }
    });
  }

  const settled = await Promise.allSettled(tasks.map((task) => task.run()));

  const drafts: FindingDraft[] = [];
  const completeScopes = new Set<string>();
  const failures: Array<{ provider: string; message: string }> = [];

  settled.forEach((result, index) => {
    const task = tasks[index];
    if (!task) {
      return;
    }
    if (result.status === "fulfilled") {
      drafts.push(...result.value.findings);
      for (const scopeKey of result.value.scopeKeys) {
        completeScopes.add(scopeKey);
      }
    } else {
      failures.push({ provider: task.name, message: String(result.reason) });
    }
  });

  const currentFindings = drafts.map((draft) => normalizeFinding(draft));

  if (signal?.aborted) {
    return { status: "aborted" };
  }

  const freshPullRequest = await gateway.getPullRequest(pullRequestRef);
  if (freshPullRequest.headSha !== context.headSha) {
    return { status: "stale" };
  }

  if (signal?.aborted) {
    return { status: "aborted" };
  }

  const reviewState = await gateway.listReviewState({ ...pullRequestRef, botLogins });
  const existingFindings = toExistingFindings(reviewState, botLogins);

  const currentInputs: CurrentFindingInput[] = currentFindings.map((finding) => ({
    finding,
    anchor: findReviewAnchor(parsedDiff, finding.path, finding.line)
  }));

  const plan = reconcileFindings({
    current: currentInputs,
    existing: existingFindings,
    completeScopes,
    botLogins
  });

  await applyReconciliationPlan({ gateway, pullRequestRef, headSha: context.headSha, plan });

  const summaryBody = renderSummaryComment({
    rows: plan.rows,
    owner: pullRequestRef.owner,
    repo: pullRequestRef.repo,
    pullRequestNumber: pullRequestRef.number
  });
  const existingSummary = await gateway.findSummaryComment({ ...pullRequestRef, botLogins });
  if (existingSummary) {
    await gateway.updateIssueComment({
      owner: pullRequestRef.owner,
      repo: pullRequestRef.repo,
      commentId: existingSummary.commentId,
      body: summaryBody
    });
  } else {
    await gateway.createIssueComment({ ...pullRequestRef, body: summaryBody });
  }

  const evaluation = evaluateCheckRun({ rows: plan.rows, config, failures });
  await gateway.upsertCheckRun({
    owner: pullRequestRef.owner,
    repo: pullRequestRef.repo,
    headSha: context.headSha,
    conclusion: evaluation.conclusion,
    title: evaluation.title,
    summary: evaluation.summary
  });

  return { status: "completed", conclusion: evaluation.conclusion, rows: plan.rows };
}
