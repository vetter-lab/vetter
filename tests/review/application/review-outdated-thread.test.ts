import { expect, it } from "vitest";
import { loadConfig } from "../../../src/config/load.js";
import type { GitHubGateway } from "../../../src/integrations/github/gateway.js";
import { buildFindingMarker, parseSummaryRowMarkers } from "../../../src/review/domain/reconciliation/markers.js";
import { runReview } from "../../../src/review/application/run-review.js";
import type { FindingDraft } from "../../../src/review/domain/types.js";

const oldContent = "first\nstale source\ntail";
const currentContent = "first\nnew source\ntail";
const patch = ["@@ -1,3 +1,3 @@", " first", "-stale source", "+new source", " tail"].join("\n");

function finding(input: Pick<FindingDraft, "codeAnchor" | "line">): FindingDraft {
  return {
    ruleId: "same-rule",
    severity: "P1",
    title: "Same rule finding",
    body: "The current source still violates the rule.",
    path: "src/example.yml",
    line: input.line,
    codeAnchor: input.codeAnchor,
    source: "semgrep",
    scopeKey: "semgrep:same-rule:src/example.yml"
  };
}

it("resolves an outdated fixed thread and creates a new same-rule finding", async () => {
  const oldFinding = finding({ codeAnchor: "stale provider anchor", line: 2 });
  const currentFinding = finding({ codeAnchor: "new source", line: 2 });
  const oldMarker = buildFindingMarker({
    fingerprint: "old-fingerprint",
    ruleId: oldFinding.ruleId,
    severity: oldFinding.severity,
    source: oldFinding.source,
    scopeKey: oldFinding.scopeKey,
    title: oldFinding.title,
    codeAnchor: oldFinding.codeAnchor,
    botResolved: false
  });
  const resolvedThreads: string[] = [];
  const createdComments: string[] = [];
  let summaryBody = "";

  const gateway: GitHubGateway = {
    async getPullRequest() {
      return {
        number: 20,
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
      return [{ path: oldFinding.path, status: "modified", patch }];
    },
    async getFileContent(input) {
      if (input.ref === "review-base-sha") {
        return oldContent;
      }
      return currentContent;
    },
    async listReviewState() {
      return {
        reviewThreads: [
          {
            threadId: "outdated-old-thread",
            isResolved: false,
            resolvedByLogin: null,
            comments: [
              {
                commentId: 3743260140,
                body: `Old finding\n\n${oldMarker}`,
                path: oldFinding.path,
                line: null,
                originalLine: 2,
                authorLogin: "github-actions[bot]"
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
    async createReview(input) {
      createdComments.push(...input.comments.map((comment) => comment.body));
      return input.comments.map((_, index) => ({ commentId: 500 + index }));
    },
    async updateReviewComment() {},
    async createIssueComment(input) {
      summaryBody = input.body;
      return { commentId: 600 };
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
      pullRequestNumber: 20,
      baseSha: "base-sha",
      headSha: "head-sha",
      reviewBaseSha: "review-base-sha",
      eventId: "event-20",
      source: "pull_request"
    },
    config: loadConfig({ runtime: "action" }),
    modelProvider: {
      async review() {
        return { findings: [], scopeKeys: [] };
      }
    },
    analyzerProviders: [
      {
        name: "semgrep",
        async run() {
          return { findings: [currentFinding], completedScopes: ["semgrep:src/example.yml"] };
        }
      }
    ],
    botLogins: new Set(["github-actions[bot]"]),
    repositoryPath: "/tmp/repository",
    contextFiles: []
  });

  expect(result.status).toBe("completed");
  expect(resolvedThreads).toEqual(["outdated-old-thread"]);
  expect(createdComments).toHaveLength(1);
  expect(parseSummaryRowMarkers(summaryBody)).toEqual([
    expect.objectContaining({ fingerprint: expect.any(String), state: "open" }),
    expect.objectContaining({ fingerprint: "old-fingerprint", state: "fixed" })
  ]);
});
