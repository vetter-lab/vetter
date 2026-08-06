import type { SummaryRow } from "./reconcile.js";
import { SUMMARY_MARKER } from "./markers.js";
import type { FindingState, Severity } from "./types.js";

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, major: 1, minor: 2 };
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

function commentLink(owner: string, repo: string, pullRequestNumber: number, commentId: number | null): string {
  if (commentId === null) {
    return "-";
  }
  return `[#${String(commentId)}](https://github.com/${owner}/${repo}/pull/${String(pullRequestNumber)}#discussion_r${String(commentId)})`;
}

function renderTable(rows: SummaryRow[], input: RenderSummaryInput, compact: boolean): string {
  if (rows.length === 0) {
    return "_No findings._";
  }

  const header = compact
    ? "| Severity | State | File | Line |\n| --- | --- | --- | --- |"
    : "| Severity | State | File | Line | Title | Link |\n| --- | --- | --- | --- | --- | --- |";

  const lines = rows.map((row) => {
    const cells = compact
      ? [row.severity, STATE_LABEL[row.state], row.path, row.line !== null ? String(row.line) : "-"]
      : [
          row.severity,
          STATE_LABEL[row.state],
          row.path,
          row.line !== null ? String(row.line) : "-",
          escapeCell(row.title),
          commentLink(input.owner, input.repo, input.pullRequestNumber, row.commentId)
        ];
    return `| ${cells.join(" | ")} |`;
  });

  return [header, ...lines].join("\n");
}

/**
 * Rebuilds the whole Vetter summary comment from this run's reconciled
 * rows. There is no partial edit: every run replaces the full body, which
 * is what keeps the summary an accurate mirror of `plan.rows` rather than
 * an append-only log.
 */
export function renderSummaryComment(input: RenderSummaryInput): string {
  const sorted = sortRows(input.rows);

  const full = [SUMMARY_MARKER, "", "## Vetter review summary", "", renderTable(sorted, input, false)].join("\n");
  if (full.length <= MAX_COMMENT_LENGTH) {
    return full;
  }

  return [SUMMARY_MARKER, "", "## Vetter review summary", "", renderTable(sorted, input, true)].join("\n");
}
