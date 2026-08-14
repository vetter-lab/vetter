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
  it("renders the Vetter logo to the left of the summary title", () => {
    const body = renderSummaryComment({
      rows: [],
      owner: "owner",
      repo: "repo",
      pullRequestNumber: 1,
      headSha: "head-sha"
    });

    expect(body).toContain(
      '## <img src="https://cdn.jsdelivr.net/gh/vetter-lab/vetter/logos/logo.png" alt="Vetter logo" width="24" /> Vetter review summary'
    );
  });

  it("sorts rows from P0 to P3", () => {
    const body = renderSummaryComment({
      rows: [row("P3", "p3.ts"), row("P1", "p1.ts"), row("P0", "p0.ts"), row("P2", "p2.ts")],
      owner: "owner",
      repo: "repo",
      pullRequestNumber: 1,
      headSha: "head-sha"
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
      pullRequestNumber: 1,
      headSha: "head-sha"
    });

    expect(body).toContain(
      '| P0 | 🔴 open | <a href="https://github.com/owner/repo/pull/1/changes/BASE..head-sha">src/example.ts:1</a> | P0 finding |'
    );
  });

  it("links the file to the pull request changes page", () => {
    const body = renderSummaryComment({
      rows: [row("P0", "src/example.ts", { commentId: 42 })],
      owner: "owner",
      repo: "repo",
      pullRequestNumber: 1,
      headSha: "head-sha"
    });

    expect(body).toContain(
      '<a href="https://github.com/owner/repo/pull/1/changes/BASE..head-sha#r42">src/example.ts:1</a>'
    );
    expect(body).not.toContain("| Link |");
    expect(body).not.toContain('target="_blank"');
  });

  it("persists markers for inline rows as well as summary-only rows", () => {
    const body = renderSummaryComment({
      rows: [row("P1", "src/example.ts", { fingerprint: "inline-fingerprint", commentId: 42 })],
      owner: "owner",
      repo: "repo",
      pullRequestNumber: 1,
      headSha: "head-sha"
    });

    expect(body).toContain('vetter:summary-row:v1 fingerprint="inline-fingerprint"');
  });

  it("shortens long titles while linking the file to changes", () => {
    const body = renderSummaryComment({
      rows: [
        row("P1", ".github/workflows/vetter-action.yml", {
          title:
            "GitHub Actions step uses a mutable tag or branch reference. Tags and branch names can be silently repointed",
          line: 21,
          commentId: 42
        })
      ],
      owner: "owner",
      repo: "repo",
      pullRequestNumber: 1,
      headSha: "head-sha"
    });

    expect(body).toContain(
      '<a href="https://github.com/owner/repo/pull/1/changes/BASE..head-sha#r42">.github/workflows/vetter-action.yml:21</a>'
    );
    expect(body).toContain("GitHub Actions step uses a mutable tag or branch...");
    expect(body.split("\n").find((line) => line.startsWith("| P1 |"))).not.toContain(
      "Tags and branch names can be silently repointed"
    );
  });

  it("shows path without line when line is null", () => {
    const body = renderSummaryComment({
      rows: [row("P0", "src/summary-only.ts", { line: null })],
      owner: "owner",
      repo: "repo",
      pullRequestNumber: 1,
      headSha: "head-sha"
    });

    expect(body).toContain(
      '| P0 | 🔴 open | <a href="https://github.com/owner/repo/pull/1/changes/BASE..head-sha">src/summary-only.ts</a> |'
    );
  });

  it("localizes fixed summary labels", () => {
    const body = renderSummaryComment({
      rows: [row("P1", "src/example.ts")],
      owner: "owner",
      repo: "repo",
      pullRequestNumber: 1,
      headSha: "head-sha",
      language: "zh-CN"
    });

    expect(body).toContain(
      '## <img src="https://cdn.jsdelivr.net/gh/vetter-lab/vetter/logos/logo.png" alt="Vetter logo" width="24" /> Vetter 审查摘要'
    );
    expect(body).toContain("| 严重程度 | 状态 | 文件 | 标题 |");
    expect(body).toContain("🔴 待处理");
  });
});
