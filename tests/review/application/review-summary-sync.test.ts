import { expect, it } from "vitest";
import { loadConfig } from "../../../src/config/load.js";
import type { GitHubGateway } from "../../../src/integrations/github/gateway.js";
import { syncReviewSummary } from "../../../src/review/application/run-review.js";
import { buildFindingMarker, parseSummaryRowMarkers } from "../../../src/review/domain/reconciliation/markers.js";
import { computeFingerprint } from "../../../src/review/domain/findings/fingerprint.js";
import type { FindingDraft } from "../../../src/review/domain/types.js";

it("relocates a manually resolved finding during summary-only sync", async () => {
  const finding: FindingDraft = {
    ruleId: "manual-rule",
    severity: "P1",
    title: "Manually suppressed",
    body: "Review this unsafe call.",
    path: "src/example.ts",
    line: 2,
    codeAnchor: "return unsafe(value);",
    source: "llm",
    scopeKey: "llm:manual-rule:src/example.ts"
  };
  const marker = buildFindingMarker({
    fingerprint: computeFingerprint(finding),
    ruleId: finding.ruleId,
    severity: finding.severity,
    source: finding.source,
    scopeKey: finding.scopeKey,
    title: finding.title,
    codeAnchor: finding.codeAnchor,
    botResolved: false
  });
  const currentContent = ["const header = true;", "function run(value) {", "  return unsafe(value);", "}"].join("\n");
  let summaryBody = "";
  const gateway: GitHubGateway = {
    async getPullRequest() {
      return { number: 1, state: "open", headSha: "head-sha", headRef: "feature", baseSha: "base-sha", baseRef: "main" };
    },
    async findOpenPullRequestsForHead() {
      return [];
    },
    async listChangedFiles() {
      return [];
    },
    async getFileContent() {
      return currentContent;
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
                commentId: 7,
                body: marker,
                path: finding.path,
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
      return { commentId: 8, body: "<!-- vetter:summary:v1 -->", authorLogin: "github-actions[bot]" };
    },
    async createReview() {
      return [];
    },
    async updateReviewComment() {},
    async createIssueComment() {
      return { commentId: 9 };
    },
    async updateIssueComment(input) {
      summaryBody = input.body;
    },
    async deleteIssueComment() {},
    async resolveThread() {
      throw new Error("manual thread must not be resolved");
    },
    async reopenThread() {
      throw new Error("manual thread must not be reopened");
    },
    async upsertCheckRun() {}
  };

  const result = await syncReviewSummary({
    gateway,
    context: {
      repository: { owner: "owner", name: "repo", fullName: "owner/repo" },
      pullRequestNumber: 1,
      baseSha: "base-sha",
      headSha: "head-sha",
      eventId: "event-1",
      source: "pull_request_review_thread"
    },
    config: loadConfig({ runtime: "app" }),
    botLogins: new Set(["github-actions[bot]"])
  });

  expect(result.status).toBe("completed");
  expect(parseSummaryRowMarkers(summaryBody)).toEqual([
    expect.objectContaining({ fingerprint: computeFingerprint(finding), line: 3, state: "suppressed" })
  ]);
});
