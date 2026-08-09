import { expect, it } from "vitest";
import { loadConfig } from "../../../src/config/load.js";
import type { GitHubGateway } from "../../../src/integrations/github/gateway.js";
import { parseSummaryRowMarkers, buildFindingMarker } from "../../../src/review/domain/reconciliation/markers.js";
import { computeFingerprint } from "../../../src/review/domain/findings/fingerprint.js";
import { runReview } from "../../../src/review/application/run-review.js";
import type { FindingDraft } from "../../../src/review/domain/types.js";

const patch = ["@@ -1,3 +1,3 @@", " keep", "-old", "+new", " tail"].join("\n");

function finding(ruleId: string, title: string, line = 2): FindingDraft {
  return {
    ruleId,
    severity: "P1",
    title,
    body: `${title} body`,
    path: "src/example.ts",
    line,
    codeAnchor: "new",
    source: "llm",
    scopeKey: `llm:${ruleId}:src/example.ts`
  };
}

function existingMarker(input: FindingDraft, botResolved: boolean): string {
  return buildFindingMarker({
    fingerprint: computeFingerprint(input),
    ruleId: input.ruleId,
    severity: input.severity,
    source: input.source,
    scopeKey: input.scopeKey,
    title: input.title,
    codeAnchor: input.codeAnchor,
    botResolved
  });
}

it("refreshes manual dismissal and fixes an outdated finding in one commit run", async () => {
  const manual = finding("manual-rule", "Manually dismissed", 3);
  const fixed = finding("fixed-rule", "Already fixed");
  let summaryBody = "";
  const resolvedThreads: string[] = [];
  const gateway: GitHubGateway = {
    async getPullRequest() {
      return {
        number: 1,
        state: "open",
        headSha: "head-sha",
        headRef: "feature",
        baseSha: "base-sha",
        baseRef: "main"
      };
    },
    async findOpenPullRequestsForHead() {
      return [];
    },
    async listChangedFiles() {
      return [{ path: "src/example.ts", status: "modified", patch }];
    },
    async getFileContent() {
      return null;
    },
    async listReviewState() {
      return {
        reviewThreads: [
          {
            threadId: "manual-thread",
            isResolved: true,
            resolvedByLogin: "developer",
            comments: [
              {
                commentId: 1,
                body: existingMarker(manual, false),
                path: manual.path,
                line: 2,
                originalLine: 2,
                authorLogin: "github-actions"
              }
            ]
          },
          {
            threadId: "fixed-thread",
            isResolved: false,
            resolvedByLogin: null,
            comments: [
              {
                commentId: 2,
                body: existingMarker(fixed, false),
                path: fixed.path,
                line: null,
                originalLine: 2,
                authorLogin: "github-actions"
              }
            ]
          }
        ],
        issueComments: []
      };
    },
    async findSummaryComment() {
      return null;
    },
    async createReview() {
      return [];
    },
    async updateReviewComment() {},
    async createIssueComment(input) {
      summaryBody = input.body;
      return { commentId: 3 };
    },
    async updateIssueComment(input) {
      summaryBody = input.body;
    },
    async deleteIssueComment() {},
    async resolveThread(input) {
      resolvedThreads.push(input.threadId);
    },
    async reopenThread() {},
    async upsertCheckRun() {}
  };

  const result = await runReview({
    gateway,
    context: {
      repository: { owner: "owner", name: "repo", fullName: "owner/repo" },
      pullRequestNumber: 1,
      baseSha: "base-sha",
      headSha: "head-sha",
      eventId: "event-1",
      source: "pull_request"
    },
    config: loadConfig({ runtime: "action" }),
    modelProvider: {
      async review() {
        return { findings: [manual], scopeKeys: ["llm:src/example.ts"] };
      }
    },
    botLogins: new Set(["github-actions[bot]"]),
    contextFiles: []
  });

  expect(result.status).toBe("completed");
  expect(resolvedThreads).toEqual(["fixed-thread"]);
  const rows = parseSummaryRowMarkers(summaryBody);
  expect(rows.find((row) => row.fingerprint === computeFingerprint(manual))).toEqual(
    expect.objectContaining({ line: 2, state: "dismissed" })
  );
  expect(rows.find((row) => row.fingerprint === computeFingerprint(fixed))?.state).toBe("fixed");
});

it("relocates an unchanged finding after an unrelated insertion without closing it", async () => {
  const moved = finding("moved-rule", "Moved finding", 2);
  moved.codeAnchor = "return unsafe(value);";
  const previousContent = ["function run(value) {", "  return unsafe(value);", "}"].join("\n");
  const currentContent = ["const header = true;", previousContent].join("\n");
  const insertionPatch = [
    "@@ -1,3 +1,4 @@",
    "+const header = true;",
    " function run(value) {",
    "   return unsafe(value);",
    " }"
  ].join("\n");
  let summaryBody = "";
  const resolvedThreads: string[] = [];
  const gateway: GitHubGateway = {
    async getPullRequest() {
      return {
        number: 1,
        state: "open",
        headSha: "head-sha",
        headRef: "feature",
        baseSha: "base-sha",
        baseRef: "main"
      };
    },
    async findOpenPullRequestsForHead() {
      return [];
    },
    async listChangedFiles() {
      return [{ path: moved.path, status: "modified", patch: insertionPatch }];
    },
    async getFileContent(input) {
      return input.ref === "previous-sha" ? previousContent : currentContent;
    },
    async listReviewState() {
      return {
        reviewThreads: [
          {
            threadId: "moved-thread",
            isResolved: false,
            resolvedByLogin: null,
            comments: [
              {
                commentId: 7,
                body: existingMarker(moved, false),
                path: moved.path,
                line: null,
                originalLine: 2,
                authorLogin: "github-actions"
              }
            ]
          }
        ],
        issueComments: []
      };
    },
    async findSummaryComment() {
      return null;
    },
    async createReview() {
      return [];
    },
    async updateReviewComment() {},
    async createIssueComment(input) {
      summaryBody = input.body;
      return { commentId: 8 };
    },
    async updateIssueComment(input) {
      summaryBody = input.body;
    },
    async deleteIssueComment() {},
    async resolveThread(input) {
      resolvedThreads.push(input.threadId);
    },
    async reopenThread() {},
    async upsertCheckRun() {}
  };

  const result = await runReview({
    gateway,
    context: {
      repository: { owner: "owner", name: "repo", fullName: "owner/repo" },
      pullRequestNumber: 1,
      baseSha: "base-sha",
      headSha: "head-sha",
      reviewBaseSha: "previous-sha",
      eventId: "event-1",
      source: "pull_request"
    },
    config: loadConfig({ runtime: "action" }),
    modelProvider: {
      async review() {
        return { findings: [], scopeKeys: ["llm:src/example.ts"] };
      }
    },
    botLogins: new Set(["github-actions[bot]"]),
    contextFiles: []
  });

  expect(result.status).toBe("completed");
  expect(resolvedThreads).toEqual([]);
  expect(parseSummaryRowMarkers(summaryBody).find((row) => row.fingerprint === computeFingerprint(moved))).toEqual(
    expect.objectContaining({ line: 3, state: "open" })
  );
});
