import { describe, expect, it } from "vitest";
import { evaluateCheckRun } from "../../../../src/review/domain/reporting/check-run.js";
import type { SummaryRow } from "../../../../src/review/domain/reconciliation/reconcile.js";
import type { Severity } from "../../../../src/review/domain/types.js";

function row(severity: Severity): SummaryRow {
  return {
    fingerprint: `fingerprint-${severity}`,
    severity,
    title: `${severity} finding`,
    path: `${severity}.ts`,
    line: 1,
    state: "open",
    commentId: null
  };
}

describe("evaluateCheckRun", () => {
  it("counts every P0-P3 severity and applies configured blocking", () => {
    const result = evaluateCheckRun({
      rows: [row("P0"), row("P1"), row("P2"), row("P3")],
      severity: {
        P0: { blockMerge: false },
        P1: { blockMerge: true },
        P2: { blockMerge: false },
        P3: { blockMerge: false }
      },
      failures: []
    });

    expect(result.conclusion).toBe("failure");
    for (const severity of ["P0", "P1", "P2", "P3"] as const) {
      expect(result.summary).toContain(`- **${severity}**: 1 open`);
    }
  });

  it("localizes the Check Run text", () => {
    const result = evaluateCheckRun({
      rows: [row("P1")],
      severity: {
        P0: { blockMerge: false },
        P1: { blockMerge: false },
        P2: { blockMerge: false },
        P3: { blockMerge: false }
      },
      failures: [],
      language: "zh-CN"
    });

    expect(result.title).toBe("Vetter 发现 1 个未解决问题");
    expect(result.summary).toContain("未解决问题: 1");
    expect(result.summary).toContain("阻止合并: 否");
  });
});
