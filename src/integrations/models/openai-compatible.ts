import OpenAI from "openai";
import { findReviewAnchor } from "../../review/domain/diff/anchor.js";
import { parseChangedFiles } from "../../review/domain/diff/parser.js";
import type { FindingDraft } from "../../review/domain/types.js";
import { modelResponseSchema } from "./review-contract.js";
import type { ModelProvider, ModelReviewInput, ModelReviewResult } from "./model.js";
import { buildReviewPrompt } from "./prompts/review/index.js";

export interface OpenAiCompatibleConfig {
  apiKey: string;
  baseURL?: string;
  /** Maximum number of retries after the first attempt (config's `limits.modelRetries`). */
  maxRetries: number;
}

/**
 * Minimal shape of the OpenAI chat-completions request/response this
 * provider depends on. Kept intentionally narrow (rather than the full
 * `openai` SDK types) so tests can supply a fake implementation without
 * constructing a real `OpenAI` client.
 */
export type ChatCompletionCreator = (params: {
  model: string;
  temperature: number;
  response_format: { type: "json_object" };
  messages: Array<{ role: "system" | "user"; content: string }>;
}) => Promise<{ choices: Array<{ message: { content: string | null } }> }>;

/**
 * Structured, OpenAI-compatible `ModelProvider`. Sends the redacted,
 * untrusted-labeled prompt built by `buildReviewPrompt`, requests
 * `temperature: 0` and `response_format: { type: "json_object" }`, and
 * validates the parsed response against `modelResponseSchema`.
 *
 * Malformed JSON, schema or diff-anchor validation failures, and provider
 * errors are retried up to `config.maxRetries` additional times. If every
 * attempt fails, the returned promise rejects and no scope is reported as
 * completed, so callers never close existing findings based on a review that
 * never produced valid output.
 */
export function createOpenAiCompatibleModelProvider(
  config: OpenAiCompatibleConfig,
  createChatCompletion?: ChatCompletionCreator
): ModelProvider {
  const client = createChatCompletion
    ? null
    : new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });

  const createCompletion: ChatCompletionCreator =
    createChatCompletion ??
    ((params) => client!.chat.completions.create(params) as unknown as ReturnType<ChatCompletionCreator>);

  return {
    async review(input: ModelReviewInput): Promise<ModelReviewResult> {
      const prompt = buildReviewPrompt(input);
      const changedFiles = parseChangedFiles([input.diff]);
      const scopeKeys = changedFiles.map((file) => `llm:${file.path}`);
      const totalAttempts = config.maxRetries + 1;
      let lastError: unknown;

      for (let attempt = 0; attempt < totalAttempts; attempt++) {
        try {
          const completion = await createCompletion({
            model: input.model,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user }
            ]
          });

          const content = completion.choices[0]?.message.content;
          if (content === null || content === undefined) {
            throw new Error("model response contained no message content");
          }

          const parsedJson: unknown = JSON.parse(content);
          const parsed = modelResponseSchema.parse(parsedJson);

          const anchoredFindings = parsed.findings.map((finding) => {
            const anchor = findReviewAnchor(changedFiles, finding.path, finding.line, {
              codeAnchor: finding.codeAnchor,
              requireCodeAnchor: true
            });
            if (!anchor) {
              throw new Error(
                `model finding code anchor does not match an unambiguous added line: ${finding.path}:${String(finding.line)}`
              );
            }
            return { finding, line: anchor.line };
          });

          const findings: FindingDraft[] = anchoredFindings.map(({ finding, line }) => ({
            ruleId: finding.ruleId,
            severity: finding.severity,
            title: finding.title,
            body: finding.body,
            path: finding.path,
            line,
            codeAnchor: finding.codeAnchor,
            source: "llm",
            scopeKey: `llm:${finding.ruleId}:${finding.path}`
          }));

          return { findings, scopeKeys };
        } catch (error) {
          lastError = error;
        }
      }

      throw new Error(
        `model provider failed after ${String(totalAttempts)} attempt(s): ${String(lastError)}`
      );
    }
  };
}
