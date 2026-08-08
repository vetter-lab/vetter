import type { ChangedFileEntry, GitHubGateway } from "../../integrations/github/gateway.js";
import type { PullRequestRef } from "../../integrations/github/types.js";
import type { ReviewConfig } from "../../config/schema.js";
import type { AnalyzerProvider } from "../../integrations/analyzers/types.js";
import type { ModelProvider } from "../../integrations/models/model.js";
import { findReviewAnchor } from "../domain/diff/anchor.js";
import { parseChangedFiles } from "../domain/diff/parser.js";
import { deduplicateFindings } from "../domain/findings/fingerprint.js";
import { normalizeFinding } from "../domain/findings/normalize.js";
import { evaluateCheckRun } from "../domain/reporting/check-run.js";
import { parseSummaryRowMarkers } from "../domain/reconciliation/markers.js";
import {
  reconcileFindings,
  type CurrentFindingInput,
  type SummaryRow
} from "../domain/reconciliation/reconcile.js";
import { renderSummaryComment } from "../domain/reporting/summary.js";
import type { ExistingFinding, FindingDraft, ReviewContext } from "../domain/types.js";
import { applyReconciliationPlan } from "./review-comments.js";
import { toExistingFindings } from "./review-state.js";

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
  /** Action-runtime guard for cancelled workflow runs; omitted by the App runtime. */
  isRunActive?: () => Promise<boolean>;
}

export interface SyncReviewSummaryInput {
  gateway: GitHubGateway;
  context: ReviewContext;
  config: ReviewConfig;
  botLogins: Set<string>;
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

function toSummaryRow(existing: ExistingFinding): SummaryRow {
  return {
    fingerprint: existing.fingerprint,
    severity: existing.severity,
    title: existing.title,
    path: existing.path,
    line: existing.line,
    state: existing.state,
    commentId: existing.commentId,
    ...(existing.commentUrl !== undefined ? { commentUrl: existing.commentUrl } : {})
  };
}

function toPersistedSummaryRow(input: ReturnType<typeof parseSummaryRowMarkers>[number]): SummaryRow {
  return {
    fingerprint: input.fingerprint,
    severity: input.severity,
    title: input.title,
    path: input.path,
    line: input.line,
    state: input.state,
    commentId: null
  };
}

/**
 * Refreshes the summary and Check Run from the persisted GitHub state only.
 * Review-thread webhook deliveries use this path because resolving a thread
 * does not change the code being reviewed and does not require providers to
 * run again.
 */
export async function syncReviewSummary(input: SyncReviewSummaryInput): Promise<RunReviewResult> {
  const { gateway, context, config, botLogins, signal } = input;
  const pullRequestRef = toPullRequestRef(context);

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
  const existingSummary = await gateway.findSummaryComment({ ...pullRequestRef, botLogins });
  const rowsByFingerprint = new Map<string, SummaryRow>();
  const persistedRows = existingSummary ? parseSummaryRowMarkers(existingSummary.body).map(toPersistedSummaryRow) : [];
  for (const row of persistedRows) {
    rowsByFingerprint.set(row.fingerprint, row);
  }
  for (const row of toExistingFindings(reviewState, botLogins).map(toSummaryRow)) {
    rowsByFingerprint.set(row.fingerprint, row);
  }
  const rows = [...rowsByFingerprint.values()];
  const summaryBody = renderSummaryComment({
    rows,
    owner: pullRequestRef.owner,
    repo: pullRequestRef.repo,
    pullRequestNumber: pullRequestRef.number,
    headSha: context.headSha,
    language: config.review.language
  });

  if (signal?.aborted) {
    return { status: "aborted" };
  }

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

  if (signal?.aborted) {
    return { status: "aborted" };
  }

  const evaluation = evaluateCheckRun({
    rows,
    severity: config.severity,
    failures: [],
    language: config.review.language
  });
  await gateway.upsertCheckRun({
    owner: pullRequestRef.owner,
    repo: pullRequestRef.repo,
    headSha: context.headSha,
    conclusion: evaluation.conclusion,
    title: evaluation.title,
    summary: evaluation.summary
  });

  return { status: "completed", conclusion: evaluation.conclusion, rows };
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
    signal,
    isRunActive
  } = input;
  const pullRequestRef = toPullRequestRef(context);

  if (context.source === "pull_request_review_thread") {
    return syncReviewSummary({
      gateway,
      context,
      config,
      botLogins,
      ...(signal ? { signal } : {})
    });
  }

  const changedFileEntries = await gateway.listChangedFiles({
    ...pullRequestRef,
    baseSha: context.reviewBaseSha ?? context.baseSha,
    headSha: context.headSha
  });
  const changedPaths = changedFileEntries.map((file) => file.path);
  const reviewPatches = changedFileEntries.map(toSyntheticPatch).filter((patch) => patch.length > 0);
  const parsedDiff = parseChangedFiles(reviewPatches);
  const reviewDiff = reviewPatches.join("\n");

  const tasks: ProviderTask[] = [];

  if (config.review.enabled) {
    tasks.push({
      name: "llm",
      run: async () => {
        const result = await modelProvider.review({
          diff: reviewDiff,
          contextFiles,
          model: config.review.model,
          language: config.review.language
        });
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

  const currentFindings = deduplicateFindings(drafts.map((draft) => normalizeFinding(draft)));

  if (signal?.aborted || (isRunActive && !(await isRunActive()))) {
    return { status: "aborted" };
  }

  const freshPullRequest = await gateway.getPullRequest(pullRequestRef);
  if (freshPullRequest.headSha !== context.headSha) {
    return { status: "stale" };
  }

  if (signal?.aborted || (isRunActive && !(await isRunActive()))) {
    return { status: "aborted" };
  }

  const reviewState = await gateway.listReviewState({ ...pullRequestRef, botLogins });
  const existingFindings = toExistingFindings(reviewState, botLogins);
  const reviewedExistingFingerprints = new Set(
    existingFindings
      .filter((existing) => {
        const changedFile = parsedDiff.find((file) => file.path === existing.path);
        if (!changedFile) {
          return false;
        }
        if (changedFile.status === "deleted") {
          return true;
        }
        return existing.line !== null &&
          (changedFile.addedLines.includes(existing.line) || changedFile.removedLines.includes(existing.line));
      })
      .map((existing) => existing.fingerprint)
  );
  const existingSummary = await gateway.findSummaryComment({ ...pullRequestRef, botLogins });
  const persistedSummaryRows = existingSummary
    ? parseSummaryRowMarkers(existingSummary.body).map(toPersistedSummaryRow)
    : [];

  const currentInputs: CurrentFindingInput[] = currentFindings.map((finding) => ({
    finding,
    anchor: findReviewAnchor(parsedDiff, finding.path, finding.line)
  }));

  const plan = reconcileFindings({
    current: currentInputs,
    existing: existingFindings,
    persistedSummaryRows,
    completeScopes,
    reviewedExistingFingerprints,
    botLogins
  });

  if (signal?.aborted || (isRunActive && !(await isRunActive()))) {
    return { status: "aborted" };
  }

  await applyReconciliationPlan({ gateway, pullRequestRef, headSha: context.headSha, plan });

  if (signal?.aborted || (isRunActive && !(await isRunActive()))) {
    return { status: "aborted" };
  }

  const summaryBody = renderSummaryComment({
    rows: plan.rows,
    owner: pullRequestRef.owner,
    repo: pullRequestRef.repo,
    pullRequestNumber: pullRequestRef.number,
    headSha: context.headSha,
    language: config.review.language
  });
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

  const evaluation = evaluateCheckRun({
    rows: plan.rows,
    severity: config.severity,
    failures,
    language: config.review.language
  });
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
