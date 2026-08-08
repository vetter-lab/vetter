import { describe, expect, it } from "vitest";
import { relocateExistingFindings } from "../../../../src/review/domain/reconciliation/relocate.js";
import type { ChangedFile } from "../../../../src/review/domain/diff/types.js";
import type { ExistingFinding } from "../../../../src/review/domain/types.js";

function existing(line: number | null): ExistingFinding {
  return {
    fingerprint: "finding",
    ruleId: "rule",
    source: "llm",
    scopeKey: "llm:rule:src/example.ts",
    severity: "P1",
    title: "Finding",
    body: "Body",
    path: "src/example.ts",
    codeAnchor: "return unsafe(value);",
    line,
    commentId: 1,
    threadId: "thread",
    isResolved: false,
    resolvedByLogin: null,
    lastAction: "updated",
    state: "open"
  };
}

function changedFile(overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    path: "src/example.ts",
    status: "modified",
    patch: "",
    addedLines: [],
    addedLineContents: [],
    removedLines: [],
    scopeKey: "src/example.ts",
    ...overrides
  };
}

describe("relocateExistingFindings", () => {
  it("updates a finding after unrelated lines are inserted without marking it reviewed", () => {
    const result = relocateExistingFindings({
      existing: [existing(2)],
      changedFiles: [changedFile({ addedLines: [1] })],
      baseFiles: new Map([["src/example.ts", "function run(value) {\n  return unsafe(value);\n}"]]),
      currentFiles: new Map([["src/example.ts", "const header = true;\nfunction run(value) {\n  return unsafe(value);\n}"]])
    });

    expect(result.findings[0]?.line).toBe(3);
    expect(result.reviewedFingerprints).toEqual(new Set());
  });

  it("marks an anchor as reviewed when the old source line is replaced", () => {
    const result = relocateExistingFindings({
      existing: [existing(2)],
      changedFiles: [changedFile({ addedLines: [2], removedLines: [2] })],
      baseFiles: new Map([["src/example.ts", "function run(value) {\n  return unsafe(value);\n}"]]),
      currentFiles: new Map([["src/example.ts", "function run(value) {\n  return safe(value);\n}"]])
    });

    expect(result.findings[0]?.line).toBe(2);
    expect(result.reviewedFingerprints).toEqual(new Set(["finding"]));
  });

  it("does not guess when the anchor occurs more than once", () => {
    const result = relocateExistingFindings({
      existing: [existing(2)],
      changedFiles: [],
      currentFiles: new Map([["src/example.ts", "return unsafe(value);\nreturn unsafe(value);"]])
    });

    expect(result.findings[0]?.line).toBe(2);
  });
});
