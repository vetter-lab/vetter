import type { FindingDraft } from "../../review/domain/types.js";

/**
 * Input to a `ModelProvider`. `diff` and `contextFiles` originate from the
 * repository under review and must be treated as untrusted content by any
 * implementation: they are data to analyze, never instructions to follow.
 */
export interface ModelReviewInput {
  diff: string;
  contextFiles: Array<{ path: string; content: string }>;
  model: string;
}

export interface ModelReviewResult {
  findings: FindingDraft[];
  scopeKeys: string[];
}

/**
 * A ModelProvider sends the diff (plus optional read-only context files) to
 * an LLM and returns structured findings. Implementations must redact
 * secret-shaped values (private keys, bearer tokens, API-key patterns)
 * before any repository text leaves the process, and must label repository
 * text as untrusted within the constructed prompt.
 *
 * On success, `scopeKeys` lists the provider-scoped keys (formatted
 * `llm:<path>`) that were fully reviewed this run, so callers can safely
 * close stale findings for those paths. On failure, implementations should
 * reject/throw rather than return a partial result, so callers never treat
 * an incomplete review as having closed any scope.
 */
export interface ModelProvider {
  review(input: ModelReviewInput): Promise<ModelReviewResult>;
}
