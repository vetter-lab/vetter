import { describe, expect, it } from "vitest";
import { renderSummaryComment } from "../../../../src/review/domain/reporting/summary.js";
import type { SummaryRow } from "../../../../src/review/domain/reconciliation/reconcile.js";
import type { Severity } from "../../../../src/review/domain/types.js";

function row(severity: Severity, path: string): SummaryRow {
  return {
    fingerprint: `fingerprint-${severity}`,
    severity,
    title: `${severity} finding`,
    path,
    line: 1,
    state: "open",
    commentId: null
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
});
