import { describe, expect, it } from "vitest";
import { renderSummaryComment } from "../../../../src/review/domain/reporting/summary.js";
import type { SummaryRow } from "../../../../src/review/domain/reconciliation/reconcile.js";
import type { Severity } from "../../../../src/review/domain/types.js";

function row(severity: Severity, path: string, overrides?: Partial<SummaryRow>): SummaryRow {
  return {
    fingerprint: `fingerprint-${severity}`,
    severity,
    title: `${severity} finding`,
    path,
    line: 1,
    state: "open",
    commentId: null,
    ...overrides
  };
}

describe("renderSummaryComment", () => {
  it("sorts rows from P0 to P3", () => {
    const body = renderSummaryComment({
      rows: [row("P3", "p3.ts"), row("P1", "p1.ts"), row("P0", "p0.ts"), row("P2", "p2.ts")],
      owner: "owner",
      repo: "repo",
      pullRequestNumber: 1
    });

    const positions = ["| P0 |", "| P1 |", "| P2 |", "| P3 |"].map((value) => body.indexOf(value));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions[0]).toBeLessThan(positions[1]!);
    expect(positions[1]).toBeLessThan(positions[2]!);
    expect(positions[2]).toBeLessThan(positions[3]!);
  });

  it("merges file and line into a single column", () => {
    const body = renderSummaryComment({
      rows: [row("P0", "src/example.ts")],
      owner: "owner",
      repo: "repo",
      pullRequestNumber: 1
    });

    expect(body).toContain("| P0 | 🔴 open | src/example.ts:1 | P0 finding | - |");
  });

  it("includes a link when commentId is set", () => {
    const body = renderSummaryComment({
      rows: [row("P0", "src/example.ts", { commentId: 42 })],
      owner: "owner",
      repo: "repo",
      pullRequestNumber: 1
    });

    expect(body).toContain("[#42](https://github.com/owner/repo/pull/1#discussion_r42)");
  });

  it("shows path without line when line is null", () => {
    const body = renderSummaryComment({
      rows: [row("P0", "src/summary-only.ts", { line: null })],
      owner: "owner",
      repo: "repo",
      pullRequestNumber: 1
    });

    expect(body).toContain("| P0 | 🔴 open | src/summary-only.ts |");
  });
});
