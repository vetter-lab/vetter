import { createEslintAnalyzer } from "./eslint.js";
import { createGolangciLintAnalyzer } from "./golangci-lint.js";
import type { ProcessRunner } from "./process.js";
import { createRuffAnalyzer } from "./ruff.js";
import { createSemgrepAnalyzer } from "./semgrep.js";
import type { ReviewSource } from "../../review/domain/types.js";
import type { AnalyzerProvider } from "./types.js";

/**
 * Explicit, closed registry of the only analyzer executables this codebase
 * will ever invoke. Every adapter factory takes a ProcessRunner and is keyed
 * by its own fixed name.
 */
export const analyzerRegistry = {
  semgrep: createSemgrepAnalyzer,
  eslint: createEslintAnalyzer,
  ruff: createRuffAnalyzer,
  "golangci-lint": createGolangciLintAnalyzer
} as const satisfies Record<Exclude<ReviewSource, "llm">, (processRunner: ProcessRunner) => AnalyzerProvider>;

export type AnalyzerName = keyof typeof analyzerRegistry;

/**
 * Constructs an analyzer provider from the closed registry. Unknown names
 * cannot become executable commands.
 */
export function createAnalyzerProvider(name: string, processRunner: ProcessRunner): AnalyzerProvider {
  if (!Object.prototype.hasOwnProperty.call(analyzerRegistry, name)) {
    throw new Error(`unknown analyzer: ${name}`);
  }
  const factory = analyzerRegistry[name as AnalyzerName];
  return factory(processRunner);
}
