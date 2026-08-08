import { expect, it } from "vitest";
import { loadConfig } from "../../../src/config/load.js";
import type { GitHubGateway } from "../../../src/integrations/github/gateway.js";
import { parseSummaryRowMarkers, buildFindingMarker } from "../../../src/review/domain/reconciliation/markers.js";
import { computeFingerprint } from "../../../src/review/domain/findings/fingerprint.js";
import { runReview } from "../../../src/review/application/run-review.js";
import type { FindingDraft } from "../../../src/review/domain/types.js";

const patch = ["@@ -1,3 +1,3 @@", " keep", "-old", "+new", " tail"].join("\n");

function finding(ruleId: string, title: string): FindingDraft {
  return {
    ruleId,
    severity: "P1",
    title,
    body: `${title} body`,
    path: "src/example.ts",
    line: 2,
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
    botResolved
  });
}

it("refreshes manual suppression and fixes an outdated finding in one commit run", async () => {
  const manual = finding("manual-rule", "Manually suppressed");
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
    analyzerProviders: [],
    botLogins: new Set(["github-actions[bot]"]),
    repositoryPath: "/tmp/repository",
    contextFiles: []
  });

  expect(result.status).toBe("completed");
  expect(resolvedThreads).toEqual(["fixed-thread"]);
  const rows = parseSummaryRowMarkers(summaryBody);
  expect(rows.find((row) => row.fingerprint === computeFingerprint(manual))?.state).toBe("suppressed");
  expect(rows.find((row) => row.fingerprint === computeFingerprint(fixed))?.state).toBe("fixed");
});
