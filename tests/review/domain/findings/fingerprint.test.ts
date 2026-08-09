import { describe, expect, it } from "vitest";
import {
  computeFingerprint,
  deduplicateFindings,
  matchExistingFinding
} from "../../../../src/review/domain/findings/fingerprint.js";
import { normalizeFinding } from "../../../../src/review/domain/findings/normalize.js";
import type { ExistingFinding, FindingDraft } from "../../../../src/review/domain/types.js";

function makeDraft(overrides: Partial<FindingDraft> = {}): FindingDraft {
  return {
    ruleId: "no-console",
    severity: "P2",
    title: "Avoid console statements",
    body: "Remove the console.log call.",
    path: "src/example.ts",
    line: 12,
    codeAnchor: "console.log('hi');",
    source: "llm",
    scopeKey: "",
    ...overrides
  };
}

function makeExisting(overrides: Partial<ExistingFinding> = {}): ExistingFinding {
  return {
    fingerprint: "fingerprint-a",
    ruleId: "no-console",
    source: "llm",
    scopeKey: "llm:no-console:src/example.ts",
    severity: "P2",
    title: "Avoid console statements",
    body: "Remove the console.log call.",
    path: "src/example.ts",
    codeAnchor: "",
    line: 12,
    commentId: 1,
    threadId: null,
    isResolved: false,
    resolvedByLogin: null,
    lastAction: null,
    state: "open",
    ...overrides
  };
}

describe("computeFingerprint", () => {
  it("does not change when only the line number changes", () => {
    const a = computeFingerprint(makeDraft({ line: 12 }));
    const b = computeFingerprint(makeDraft({ line: 99 }));

    expect(a).toBe(b);
  });

  it("changes when the rule id changes", () => {
    const a = computeFingerprint(makeDraft());
    const b = computeFingerprint(makeDraft({ ruleId: "no-debugger" }));

    expect(a).not.toBe(b);
  });

  it("changes when the path changes", () => {
    const a = computeFingerprint(makeDraft());
    const b = computeFingerprint(makeDraft({ path: "src/other.ts" }));

    expect(a).not.toBe(b);
  });

  it("changes when the title changes", () => {
    const a = computeFingerprint(makeDraft());
    const b = computeFingerprint(makeDraft({ title: "Avoid debugger statements" }));

    expect(a).not.toBe(b);
  });
});

describe("normalizeFinding", () => {
  it("trims text, derives scopeKey, and attaches a fingerprint", () => {
    const finding = normalizeFinding(makeDraft({ title: "  Avoid console statements  ", body: "  Remove it.  " }));

    expect(finding.title).toBe("Avoid console statements");
    expect(finding.body).toBe("Remove it.");
    expect(finding.scopeKey).toBe("llm:no-console:src/example.ts");
    expect(finding.fingerprint).toBe(computeFingerprint(finding));
  });

  it("rejects an invalid severity", () => {
    expect(() => normalizeFinding(makeDraft({ severity: "blocker" as never }))).toThrow();
  });
});

describe("deduplicateFindings", () => {
  it("keeps one finding when a provider reports the same fingerprint twice", () => {
    const first = normalizeFinding(makeDraft({ line: 12 }));
    const duplicate = normalizeFinding(makeDraft({ line: 99 }));

    expect(deduplicateFindings([first, duplicate])).toEqual([first]);
  });
});

describe("matchExistingFinding", () => {
  it("matches on exact fingerprint", () => {
    const finding = normalizeFinding(makeDraft());
    const existing = [makeExisting({ fingerprint: finding.fingerprint })];

    expect(matchExistingFinding(finding, existing)).toBe(existing[0]);
  });

  it("rejects an ambiguous rule/path fallback with no exact fingerprint match", () => {
    const finding = normalizeFinding(makeDraft());
    const existing = [
      makeExisting({ fingerprint: "stale-a", commentId: 1 }),
      makeExisting({ fingerprint: "stale-b", commentId: 2 })
    ];

    expect(matchExistingFinding(finding, existing)).toBeNull();
  });

  it("falls back to an unambiguous rule/path/anchor match when no exact fingerprint match exists", () => {
    const finding = normalizeFinding(makeDraft());
    const existing = [makeExisting({ fingerprint: "stale-a", commentId: 1, codeAnchor: finding.codeAnchor })];

    expect(matchExistingFinding(finding, existing)).toBe(existing[0]);
  });

  it("does not reuse a finding when its code anchor changed", () => {
    const finding = normalizeFinding(makeDraft({ codeAnchor: "return safe(value);" }));
    const existing = [makeExisting({ fingerprint: "stale-a", commentId: 1, codeAnchor: "return unsafe(value);" })];

    expect(matchExistingFinding(finding, existing)).toBeNull();
  });

  it("does not fall back to an existing finding outside an incremental diff", () => {
    const finding = normalizeFinding(makeDraft());
    const existing = [makeExisting({ fingerprint: "stale-a", commentId: 1 })];

    expect(matchExistingFinding(finding, existing, new Set())).toBeNull();
  });

  it("uses one exact match when persisted state contains duplicate comments", () => {
    const finding = normalizeFinding(makeDraft());
    const existing = [
      makeExisting({ fingerprint: finding.fingerprint, commentId: 1 }),
      makeExisting({ fingerprint: finding.fingerprint, commentId: 2 })
    ];

    expect(matchExistingFinding(finding, existing)).toBe(existing[0]);
  });
});
