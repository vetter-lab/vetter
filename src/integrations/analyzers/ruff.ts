import type { FindingDraft } from "../../review/domain/types.js";
import type { AnalyzerProvider, AnalyzerRunInput, AnalyzerRunResult, AnalyzerSource } from "./types.js";
import type { ProcessRunner } from "./process.js";
import { readSourceAnchor, toRelativePath } from "./source-anchor.js";

const SOURCE: AnalyzerSource = "ruff";

interface RuffDiagnostic {
  code: string | null;
  message: string;
  filename: string;
  location: { row: number; column: number };
}

/**
 * Ruff adapter: runs `ruff check --output-format json <changedPaths...>` and
 * converts each diagnostic into a `FindingDraft`. Only changed paths
 * selected by the core are passed on the command line, via a fixed argument
 * array (never a shell string).
 *
 * `ruff check` exits 1 when violations are found; that is a successful run,
 * not a failure. Any other unexpected exit code, a timeout, or unparsable
 * output is treated as a failure by throwing, so the caller never closes
 * existing findings based on a run that didn't complete.
 */
export function createRuffAnalyzer(processRunner: ProcessRunner): AnalyzerProvider {
  return {
    name: SOURCE,
    async run(input: AnalyzerRunInput): Promise<AnalyzerRunResult> {
      if (input.changedPaths.length === 0) {
        return { findings: [], completedScopes: [] };
      }

      const result = await processRunner({
        command: "ruff",
        args: ["check", "--output-format", "json", ...input.changedPaths],
        cwd: input.repositoryPath,
        timeoutMs: input.timeoutMs,
        maxOutputBytes: input.maxOutputBytes
      });

      if (result.timedOut) {
        throw new Error("ruff timed out");
      }

      if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new Error(`ruff exited with code ${String(result.exitCode)}: ${result.stderr}`);
      }

      let parsed: RuffDiagnostic[];
      try {
        parsed = JSON.parse(result.stdout) as RuffDiagnostic[];
      } catch (error) {
        throw new Error(`ruff produced invalid JSON output: ${String(error)}`);
      }

      const findings: FindingDraft[] = parsed.map((diagnostic) => {
        const relativePath = toRelativePath(input.repositoryPath, diagnostic.filename);
        const ruleId = diagnostic.code ?? "ruff";
        const codeAnchor =
          readSourceAnchor(input.repositoryPath, relativePath, diagnostic.location.row) || diagnostic.message;
        return {
          ruleId,
          severity: "P3",
          title: diagnostic.message.split("\n")[0] ?? ruleId,
          body: diagnostic.message,
          path: relativePath,
          line: diagnostic.location.row,
          codeAnchor,
          source: SOURCE,
          scopeKey: `${SOURCE}:${ruleId}:${relativePath}`
        };
      });

      const completedScopes = input.changedPaths.map((path) => `${SOURCE}:${path}`);

      return { findings, completedScopes };
    }
  };
}
