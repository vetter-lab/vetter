import type { FindingDraft, ReviewSource } from "../core/types.js";
import { createEslintAnalyzer } from "./eslint.js";
import { createGolangciLintAnalyzer } from "./golangci-lint.js";
import type { ProcessRunner } from "./process-analyzer.js";
import { createRuffAnalyzer } from "./ruff.js";
import { createSemgrepAnalyzer } from "./semgrep.js";

export interface AnalyzerRunInput {
  repositoryPath: string;
  changedPaths: string[];
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface AnalyzerRunResult {
  findings: FindingDraft[];
  completedScopes: string[];
}

/**
 * An AnalyzerProvider wraps one fixed, named static-analysis executable
 * (semgrep, eslint, ruff, golangci-lint). Implementations must invoke only
 * their own fixed binary with a fixed argument shape and must never build a
 * command from caller-supplied strings. `changedPaths` restricts analysis to
 * files the core selected; analyzers must not scan paths outside that set.
 *
 * `completedScopes` must only include scope keys for paths whose output was
 * successfully parsed. When the executable is missing, times out, or exits
 * non-zero, the provider must report a failure (via the caller's
 * `ProviderRun.failures`) instead of returning completed scopes, so the
 * caller never closes existing findings based on a run that didn't finish.
 */
export interface AnalyzerProvider {
  readonly name: ReviewSource;
  run(input: AnalyzerRunInput): Promise<AnalyzerRunResult>;
}

/**
 * Aggregate result across all providers invoked for a review: successful
 * findings, the scope keys that completed cleanly (safe to use for closing
 * stale findings), and named failures for scopes/providers that did not
 * complete.
 */
export interface ProviderRun {
  findings: FindingDraft[];
  completedScopes: Set<string>;
  failures: Array<{ provider: string; message: string }>;
}

/**
 * Explicit, closed registry of the only analyzer executables this codebase
 * will ever invoke. Every adapter factory takes a `ProcessRunner` and is
 * keyed by its own fixed name; there is deliberately no way to add or invoke
 * an analyzer that is not one of these four literal keys, so no caller-
 * supplied string can ever be turned into a command to execute.
 */
export const analyzerRegistry = {
  semgrep: createSemgrepAnalyzer,
  eslint: createEslintAnalyzer,
  ruff: createRuffAnalyzer,
  "golangci-lint": createGolangciLintAnalyzer
} as const satisfies Record<ReviewSource extends "llm" ? never : ReviewSource, (processRunner: ProcessRunner) => AnalyzerProvider>;

export type AnalyzerName = keyof typeof analyzerRegistry;

/**
 * Constructs the analyzer provider for `name` using the given process
 * runner. Throws for any name outside `analyzerRegistry`'s literal keys,
 * which is the only rejection path for unknown analyzer names: there is no
 * dynamic lookup or command construction from arbitrary input.
 */
export function createAnalyzerProvider(name: string, processRunner: ProcessRunner): AnalyzerProvider {
  if (!Object.prototype.hasOwnProperty.call(analyzerRegistry, name)) {
    throw new Error(`unknown analyzer: ${name}`);
  }
  const factory = analyzerRegistry[name as AnalyzerName];
  return factory(processRunner);
}
