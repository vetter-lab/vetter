import type { ModelReviewInput } from "../../model.js";
import { buildSystemPrompt } from "./system.js";
import { buildUserPrompt } from "./user.js";

export interface ReviewPrompt {
  system: string;
  user: string;
}

export function buildReviewPrompt(input: ModelReviewInput): ReviewPrompt {
  return {
    system: buildSystemPrompt(),
    user: buildUserPrompt(input)
  };
}
