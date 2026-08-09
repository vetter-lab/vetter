import { describe, expect, it } from "vitest";
import { toExistingFindings } from "../../../src/review/application/review-state.js";
import { buildFindingMarker } from "../../../src/review/domain/reconciliation/markers.js";

function marker(botResolved: boolean): string {
  return buildFindingMarker({
    fingerprint: "same-fingerprint",
    ruleId: "same-rule",
    severity: "P1",
    source: "llm",
    scopeKey: "llm:same-rule:src/example.ts",
    title: "Same finding",
    codeAnchor: "return unsafe(value);",
    botResolved
  });
}

describe("toExistingFindings", () => {
  it("prefers a human-dismissed duplicate over an open duplicate", () => {
    const findings = toExistingFindings(
      {
        reviewThreads: [
          {
            threadId: "open-thread",
            isResolved: false,
            resolvedByLogin: null,
            comments: [
              {
                commentId: 1,
                body: marker(false),
                path: "src/example.ts",
                line: 2,
                originalLine: 2,
                authorLogin: "github-actions[bot]"
              }
            ]
          },
          {
            threadId: "dismissed-thread",
            isResolved: true,
            resolvedByLogin: "developer",
            comments: [
              {
                commentId: 2,
                body: marker(false),
                path: "src/example.ts",
                line: 2,
                originalLine: 2,
                authorLogin: "github-actions[bot]"
              }
            ]
          }
        ],
        issueComments: []
      },
      new Set(["github-actions[bot]"])
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.commentId).toBe(2);
    expect(findings[0]?.state).toBe("dismissed");
  });

  it("uses originalLine for outdated comments and recognizes GraphQL bot logins", () => {
    const findings = toExistingFindings(
      {
        reviewThreads: [
          {
            threadId: "fixed-thread",
            isResolved: true,
            resolvedByLogin: "github-actions",
            comments: [
              {
                commentId: 3,
                body: marker(true),
                path: "src/example.ts",
                line: null,
                originalLine: 25,
                authorLogin: "github-actions"
              }
            ]
          }
        ],
        issueComments: []
      },
      new Set(["github-actions[bot]"])
    );

    expect(findings[0]).toEqual(expect.objectContaining({ line: 25, state: "fixed" }));
  });
});
