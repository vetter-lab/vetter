import type { SummaryRow } from "../reconciliation/reconcile.js";
import { shortenFindingTitle } from "../findings/title.js";
import { buildSummaryRowMarker, SUMMARY_MARKER } from "../reconciliation/markers.js";
import { SEVERITIES } from "../severity.js";
import type { FindingState, Severity } from "../types.js";

const SEVERITY_ORDER = Object.fromEntries(SEVERITIES.map((severity, index) => [severity, index])) as Record<Severity, number>;
const STATE_LABEL: Record<FindingState, string> = {
  open: "🔴 open",
  fixed: "✅ fixed",
  suppressed: "⚪ suppressed"
};

/**
 * GitHub caps issue comment bodies at 65536 characters. This stays well
 * under that so the compact fallback always has room to switch in before
 * a real API rejection.
 */
const MAX_COMMENT_LENGTH = 60_000;

export interface RenderSummaryInput {
  rows: SummaryRow[];
  owner: string;
  repo: string;
  pullRequestNumber: number;
}

function sortRows(rows: SummaryRow[]): SummaryRow[] {
  return [...rows].sort((a, b) => {
    if (SEVERITY_ORDER[a.severity] !== SEVERITY_ORDER[b.severity]) {
      return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    }
    if (a.path !== b.path) {
      return a.path.localeCompare(b.path);
    }
    return (a.line ?? 0) - (b.line ?? 0);
  });
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function fallbackCommentUrl(owner: string, repo: string, pullRequestNumber: number, commentId: number): string {
  return `https://github.com/${owner}/${repo}/pull/${String(pullRequestNumber)}#discussion_r${String(commentId)}`;
}

function commentUrl(row: SummaryRow, input: RenderSummaryInput): string | null {
  if (row.commentId === null) {
    return null;
  }
  return row.commentUrl ?? fallbackCommentUrl(input.owner, input.repo, input.pullRequestNumber, row.commentId);
}

function commentLink(row: SummaryRow, input: RenderSummaryInput): string {
  const url = commentUrl(row, input);
  if (url === null || row.commentId === null) {
    return "-";
  }
  return `[#${String(row.commentId)}](${url})`;
}

function locationCell(row: SummaryRow, input: RenderSummaryInput): string {
  const fileCell = escapeCell(row.line !== null ? `${row.path}:${row.line}` : row.path);
  const url = commentUrl(row, input);
  return url === null ? fileCell : `[${fileCell}](${url})`;
}

function renderTable(rows: SummaryRow[], input: RenderSummaryInput, compact: boolean): string {
  if (rows.length === 0) {
    return "_No findings._";
  }

  const header = compact
    ? "| Severity | State | File |\n| --- | --- | --- |"
    : "| Severity | State | File | Title | Link |\n| --- | --- | --- | --- | --- |";

  const lines = rows.map((row) => {
    const fileCell = locationCell(row, input);
    const cells = compact
      ? [row.severity, STATE_LABEL[row.state], fileCell]
      : [
          row.severity,
          STATE_LABEL[row.state],
          fileCell,
          escapeCell(shortenFindingTitle(row.title)),
          commentLink(row, input)
        ];
    return `| ${cells.join(" | ")} |`;
  });

  return [header, ...lines].join("\n");
}

function renderSummaryOnlyMarkers(rows: SummaryRow[]): string[] {
  return rows
    .filter((row) => row.commentId === null)
    .map((row) =>
      buildSummaryRowMarker({
        fingerprint: row.fingerprint,
        severity: row.severity,
        title: row.title,
        path: row.path,
        line: row.line,
        state: row.state
      })
    );
}

/**
 * Rebuilds the whole Vetter summary comment from this run's reconciled
 * rows. There is no partial edit: every run replaces the full body, which
 * is what keeps the summary an accurate mirror of `plan.rows` rather than
 * an append-only log.
 */
export function renderSummaryComment(input: RenderSummaryInput): string {
  const sorted = sortRows(input.rows);
  const persistedSummaryOnly = renderSummaryOnlyMarkers(sorted);

  const full = [
    SUMMARY_MARKER,
    ...persistedSummaryOnly,
    "",
    "## Vetter review summary",
    "",
    renderTable(sorted, input, false)
  ].join("\n");
  if (full.length <= MAX_COMMENT_LENGTH) {
    return full;
  }

  return [
    SUMMARY_MARKER,
    ...persistedSummaryOnly,
    "",
    "## Vetter review summary",
    "",
    renderTable(sorted, input, true)
  ].join("\n");
}
