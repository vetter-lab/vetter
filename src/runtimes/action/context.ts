import type { GitHubGateway } from "../../integrations/github/gateway.js";
import type { ReviewContext } from "../../review/domain/types.js";
import { normalizeWebhookEvent } from "../app/events.js";

export interface NormalizeActionEventInput {
  eventName: string;
  payload: unknown;
  runId: string;
  gateway: GitHubGateway;
  branchPatterns: string[];
}

/**
 * Normalizes the Action's triggering event into the same `ReviewContext[]`
 * the App runtime produces. GitHub Actions' `context.payload` is the exact
 * webhook payload for the triggering event, so this delegates directly to
 * `normalizeWebhookEvent` rather than re-implementing the pull_request/push
 * handling (design doc section 10: "Convert App Webhook and Action payloads
 * into the same ReviewContext").
 */
export async function normalizeActionEvent(input: NormalizeActionEventInput): Promise<ReviewContext[]> {
  return normalizeWebhookEvent({
    eventName: input.eventName,
    payload: input.payload,
    deliveryId: input.runId,
    gateway: input.gateway,
    branchPatterns: input.branchPatterns
  });
}
