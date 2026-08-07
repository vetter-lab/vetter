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
