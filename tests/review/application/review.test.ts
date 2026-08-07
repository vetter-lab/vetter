import { expect, test } from "vitest";
import { loadConfig } from "../../../src/config/load.js";
import { runReview } from "../../../src/review/application/run-review.js";
import type { GitHubGateway } from "../../../src/integrations/github/gateway.js";
import type { ModelProvider } from "../../../src/integrations/models/model.js";

test("passes file headers and paths to the model provider", async () => {
  const patch = ["@@ -20,2 +20,3 @@", " old", "+new", " end"].join("\n");
  let receivedDiff = "";
  const modelProvider: ModelProvider = {
    async review(input) {
      receivedDiff = input.diff;
      return { findings: [], scopeKeys: [] };
    }
  };
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
      return [{ path: ".github/workflows/vetter-action.yml", status: "modified", patch }];
    },
    async getFileContent() {
      return null;
    },
    async listReviewState() {
      return { reviewThreads: [], issueComments: [] };
    },
    async findSummaryComment() {
      return null;
    },
    async createReview() {},
    async updateReviewComment() {},
    async createIssueComment() {
      return { commentId: 1 };
    },
    async updateIssueComment() {},
    async deleteIssueComment() {},
    async resolveThread() {},
    async reopenThread() {},
    async upsertCheckRun() {}
  };

  await runReview({
    gateway,
    context: {
      repository: { owner: "vetter-lab", name: "demo", fullName: "vetter-lab/demo" },
      pullRequestNumber: 1,
      baseSha: "base-sha",
      headSha: "head-sha",
      eventId: "event-1",
      source: "pull_request"
    },
    config: loadConfig({ runtime: "action" }),
    modelProvider,
    analyzerProviders: [],
    botLogins: new Set(["github-actions[bot]"]),
    repositoryPath: "/tmp/repository",
    contextFiles: []
  });

  expect(receivedDiff).toBe(
    [
      "diff --git a/.github/workflows/vetter-action.yml b/.github/workflows/vetter-action.yml",
      "--- a/.github/workflows/vetter-action.yml",
      "+++ b/.github/workflows/vetter-action.yml",
      patch
    ].join("\n")
  );
});
