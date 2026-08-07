import { expect, it } from "vitest";
import { createEslintAnalyzer } from "../../src/providers/eslint.js";
import { createGolangciLintAnalyzer } from "../../src/providers/golangci-lint.js";
import type { ProcessRunner } from "../../src/providers/process-analyzer.js";
import { createRuffAnalyzer } from "../../src/providers/ruff.js";
import { createSemgrepAnalyzer } from "../../src/providers/semgrep.js";

const input = {
  repositoryPath: process.cwd(),
  changedPaths: ["src/example.ts"],
  timeoutMs: 1000,
  maxOutputBytes: 10000
};

function runner(stdout: string): ProcessRunner {
  return async () => ({ exitCode: 1, stdout, stderr: "", timedOut: false });
}

it("maps Semgrep ERROR/WARNING/INFO to P0/P1/P3", async () => {
  const result = await createSemgrepAnalyzer(
    runner(
      JSON.stringify({
        results: [
          {
            check_id: "e",
            path: "src/example.ts",
            start: { line: 1 },
            extra: { message: "e", lines: "e", severity: "ERROR" }
          },
          {
            check_id: "w",
            path: "src/example.ts",
            start: { line: 2 },
            extra: { message: "w", lines: "w", severity: "WARNING" }
          },
          {
            check_id: "i",
            path: "src/example.ts",
            start: { line: 3 },
            extra: { message: "i", lines: "i", severity: "INFO" }
          }
        ]
      })
    )
  ).run(input);

  expect(result.findings.map((finding) => finding.severity)).toEqual(["P0", "P1", "P3"]);
});

it("maps ESLint 2/1 to P1/P3", async () => {
  const result = await createEslintAnalyzer(
    runner(
      JSON.stringify([
        {
          filePath: "src/example.ts",
          messages: [
            { ruleId: "error", severity: 2, message: "error", line: 1 },
            { ruleId: "warn", severity: 1, message: "warn", line: 2 }
          ]
        }
      ])
    )
  ).run(input);

  expect(result.findings.map((finding) => finding.severity)).toEqual(["P1", "P3"]);
});

it("maps Ruff diagnostics to P3", async () => {
  const result = await createRuffAnalyzer(
    runner(
      JSON.stringify([
        { code: "E1", message: "message", filename: "src/example.py", location: { row: 1, column: 1 } }
      ])
    )
  ).run({ ...input, changedPaths: ["src/example.py"] });

  expect(result.findings[0]?.severity).toBe("P3");
});

it("maps golangci-lint error/warning/unknown to P1/P3/P3", async () => {
  const result = await createGolangciLintAnalyzer(
    runner(
      JSON.stringify({
        Issues: [
          { FromLinter: "e", Text: "e", Severity: "error", Pos: { Filename: "src/main.go", Line: 1 } },
          { FromLinter: "w", Text: "w", Severity: "warning", Pos: { Filename: "src/main.go", Line: 2 } },
          { FromLinter: "u", Text: "u", Pos: { Filename: "src/main.go", Line: 3 } }
        ]
      })
    )
  ).run({ ...input, changedPaths: ["src/main.go"] });

  expect(result.findings.map((finding) => finding.severity)).toEqual(["P1", "P3", "P3"]);
});
