import { isAbsolute, relative } from "node:path";
import type { FindingDraft, ReviewSource, Severity } from "../core/types.js";
import type { AnalyzerProvider, AnalyzerRunInput, AnalyzerRunResult } from "./analyzer.js";
import type { ProcessRunner } from "./process-analyzer.js";

const SOURCE: ReviewSource = "golangci-lint";

interface GolangciLintIssue {
  FromLinter: string;
  Text: string;
  Severity?: string;
  SourceLines?: string[];
  Pos: { Filename: string; Line: number };
}

interface GolangciLintOutput {
  Issues: GolangciLintIssue[];
}

function toRelativePath(repositoryPath: string, rawPath: string): string {
  return isAbsolute(rawPath) ? relative(repositoryPath, rawPath) : rawPath;
}

function mapSeverity(raw: string | undefined): Severity {
  switch ((raw ?? "").toLowerCase()) {
    case "error":
      return "P1";
    default:
      return "P3";
  }
}

/**
 * golangci-lint adapter: runs `golangci-lint run --out-format json
 * <changedPaths...>` and converts each issue into a `FindingDraft`. Only
 * changed paths selected by the core are passed on the command line, via a
 * fixed argument array (never a shell string). Unlike the other adapters,
 * golangci-lint's JSON output already includes the offending source lines
 * (`SourceLines`), so no extra filesystem read is needed for the anchor.
 *
 * `golangci-lint run` exits 1 when issues are found; that is a successful
 * run, not a failure. Any other unexpected exit code, a timeout, or
 * unparsable output is treated as a failure by throwing, so the caller
 * never closes existing findings based on a run that didn't complete.
 */
export function createGolangciLintAnalyzer(processRunner: ProcessRunner): AnalyzerProvider {
  return {
    name: SOURCE,
    async run(input: AnalyzerRunInput): Promise<AnalyzerRunResult> {
      if (input.changedPaths.length === 0) {
        return { findings: [], completedScopes: [] };
      }

      const result = await processRunner({
        command: "golangci-lint",
        args: ["run", "--out-format", "json", ...input.changedPaths],
        cwd: input.repositoryPath,
        timeoutMs: input.timeoutMs,
        maxOutputBytes: input.maxOutputBytes
      });

      if (result.timedOut) {
        throw new Error("golangci-lint timed out");
      }

      if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new Error(`golangci-lint exited with code ${String(result.exitCode)}: ${result.stderr}`);
      }

      let parsed: GolangciLintOutput;
      try {
        parsed = JSON.parse(result.stdout) as GolangciLintOutput;
      } catch (error) {
        throw new Error(`golangci-lint produced invalid JSON output: ${String(error)}`);
      }

      const issues = parsed.Issues ?? [];
      const findings: FindingDraft[] = issues.map((issue) => {
        const relativePath = toRelativePath(input.repositoryPath, issue.Pos.Filename);
        const ruleId = issue.FromLinter;
        return {
          ruleId,
          severity: mapSeverity(issue.Severity),
          title: issue.Text.split("\n")[0] ?? ruleId,
          body: issue.Text,
          path: relativePath,
          line: issue.Pos.Line,
          codeAnchor: (issue.SourceLines ?? []).join("\n").trim() || issue.Text,
          source: SOURCE,
          scopeKey: `${SOURCE}:${ruleId}:${relativePath}`
        };
      });

      const completedScopes = input.changedPaths.map((path) => `${SOURCE}:${path}`);

      return { findings, completedScopes };
    }
  };
}
