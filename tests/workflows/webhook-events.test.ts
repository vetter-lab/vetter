import { describe, expect, it } from "vitest";
import { normalizeWebhookEvent } from "../../src/runtimes/app/events.js";
import type { GitHubGateway } from "../../src/integrations/github/gateway.js";

function reviewCommentPayload(action: "created" | "edited" | "deleted") {
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
    },
    comment: {
      id: 1,
      body: "a reply on the thread"
    }
  };
}

describe("pull request review comment events", () => {
  it("normalizes a created comment to a summary context", async () => {
    const contexts = await normalizeWebhookEvent({
      eventName: "pull_request_review_comment",
      payload: reviewCommentPayload("created"),
      deliveryId: "delivery-created",
      gateway: {} as GitHubGateway,
      branchPatterns: ["**"]
    });

    expect(contexts).toEqual([
      {
        repository: { owner: "owner", name: "repo", fullName: "owner/repo" },
        pullRequestNumber: 42,
        baseSha: "base-sha",
        headSha: "head-sha",
        eventId: "delivery-created",
        source: "pull_request_review_comment"
      }
    ]);
  });

  it("ignores edited and deleted actions", async () => {
    for (const action of ["edited", "deleted"] as const) {
      const contexts = await normalizeWebhookEvent({
        eventName: "pull_request_review_comment",
        payload: reviewCommentPayload(action),
        deliveryId: "delivery-" + action,
        gateway: {} as GitHubGateway,
        branchPatterns: ["**"]
      });

      expect(contexts).toEqual([]);
    }
  });
});
