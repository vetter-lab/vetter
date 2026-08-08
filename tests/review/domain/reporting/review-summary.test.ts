import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../../src/config/load.js";
import { syncReviewSummary } from "../../../../src/review/application/run-review.js";
import { buildFindingMarker, buildSummaryRowMarker } from "../../../../src/review/domain/reconciliation/markers.js";
import type { GitHubGateway } from "../../../../src/integrations/github/gateway.js";
import type { CheckRunInput, ReviewStateSnapshot } from "../../../../src/integrations/github/types.js";

describe("syncReviewSummary", () => {
  it("marks a manually resolved finding as suppressed without rerunning review", async () => {
    const marker = buildFindingMarker({
      fingerprint: "fingerprint-1",
      ruleId: "rule-1",
      severity: "P1",
      source: "llm",
      scopeKey: "llm:rule-1:src/example.ts",
      title: "Avoid this pattern",
      botResolved: false
    });
    const reviewState: ReviewStateSnapshot = {
      reviewThreads: [
        {
          threadId: "thread-1",
          isResolved: true,
          resolvedByLogin: "developer",
          comments: [
            {
              commentId: 7,
              htmlUrl: "https://github.com/owner/repo/pull/1#discussion_r7",
              body: marker,
              path: "src/example.ts",
              line: 12,
              authorLogin: "vetter[bot]"
            }
          ]
        }
      ],
      issueComments: []
    };
    const summaryOnlyMarker = buildSummaryRowMarker({
      fingerprint: "summary-only-1",
      severity: "P2",
      title: "Summary-only finding",
      path: "src/summary-only.ts",
      line: null,
      state: "open"
    });

    let updatedSummary = "";
    let createdSummary = false;
    const capturedCheckRun: { value: CheckRunInput | null } = { value: null };
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
        return [];
      },
      async getFileContent() {
        return null;
      },
      async listReviewState() {
        return reviewState;
      },
      async findSummaryComment() {
        return {
          commentId: 99,
          body: ["<!-- vetter:summary:v1 -->", summaryOnlyMarker].join("\n"),
          authorLogin: "vetter[bot]"
        };
      },
      async createReview() {
        return [];
      },
      async updateReviewComment() {},
      async createIssueComment() {
        createdSummary = true;
        return { commentId: 100 };
      },
      async updateIssueComment(input) {
        updatedSummary = input.body;
      },
      async deleteIssueComment() {},
      async resolveThread() {},
      async reopenThread() {},
      async upsertCheckRun(input) {
        capturedCheckRun.value = input;
      }
    };

    const result = await syncReviewSummary({
      gateway,
      context: {
        repository: { owner: "owner", name: "repo", fullName: "owner/repo" },
        pullRequestNumber: 1,
        baseSha: "base-sha",
        headSha: "head-sha",
        eventId: "comment-event",
        source: "pull_request_review_thread"
      },
      config: loadConfig({ runtime: "action" }),
      botLogins: new Set(["vetter[bot]"])
    });

    expect(result.status).toBe("completed");
    expect(updatedSummary).toContain("suppressed");
    expect(updatedSummary).toContain("src/summary-only.ts");
    expect(updatedSummary).toContain(
      "[src/example.ts:12](https://github.com/owner/repo/pull/1#discussion_r7)"
    );
    expect(createdSummary).toBe(false);
    expect(capturedCheckRun.value?.conclusion).toBe("success");
  });
});
