import { expect, test } from "vitest";
import { loadConfig } from "../../../src/config/load.js";
import { runReview } from "../../../src/review/application/run-review.js";
import type { GitHubGateway } from "../../../src/integrations/github/gateway.js";
import type { ModelProvider } from "../../../src/integrations/models/model.js";
import type { FindingDraft } from "../../../src/review/domain/types.js";

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
    async createReview() {
      return [];
    },
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

test("does not create duplicate inline comments for duplicate findings", async () => {
  const patch = ["@@ -1,2 +1,3 @@", " old", "+new", " end"].join("\n");
  const finding: FindingDraft = {
    ruleId: "duplicate-rule",
    severity: "P1",
    title: "Repeated finding",
    body: "This finding was returned twice.",
    path: "src/example.ts",
    line: 2,
    codeAnchor: "new",
    source: "llm",
    scopeKey: "llm:duplicate-rule:src/example.ts"
  };
  let createdCommentCount = 0;
  const modelProvider: ModelProvider = {
    async review() {
      return { findings: [finding, finding], scopeKeys: ["llm:src/example.ts"] };
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
      return [{ path: "src/example.ts", status: "modified", patch }];
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
    async createReview(input) {
      createdCommentCount = input.comments.length;
      return [];
    },
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

  expect(createdCommentCount).toBe(1);
});

test("backfills newly created comment ids into the summary link", async () => {
  const patch = ["@@ -1,2 +1,3 @@", " old", "+new", " end"].join("\n");
  const finding: FindingDraft = {
    ruleId: "link-rule",
    severity: "P1",
    title: "Linkable finding",
    body: "Body text.",
    path: "src/example.ts",
    line: 2,
    codeAnchor: "new",
    source: "llm",
    scopeKey: "llm:link-rule:src/example.ts"
  };
  let summaryBody = "";
  const modelProvider: ModelProvider = {
    async review() {
      return { findings: [finding], scopeKeys: ["llm:src/example.ts"] };
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
      return [{ path: "src/example.ts", status: "modified", patch }];
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
    async createReview() {
      return [{ commentId: 42 }];
    },
    async updateReviewComment() {},
    async createIssueComment(input) {
      summaryBody = input.body;
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

  expect(summaryBody).toContain("[#42](https://github.com/vetter-lab/demo/pull/1#discussion_r42)");
});
