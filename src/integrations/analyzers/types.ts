import type { FindingDraft, ReviewSource } from "../../review/domain/types.js";

export type AnalyzerSource = Exclude<ReviewSource, "llm">;

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
 * An analyzer provider wraps one fixed, named static-analysis executable.
 */
export interface AnalyzerProvider {
  readonly name: AnalyzerSource;
  run(input: AnalyzerRunInput): Promise<AnalyzerRunResult>;
}

export interface ProviderRun {
  findings: FindingDraft[];
  completedScopes: Set<string>;
  failures: Array<{ provider: string; message: string }>;
}
