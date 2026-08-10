import { deepMerge } from "../../config/merge.js";
import { loadConfig, parseConfigYaml } from "../../config/load.js";
import type { ReviewConfig } from "../../config/schema.js";

export interface ActionConfigInput {
  repositoryText?: string;
  workflowText?: string;
  model?: string;
  baseUrl?: string;
}

/**
 * Builds Action configuration in precedence order:
 * built-in defaults < repository file < workflow input/direct overrides.
 */
export function loadActionConfig(input: ActionConfigInput): ReviewConfig {
  const workflowConfig = parseConfigYaml(input.workflowText ?? "");
  const directOverrides = deepMerge(
    input.model ? { review: { model: input.model } } : {},
    input.baseUrl ? { review: { baseUrl: input.baseUrl } } : {}
  );

  return loadConfig({
    ...(input.repositoryText === undefined ? {} : { repositoryText: input.repositoryText }),
    external: deepMerge(workflowConfig, directOverrides),
    runtime: "action"
  });
}
