import { expect, it } from "vitest";
import { loadConfig } from "../../../src/config/load.js";
import type { GitHubGateway } from "../../../src/integrations/github/gateway.js";
import type { ModelProvider } from "../../../src/integrations/models/model.js";
import { runReview } from "../../../src/review/application/run-review.js";
import { computeFingerprint } from "../../../src/review/domain/findings/fingerprint.js";
import { buildSummaryRowMarker } from "../../../src/review/domain/reconciliation/markers.js";
import type { FindingDraft } from "../../../src/review/domain/types.js";

const patch = ["@@ -1,3 +1,4 @@", " old", "+new", " end"].join("\n");

function makeFinding(ruleId: string, title: string, line: number): FindingDraft {
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

function summaryRow(fingerprint: string, title: string, state: "open" | "fixed" | "dismissed", line: number): string {
  return buildSummaryRowMarker({
    fingerprint,
    severity: "P1",
    title,
    path: "src/example.ts",
    line,
    state
  });
}

it("preserves summary state when a cancelled run omitted old threads from its snapshot", async () => {
  const currentFindings = [makeFinding("current-a", "Current A", 2), makeFinding("current-b", "Current B", 3)];
  const summaryBody = [
    "<!-- vetter:summary:v1 -->",
    summaryRow("dismissed-fingerprint", "Manually dismissed", "dismissed", 4),
    summaryRow("fixed-fingerprint", "Already fixed", "fixed", 5),
    summaryRow(computeFingerprint(currentFindings[0]!), "Current A", "open", 2),
    summaryRow(computeFingerprint(currentFindings[1]!), "Current B", "open", 3)
  ].join("\n");
  let createdReviewComments = 0;
  let updatedSummary = "";
  const modelProvider: ModelProvider = {
    async review() {
      return { findings: currentFindings, scopeKeys: ["llm:src/example.ts"] };
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
      return { commentId: 9, body: summaryBody, authorLogin: "github-actions[bot]" };
    },
    async createReview(input) {
      createdReviewComments = input.comments.length;
      return [];
    },
    async updateReviewComment() {},
    async createIssueComment(input) {
      updatedSummary = input.body;
      return { commentId: 10 };
    },
    async updateIssueComment(input) {
      updatedSummary = input.body;
    },
    async deleteIssueComment() {},
    async resolveThread() {},
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
    modelProvider,
    botLogins: new Set(["github-actions[bot]"]),
    contextFiles: []
  });

  expect(result.status).toBe("completed");
  expect(result.status === "completed" ? result.rows : []).toHaveLength(4);
  expect(createdReviewComments).toBe(0);
  expect(updatedSummary.match(/vetter:summary-row:v1/g)).toHaveLength(4);
  expect(updatedSummary).toContain("dismissed");
  expect(updatedSummary).toContain("fixed");
});
