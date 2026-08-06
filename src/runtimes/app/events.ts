import type {
  PullRequestOpenedEvent,
  PullRequestReopenedEvent,
  PullRequestSynchronizeEvent,
  PushEvent
} from "@octokit/webhooks-types";
import { matchesAnyBranchPattern } from "../../core/branch-pattern.js";
import type { ReviewContext } from "../../core/types.js";
import type { GitHubGateway } from "../../github/gateway.js";

type PullRequestEventPayload =
  | PullRequestOpenedEvent
  | PullRequestReopenedEvent
  | PullRequestSynchronizeEvent;

const SUPPORTED_PULL_REQUEST_ACTIONS = new Set(["opened", "reopened", "synchronize"]);

export interface NormalizeWebhookEventInput {
  eventName: string;
  payload: unknown;
  deliveryId: string;
  gateway: GitHubGateway;
  branchPatterns: string[];
}

function toReviewContext(input: {
  owner: string;
  name: string;
  fullName: string;
  pullRequestNumber: number;
  baseSha: string;
  headSha: string;
  eventId: string;
  source: "pull_request" | "push";
}): ReviewContext {
  return {
    repository: { owner: input.owner, name: input.name, fullName: input.fullName },
    pullRequestNumber: input.pullRequestNumber,
    baseSha: input.baseSha,
    headSha: input.headSha,
    eventId: input.eventId,
    source: input.source
  };
}

function normalizePullRequestEvent(payload: PullRequestEventPayload, deliveryId: string): ReviewContext[] {
  if (!SUPPORTED_PULL_REQUEST_ACTIONS.has(payload.action)) {
    return [];
  }

  return [
    toReviewContext({
      owner: payload.repository.owner.login,
      name: payload.repository.name,
      fullName: payload.repository.full_name,
      pullRequestNumber: payload.number,
      baseSha: payload.pull_request.base.sha,
      headSha: payload.pull_request.head.sha,
      eventId: deliveryId,
      source: "pull_request"
    })
  ];
}

async function normalizePushEvent(
  payload: PushEvent,
  deliveryId: string,
  gateway: GitHubGateway,
  branchPatterns: string[]
): Promise<ReviewContext[]> {
  if (payload.deleted) {
    return [];
  }

  const branchMatch = /^refs\/heads\/(.+)$/.exec(payload.ref);
  if (!branchMatch) {
    return [];
  }
  const branch = branchMatch[1] as string;

  if (!matchesAnyBranchPattern(branch, branchPatterns)) {
    return [];
  }

  const openPullRequests = await gateway.findOpenPullRequestsForHead({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    branch
  });

  return openPullRequests.map((pullRequest) =>
    toReviewContext({
      owner: payload.repository.owner.login,
      name: payload.repository.name,
      fullName: payload.repository.full_name,
      pullRequestNumber: pullRequest.number,
      baseSha: pullRequest.baseSha,
      headSha: pullRequest.headSha,
      eventId: `${deliveryId}:${String(pullRequest.number)}`,
      source: "push"
    })
  );
}

/**
 * Normalizes a verified GitHub webhook delivery into zero or more
 * `ReviewContext`s. A push event resolves to the open PRs on its branch
 * (one context per PR) and produces none when no open PR matches, so the
 * caller never runs a review for a push with no PR (design doc section 4).
 * Any event that isn't a supported pull_request action or a push produces
 * no work.
 */
export async function normalizeWebhookEvent(input: NormalizeWebhookEventInput): Promise<ReviewContext[]> {
  if (input.eventName === "pull_request") {
    return normalizePullRequestEvent(input.payload as PullRequestEventPayload, input.deliveryId);
  }

  if (input.eventName === "push") {
    return normalizePushEvent(input.payload as PushEvent, input.deliveryId, input.gateway, input.branchPatterns);
  }

  return [];
}
