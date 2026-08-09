import { readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import type { FindingDraft, Severity } from "../../review/domain/types.js";
import type { AnalyzerProvider, AnalyzerRunInput, AnalyzerRunResult, AnalyzerSource } from "./types.js";
import type { ProcessRunner } from "./process.js";

const SOURCE: AnalyzerSource = "semgrep";

interface SemgrepResultItem {
  check_id: string;
  path: string;
  start: { line: number };
  end?: { line: number };
  extra: {
    message: string;
    lines: string;
    severity?: string;
  };
}

function toRelativePath(repositoryPath: string, rawPath: string): string {
  return isAbsolute(rawPath) ? relative(repositoryPath, rawPath) : rawPath;
}

/**
 * Semgrep's JSON `extra.lines` is not reliable for some rules: it can contain
 * a rule fingerprint rather than the matched source. Read the matched source
 * from the checkout so findings at different locations get different
 * identities and can be relocated after a commit.
 */
function readSourceAnchor(
  repositoryPath: string,
  relativePath: string,
  startLine: number,
  endLine: number
): string | null {
  try {
    const content = readFileSync(join(repositoryPath, relativePath), "utf8");
    const lines = content.split("\n");
    const source = lines.slice(startLine - 1, endLine).join("\n").trim();
    return source.length > 0 ? source : null;
  } catch {
    return null;
  }
}

interface SemgrepOutput {
  results: SemgrepResultItem[];
}

function mapSeverity(raw: string | undefined): Severity {
  switch ((raw ?? "").toUpperCase()) {
    case "ERROR":
      return "P0";
    case "WARNING":
      return "P1";
    default:
      return "P3";
  }
}

/**
 * Semgrep adapter: runs `semgrep --json --config auto <changedPaths...>` and
 * converts each result entry into a `FindingDraft`. Only changed paths
 * selected by the core are passed on the command line, via a fixed argument
 * array (never a shell string).
 *
 * Semgrep exits 0 when clean and 1 when findings were reported; both are
 * successful runs. Any other exit code, a timeout, or unparsable output is
 * treated as a failure by throwing, so the caller never closes existing
 * findings based on a run that didn't complete.
 */
export function createSemgrepAnalyzer(processRunner: ProcessRunner): AnalyzerProvider {
  return {
    name: SOURCE,
    async run(input: AnalyzerRunInput): Promise<AnalyzerRunResult> {
      if (input.changedPaths.length === 0) {
        return { findings: [], completedScopes: [] };
      }

      const result = await processRunner({
        command: "semgrep",
        args: ["--json", "--config", "auto", ...input.changedPaths],
        cwd: input.repositoryPath,
        timeoutMs: input.timeoutMs,
        maxOutputBytes: input.maxOutputBytes
      });

      if (result.timedOut) {
        throw new Error("semgrep timed out");
      }

      if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new Error(`semgrep exited with code ${String(result.exitCode)}: ${result.stderr}`);
      }

      let parsed: SemgrepOutput;
      try {
        parsed = JSON.parse(result.stdout) as SemgrepOutput;
      } catch (error) {
        throw new Error(`semgrep produced invalid JSON output: ${String(error)}`);
      }

      const findings: FindingDraft[] = parsed.results.map((item) => {
        const relativePath = toRelativePath(input.repositoryPath, item.path);
        const endLine = item.end?.line ?? item.start.line;
        const sourceAnchor = readSourceAnchor(input.repositoryPath, relativePath, item.start.line, endLine);
        const reportedAnchor = item.extra.lines.trim();
        // Keep a location-specific fallback when the source file is
        // unavailable, so multiple findings with the same broken Semgrep
        // `lines` value cannot collapse into one fingerprint.
        const codeAnchor = sourceAnchor ?? `${reportedAnchor}\n@line:${String(item.start.line)}`;
        return {
          ruleId: item.check_id,
          severity: mapSeverity(item.extra.severity),
          title: item.extra.message.split("\n")[0] ?? item.check_id,
          body: item.extra.message,
          path: relativePath,
          line: item.start.line,
          codeAnchor,
          source: SOURCE,
          scopeKey: `${SOURCE}:${item.check_id}:${relativePath}`
        };
      });

      const completedScopes = input.changedPaths.map((path) => `${SOURCE}:${path}`);

      return { findings, completedScopes };
    }
  };
}
