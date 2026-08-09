import { describe, expect, it } from "vitest";
import { reconcileFindings } from "../../../../src/review/domain/reconciliation/reconcile.js";
import type { ExistingFinding, Finding } from "../../../../src/review/domain/types.js";

function finding(fingerprint: string, title = fingerprint): Finding {
  return {
    fingerprint,
    ruleId: `rule-${fingerprint}`,
    severity: "P1",
    title,
    body: `${title} body`,
    path: "src/example.ts",
    line: 2,
    codeAnchor: "new code",
    source: "llm",
    scopeKey: `llm:rule-${fingerprint}:src/example.ts`
  };
}

function existing(input: {
  fingerprint: string;
  state: ExistingFinding["state"];
  isResolved: boolean;
  threadId: string;
  commentId: number;
  ruleId?: string;
  source?: ExistingFinding["source"];
  codeAnchor?: string;
}): ExistingFinding {
  const currentFinding = finding(input.fingerprint);
  return {
    ...currentFinding,
    ...(input.ruleId !== undefined ? { ruleId: input.ruleId } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.codeAnchor !== undefined ? { codeAnchor: input.codeAnchor } : {}),
    body: `${currentFinding.title} body`,
    line: currentFinding.line,
    commentId: input.commentId,
    threadId: input.threadId,
    isResolved: input.isResolved,
    resolvedByLogin: input.state === "dismissed" ? "developer" : input.state === "fixed" ? "github-actions[bot]" : null,
    lastAction: input.state === "fixed" ? "bot-resolved" : "updated",
    state: input.state
  };
}

describe("reconcileFindings", () => {
  it("keeps dismissed and fixed findings while resolving only the fixed thread", () => {
    const dismissed = existing({
      fingerprint: "dismissed",
      state: "dismissed",
      isResolved: true,
      threadId: "thread-dismissed",
      commentId: 1
    });
    const fixed = existing({
      fingerprint: "fixed",
      state: "open",
      isResolved: false,
      threadId: "thread-fixed",
      commentId: 2
    });
    const currentOpen = finding("current-open");
    const currentOpenAgain = finding("current-open-again");

    const plan = reconcileFindings({
      current: [
        { finding: currentOpen, anchor: { path: currentOpen.path, line: currentOpen.line, side: "RIGHT" } },
        { finding: currentOpenAgain, anchor: { path: currentOpenAgain.path, line: currentOpenAgain.line, side: "RIGHT" } }
      ],
      existing: [dismissed, fixed],
      persistedSummaryRows: [],
      completeScopes: new Set(["llm:src/example.ts"]),
      botLogins: new Set(["github-actions[bot]"])
    });

    expect(plan.createInline).toHaveLength(2);
    expect(plan.resolveThreads).toEqual(["thread-fixed"]);
    expect(plan.rows.map((row) => [row.fingerprint, row.state])).toEqual([
      ["current-open", "open"],
      ["current-open-again", "open"],
      ["dismissed", "dismissed"],
      ["fixed", "fixed"]
    ]);
  });

  it("uses persisted summary rows when a thread is absent from the snapshot", () => {
    const currentOpen = finding("current-open");
    const currentOpenAgain = finding("current-open-again");

    const plan = reconcileFindings({
      current: [
        { finding: currentOpen, anchor: { path: currentOpen.path, line: currentOpen.line, side: "RIGHT" } },
        { finding: currentOpenAgain, anchor: { path: currentOpenAgain.path, line: currentOpenAgain.line, side: "RIGHT" } }
      ],
      existing: [],
      persistedSummaryRows: [
        {
          fingerprint: "dismissed",
          severity: "P1",
          title: "Manually dismissed",
          path: "src/example.ts",
          line: 4,
          state: "dismissed",
          commentId: null
        },
        {
          fingerprint: "fixed",
          severity: "P1",
          title: "Already fixed",
          path: "src/example.ts",
          line: 5,
          state: "fixed",
          commentId: null
        },
        {
          fingerprint: currentOpen.fingerprint,
          severity: currentOpen.severity,
          title: currentOpen.title,
          path: currentOpen.path,
          line: currentOpen.line,
          state: "open",
          commentId: null
        },
        {
          fingerprint: currentOpenAgain.fingerprint,
          severity: currentOpenAgain.severity,
          title: currentOpenAgain.title,
          path: currentOpenAgain.path,
          line: currentOpenAgain.line,
          state: "open",
          commentId: null
        }
      ],
      completeScopes: new Set(["llm:src/example.ts"]),
      botLogins: new Set(["github-actions[bot]"])
    });

    expect(plan.createInline).toHaveLength(0);
    expect(plan.rows).toHaveLength(4);
    expect(plan.rows.find((row) => row.fingerprint === "dismissed")?.state).toBe("dismissed");
    expect(plan.rows.find((row) => row.fingerprint === "fixed")?.state).toBe("fixed");
  });

  it("does not close an existing finding outside the incremental diff", () => {
    const untouched = existing({
      fingerprint: "untouched",
      state: "open",
      isResolved: false,
      threadId: "thread-untouched",
      commentId: 3
    });

    const plan = reconcileFindings({
      current: [],
      existing: [untouched],
      completeScopes: new Set(["llm:src/example.ts"]),
      reviewedExistingFingerprints: new Set(),
      botLogins: new Set(["github-actions[bot]"])
    });

    expect(plan.resolveThreads).toEqual([]);
    expect(plan.rows).toEqual([
      expect.objectContaining({ fingerprint: "untouched", state: "open" })
    ]);
  });

  it("resolves the old thread when the same rule reports a different code anchor", () => {
    const oldFinding = existing({
      fingerprint: "old-finding",
      state: "open",
      isResolved: false,
      threadId: "old-thread",
      commentId: 4,
      ruleId: "mutable-action",
      source: "llm",
      codeAnchor: "- uses: actions/checkout@v4"
    });
    const currentFinding: Finding = {
      ...finding("current-finding"),
      ruleId: "mutable-action",
      source: "llm",
      codeAnchor: "- uses: vetter-lab/vetter@main",
      scopeKey: "llm:mutable-action:src/example.ts"
    };

    const plan = reconcileFindings({
      current: [
        {
          finding: currentFinding,
          anchor: { path: currentFinding.path, line: currentFinding.line, side: "RIGHT" }
        }
      ],
      existing: [oldFinding],
      completeScopes: new Set(["llm:src/example.ts"]),
      reviewedExistingFingerprints: new Set([oldFinding.fingerprint]),
      botLogins: new Set(["github-actions[bot]"])
    });

    expect(plan.createInline).toEqual([{ finding: currentFinding, anchor: expect.anything() }]);
    expect(plan.resolveThreads).toEqual(["old-thread"]);
    expect(plan.rows).toEqual([
      expect.objectContaining({ fingerprint: "current-finding", state: "open" }),
      expect.objectContaining({ fingerprint: "old-finding", state: "fixed" })
    ]);
  });
});
