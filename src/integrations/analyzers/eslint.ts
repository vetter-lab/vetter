import type { FindingDraft, Severity } from "../../review/domain/types.js";
import type { AnalyzerProvider, AnalyzerRunInput, AnalyzerRunResult, AnalyzerSource } from "./types.js";
import type { ProcessRunner } from "./process.js";
import { readSourceAnchor, toRelativePath } from "./source-anchor.js";

const SOURCE: AnalyzerSource = "eslint";

interface EslintMessage {
  ruleId: string | null;
  severity: number;
  message: string;
  line: number;
}

interface EslintFileResult {
  filePath: string;
  messages: EslintMessage[];
}

function mapSeverity(severity: number): Severity {
  return severity >= 2 ? "P1" : "P3";
}

/**
 * ESLint adapter: runs `eslint --format json <changedPaths...>` and converts
 * each message into a `FindingDraft`. Only changed paths selected by the
 * core are passed on the command line, via a fixed argument array (never a
 * shell string).
 *
 * ESLint exits 1 when lint problems are found; that is a successful run, not
 * a failure. Exit code 2 (fatal CLI/config error) and any other unexpected
 * code, a timeout, or unparsable output are treated as failures by
 * throwing, so the caller never closes existing findings based on a run
 * that didn't complete.
 */
export function createEslintAnalyzer(processRunner: ProcessRunner): AnalyzerProvider {
  return {
    name: SOURCE,
    async run(input: AnalyzerRunInput): Promise<AnalyzerRunResult> {
      if (input.changedPaths.length === 0) {
        return { findings: [], completedScopes: [] };
      }

      const result = await processRunner({
        command: "eslint",
        args: ["--format", "json", ...input.changedPaths],
        cwd: input.repositoryPath,
        timeoutMs: input.timeoutMs,
        maxOutputBytes: input.maxOutputBytes
      });

      if (result.timedOut) {
        throw new Error("eslint timed out");
      }

      if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new Error(`eslint exited with code ${String(result.exitCode)}: ${result.stderr}`);
      }

      let parsed: EslintFileResult[];
      try {
        parsed = JSON.parse(result.stdout) as EslintFileResult[];
      } catch (error) {
        throw new Error(`eslint produced invalid JSON output: ${String(error)}`);
      }

      const findings: FindingDraft[] = [];
      for (const fileResult of parsed) {
        const relativePath = toRelativePath(input.repositoryPath, fileResult.filePath);
        for (const message of fileResult.messages) {
          const ruleId = message.ruleId ?? "eslint";
          const codeAnchor = readSourceAnchor(input.repositoryPath, relativePath, message.line) || message.message;
          findings.push({
            ruleId,
            severity: mapSeverity(message.severity),
            title: message.message.split("\n")[0] ?? ruleId,
            body: message.message,
            path: relativePath,
            line: message.line,
            codeAnchor,
            source: SOURCE,
            scopeKey: `${SOURCE}:${ruleId}:${relativePath}`
          });
        }
      }

      const completedScopes = input.changedPaths.map((path) => `${SOURCE}:${path}`);

      return { findings, completedScopes };
    }
  };
}
