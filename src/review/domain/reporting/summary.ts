import type { SummaryRow } from "../reconciliation/reconcile.js";
import { shortenFindingTitle } from "../findings/title.js";
import { buildSummaryRowMarker, SUMMARY_MARKER } from "../reconciliation/markers.js";
import { SEVERITIES } from "../severity.js";
import type { Severity } from "../types.js";
import { getReviewOutputLabels } from "../language.js";

const SEVERITY_ORDER = Object.fromEntries(SEVERITIES.map((severity, index) => [severity, index])) as Record<Severity, number>;
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
  headSha: string;
  language?: string;
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

function changesUrl(row: SummaryRow, input: RenderSummaryInput): string {
  const url = `https://github.com/${input.owner}/${input.repo}/pull/${String(input.pullRequestNumber)}/changes/BASE..${input.headSha}`;
  return row.commentId === null ? url : `${url}#r${String(row.commentId)}`;
}

function locationCell(row: SummaryRow, input: RenderSummaryInput): string {
  const fileCell = escapeCell(row.line !== null ? `${row.path}:${row.line}` : row.path)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const url = changesUrl(row, input).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<a href="${url}">${fileCell}</a>`;
}

function renderTable(rows: SummaryRow[], input: RenderSummaryInput, compact: boolean): string {
  const labels = getReviewOutputLabels(input.language);
  if (rows.length === 0) {
    return labels.noFindings;
  }

  const header = compact
    ? `| ${labels.tableHeaders.severity} | ${labels.tableHeaders.state} | ${labels.tableHeaders.file} |\n| --- | --- | --- |`
    : `| ${labels.tableHeaders.severity} | ${labels.tableHeaders.state} | ${labels.tableHeaders.file} | ${labels.tableHeaders.title} |\n| --- | --- | --- | --- |`;

  const lines = rows.map((row) => {
    const fileCell = locationCell(row, input);
    const cells = compact
      ? [row.severity, labels.states[row.state], fileCell]
      : [
          row.severity,
          labels.states[row.state],
          fileCell,
          escapeCell(shortenFindingTitle(row.title))
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
  const labels = getReviewOutputLabels(input.language);
  const sorted = sortRows(input.rows);
  const persistedSummaryOnly = renderSummaryOnlyMarkers(sorted);

  const full = [
    SUMMARY_MARKER,
    ...persistedSummaryOnly,
    "",
    `## ${labels.summaryTitle}`,
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
    `## ${labels.summaryTitle}`,
    "",
    renderTable(sorted, input, true)
  ].join("\n");
}
