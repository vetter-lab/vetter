import type { ReviewAnchor } from "../diff/types.js";
import { matchExistingFinding } from "../findings/fingerprint.js";
import type { ExistingFinding, Finding, FindingState, ReviewSource, Severity } from "../types.js";

export interface CurrentFindingInput {
  finding: Finding;
  /** Null when the finding's line is not part of the current review diff. */
  anchor: ReviewAnchor | null;
}

/**
 * The subset of a `Finding`/`ExistingFinding` needed to render an inline
 * comment body, common to both a freshly reviewed finding and a stale one
 * reconstructed from a previous comment.
 */
export interface RenderableFinding {
  fingerprint: string;
  ruleId: string;
  severity: Severity;
  source: ReviewSource;
  scopeKey: string;
  title: string;
  body: string;
  path: string;
  line: number | null;
}

export interface CreateInlinePlan {
  finding: Finding;
  anchor: ReviewAnchor;
}

export interface UpdateInlinePlan {
  commentId: number;
  finding: RenderableFinding;
  /** Written into the refreshed marker; true only when this update resolves the thread as fixed. */
  botResolved: boolean;
}

export interface SummaryRow {
  fingerprint: string;
  severity: Severity;
  title: string;
  path: string;
  line: number | null;
  state: FindingState;
  commentId: number | null;
  /** Canonical GitHub URL for the inline comment, when available. */
  commentUrl?: string;
}

export interface ReconciliationPlan {
  createInline: CreateInlinePlan[];
  updateInline: UpdateInlinePlan[];
  resolveThreads: string[];
  reopenThreads: string[];
  /** Current findings whose line is outside the diff: kept in the summary, no inline comment. */
  summaryOnly: Finding[];
  rows: SummaryRow[];
}

export interface ReconcileInput {
  current: CurrentFindingInput[];
  existing: ExistingFinding[];
  /** Summary rows from the previous run, used when GitHub omits a thread from the snapshot. */
  persistedSummaryRows?: SummaryRow[];
  /** Provider scope keys (`${source}:${path}`) that completed a full, successful pass this run. */
  completeScopes: Set<string>;
  /** Existing findings whose location was included in this incremental diff. */
  reviewedExistingFingerprints?: Set<string>;
  botLogins: Set<string>;
}

/**
 * Formats the provider-completeness scope key for a finding's source/path
 * pair. Deliberately distinct from `Finding.scopeKey` (which also carries
 * `ruleId`, for fingerprinting): completeness is tracked per file per
 * provider, not per rule, since a provider either finished reviewing a file
 * or it didn't.
 */
export function providerScope(source: ReviewSource, path: string): string {
  return `${source}:${path}`;
}

/**
 * Determines whether a resolved thread was resolved by Vetter itself (a
 * "fixed" finding) rather than a developer (a "suppressed" finding).
 * `resolvedByLogin` from GitHub's GraphQL API is authoritative when known;
 * the marker's `bot-resolved` field is the fallback. See design doc section 5.
 */
export function wasResolvedByBot(existing: Pick<ExistingFinding, "resolvedByLogin" | "lastAction">, botLogins: Set<string>): boolean {
  if (existing.resolvedByLogin !== null) {
    return botLogins.has(existing.resolvedByLogin);
  }
  return existing.lastAction === "bot-resolved";
}

function toRenderable(finding: Finding): RenderableFinding {
  return {
    fingerprint: finding.fingerprint,
    ruleId: finding.ruleId,
    severity: finding.severity,
    source: finding.source,
    scopeKey: finding.scopeKey,
    title: finding.title,
    body: finding.body,
    path: finding.path,
    line: finding.line
  };
}

function existingToRenderable(existing: ExistingFinding): RenderableFinding {
  return {
    fingerprint: existing.fingerprint,
    ruleId: existing.ruleId,
    severity: existing.severity,
    source: existing.source,
    scopeKey: existing.scopeKey,
    title: existing.title,
    body: existing.body,
    path: existing.path,
    line: existing.line
  };
}

function rowFromFinding(
  finding: Finding,
  state: FindingState,
  commentId: number | null,
  commentUrl?: string
): SummaryRow {
  return {
    fingerprint: finding.fingerprint,
    severity: finding.severity,
    title: finding.title,
    path: finding.path,
    line: finding.line,
    state,
    commentId,
    ...(commentUrl !== undefined ? { commentUrl } : {})
  };
}

function rowFromExisting(existing: ExistingFinding, state: FindingState): SummaryRow {
  return {
    fingerprint: existing.fingerprint,
    severity: existing.severity,
    title: existing.title,
    path: existing.path,
    line: existing.line,
    state,
    commentId: existing.commentId,
    ...(existing.commentUrl !== undefined ? { commentUrl: existing.commentUrl } : {})
  };
}

/**
 * Pure reconciliation of this run's findings against previously persisted
 * GitHub comment/thread state (there is no SQL store; GitHub comments and
 * threads are the state). Implements the state table in design doc section 5:
 *
 * - A current finding matching an unresolved or bot-resolved-then-regressed
 *   thread is created/updated/reopened.
 * - A current finding matching a developer-resolved thread stays suppressed
 *   and is never reopened.
 * - An existing finding missing from the current run is marked `fixed` only
 *   when its provider/path scope fully completed this run and its location was
 *   included in the incremental diff; otherwise it is left untouched so a
 *   commit-level review cannot close an unreviewed finding.
 *
 * Performs no I/O; the caller applies the returned plan through a
 * `GitHubGateway`.
 */
export function reconcileFindings(input: ReconcileInput): ReconciliationPlan {
  const {
    current,
    existing,
    persistedSummaryRows = [],
    completeScopes,
    reviewedExistingFingerprints,
    botLogins
  } = input;

  const createInline: CreateInlinePlan[] = [];
  const updateInline: UpdateInlinePlan[] = [];
  const resolveThreads: string[] = [];
  const reopenThreads: string[] = [];
  const summaryOnly: Finding[] = [];
  const rowsByFingerprint = new Map(persistedSummaryRows.map((row) => [row.fingerprint, row]));

  const matchedFingerprints = new Set<string>();
  const setRow = (row: SummaryRow): void => {
    rowsByFingerprint.set(row.fingerprint, row);
  };

  for (const { finding, anchor } of current) {
    const match = matchExistingFinding(finding, existing, reviewedExistingFingerprints);

    if (match) {
      matchedFingerprints.add(match.fingerprint);

      if (match.isResolved) {
        if (wasResolvedByBot(match, botLogins)) {
          if (match.threadId) {
            reopenThreads.push(match.threadId);
          }
          updateInline.push({ commentId: match.commentId, finding: toRenderable(finding), botResolved: false });
          setRow(rowFromFinding(finding, "open", match.commentId, match.commentUrl));
        } else {
          setRow(rowFromFinding(finding, "suppressed", match.commentId, match.commentUrl));
        }
        continue;
      }

      updateInline.push({ commentId: match.commentId, finding: toRenderable(finding), botResolved: false });
      setRow(rowFromFinding(finding, "open", match.commentId, match.commentUrl));
      continue;
    }

    const persisted = rowsByFingerprint.get(finding.fingerprint);
    if (persisted) {
      if (persisted.state === "fixed") {
        if (anchor) {
          createInline.push({ finding, anchor });
          setRow(rowFromFinding(finding, "open", null));
        } else {
          summaryOnly.push(finding);
          setRow(rowFromFinding(finding, "open", null));
        }
      } else {
        setRow(rowFromFinding(finding, persisted.state, persisted.commentId, persisted.commentUrl));
      }
      continue;
    }

    if (anchor) {
      createInline.push({ finding, anchor });
      setRow(rowFromFinding(finding, "open", null));
    } else {
      summaryOnly.push(finding);
      setRow(rowFromFinding(finding, "open", null));
    }
  }

  for (const existingFinding of existing) {
    if (matchedFingerprints.has(existingFinding.fingerprint)) {
      continue;
    }

    if (!existingFinding.isResolved) {
      const scope = providerScope(existingFinding.source, existingFinding.path);
      const wasReviewed =
        reviewedExistingFingerprints === undefined || reviewedExistingFingerprints.has(existingFinding.fingerprint);
      if (completeScopes.has(scope) && wasReviewed) {
        if (existingFinding.threadId) {
          resolveThreads.push(existingFinding.threadId);
        }
        updateInline.push({
          commentId: existingFinding.commentId,
          finding: existingToRenderable(existingFinding),
          botResolved: true
        });
        setRow(rowFromExisting(existingFinding, "fixed"));
      } else {
        setRow(rowFromExisting(existingFinding, existingFinding.state));
      }
      continue;
    }

    setRow(rowFromExisting(existingFinding, existingFinding.state));
  }

  return {
    createInline,
    updateInline,
    resolveThreads,
    reopenThreads,
    summaryOnly,
    rows: [...rowsByFingerprint.values()]
  };
}
