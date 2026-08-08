import { describe, expect, it } from "vitest";
import { normalizeWebhookEvent } from "../../src/runtimes/app/events.js";
import type { GitHubGateway } from "../../src/integrations/github/gateway.js";

function reviewThreadPayload(action: "resolved" | "unresolved") {
  return {
    action,
    repository: {
      owner: { login: "owner" },
      name: "repo",
      full_name: "owner/repo"
    },
    pull_request: {
      number: 42,
      base: { sha: "base-sha" },
      head: { sha: "head-sha" }
    }
  };
}

describe("pull request review thread events", () => {
  it("normalizes resolved and unresolved actions to summary contexts", async () => {
    for (const action of ["resolved", "unresolved"] as const) {
      const contexts = await normalizeWebhookEvent({
        eventName: "pull_request_review_thread",
        payload: reviewThreadPayload(action),
        deliveryId: "delivery-" + action,
        gateway: {} as GitHubGateway,
        branchPatterns: ["**"]
      });

      expect(contexts).toEqual([
        {
          repository: { owner: "owner", name: "repo", fullName: "owner/repo" },
          pullRequestNumber: 42,
          baseSha: "base-sha",
          headSha: "head-sha",
          eventId: "delivery-" + action,
          source: "pull_request_review_thread"
        }
      ]);
    }
  });
});

describe("incremental review events", () => {
  it("uses the synchronize before SHA as the incremental diff base", async () => {
    const contexts = await normalizeWebhookEvent({
      eventName: "pull_request",
      payload: {
        action: "synchronize",
        number: 42,
        before: "previous-sha",
        after: "head-sha",
        repository: {
          owner: { login: "owner" },
          name: "repo",
          full_name: "owner/repo"
        },
        pull_request: {
          number: 42,
          base: { sha: "base-sha" },
          head: { sha: "head-sha" }
        }
      },
      deliveryId: "delivery-sync",
      gateway: {} as GitHubGateway,
      branchPatterns: ["**"]
    });

    expect(contexts[0]).toMatchObject({
      baseSha: "base-sha",
      headSha: "head-sha",
      reviewBaseSha: "previous-sha"
    });
  });

  it("uses the push before and after SHAs for an open pull request", async () => {
    const contexts = await normalizeWebhookEvent({
      eventName: "push",
      payload: {
        deleted: false,
        ref: "refs/heads/feature",
        before: "previous-sha",
        after: "head-sha",
        repository: {
          owner: { login: "owner" },
          name: "repo",
          full_name: "owner/repo"
        }
      },
      deliveryId: "delivery-push",
      gateway: {
        async findOpenPullRequestsForHead() {
          return [
            {
              number: 42,
              state: "open",
              headSha: "head-sha",
              headRef: "feature",
              baseSha: "base-sha",
              baseRef: "main"
            }
          ];
        }
      } as unknown as GitHubGateway,
      branchPatterns: ["**"]
    });

    expect(contexts[0]).toMatchObject({
      baseSha: "base-sha",
      headSha: "head-sha",
      reviewBaseSha: "previous-sha"
    });
  });
});
