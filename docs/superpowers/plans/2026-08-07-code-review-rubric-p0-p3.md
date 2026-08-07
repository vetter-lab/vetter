# Code Review Rubric and P0-P3 Severity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the adapted `code-review-expert` rubric into Vetter's model reviewer and migrate all runtime severity handling to P0-P3 with legacy configuration and comment compatibility.

**Architecture:** Keep Vetter's existing single-call model provider, strict JSON schema, untrusted repository-content boundaries, diff-anchor validation, and reconciliation state machine. Add one small shared severity parser for canonical values and legacy aliases, normalize config layers before deep merge, and compose a focused third-party review rubric into the existing system prompt.

**Tech Stack:** TypeScript, Zod, Vitest, YAML, OpenAI-compatible Chat Completions, pnpm, `@vercel/ncc`.

---

### Task 1: Establish the canonical P0-P3 severity contract

**Files:**
- Create: `src/core/severity.ts`
- Modify: `src/core/types.ts:1`
- Modify: `src/core/fingerprint.ts:3-5`
- Modify: `src/core/summary.ts:1-5`
- Modify: `src/core/check-run.ts:1-16`
- Create: `tests/core/severity.test.ts`
- Create: `tests/core/summary.test.ts`
- Create: `tests/core/check-run.test.ts`
- Modify: `tests/core/fingerprint.test.ts:7-9,80-83`

- [ ] **Step 1: Write failing tests for canonical values and compatibility parsing**

Create `tests/core/severity.test.ts` with tests that prove the canonical order
and the only accepted legacy aliases:

```ts
import { describe, expect, it } from "vitest";
import { parseSeverity, SEVERITIES } from "../../src/core/severity.js";

describe("severity", () => {
  it("orders findings from P0 to P3", () => {
    expect(SEVERITIES).toEqual(["P0", "P1", "P2", "P3"]);
  });

  it("maps legacy labels only when reading compatibility data", () => {
    expect(parseSeverity("critical")).toBe("P0");
    expect(parseSeverity("major")).toBe("P1");
    expect(parseSeverity("minor")).toBe("P3");
    expect(parseSeverity("P3")).toBe("P3");
    expect(parseSeverity("blocker")).toBeNull();
  });
});
```

Update `tests/core/fingerprint.test.ts` to use `P2` in its normal finding
fixtures. Keep the invalid-severity test and change its fixture to an invalid
value that is neither a canonical nor legacy value, such as `"blocker"`.

Create `tests/core/summary.test.ts` with P0-P3 rows in reverse order and assert
that `renderSummaryComment` renders the rows in P0, P1, P2, P3 order. Create
`tests/core/check-run.test.ts` with one open finding at each severity, configure
`P1.blockMerge: true`, and assert a `failure` conclusion plus four count lines
labelled P0 through P3.

- [ ] **Step 2: Run the focused tests and verify the failure is about the old enum**

Run:

```bash
pnpm exec vitest run tests/core/severity.test.ts tests/core/summary.test.ts tests/core/check-run.test.ts tests/core/fingerprint.test.ts
```

Expected: the new severity module is missing and existing fixtures/type checks
still expect `critical`, `major`, and `minor`; do not modify production code
until this failure is observed.

- [ ] **Step 3: Implement the shared severity values and update core consumers**

Create `src/core/severity.ts`:

```ts
import type { Severity } from "./types.js";

export const SEVERITIES = ["P0", "P1", "P2", "P3"] as const satisfies readonly Severity[];

export const LEGACY_SEVERITY_ALIASES = {
  critical: "P0",
  major: "P1",
  minor: "P3"
} as const satisfies Record<string, Severity>;

export function parseSeverity(value: unknown): Severity | null {
  if (typeof value !== "string") {
    return null;
  }

  if ((SEVERITIES as readonly string[]).includes(value)) {
    return value as Severity;
  }

  return LEGACY_SEVERITY_ALIASES[value as keyof typeof LEGACY_SEVERITY_ALIASES] ?? null;
}
```

Change `src/core/types.ts` to define `Severity` as
`"P0" | "P1" | "P2" | "P3"`. Use the shared `SEVERITIES` list in
`src/core/fingerprint.ts` for validation. Replace the summary order with a
`Record<Severity, number>` for P0-P3 and replace the Check Run list with
`SEVERITIES`, so all consumers use one canonical order.

- [ ] **Step 4: Run the focused tests and verify the core contract passes**

Run the same Vitest command from Step 2. Expected: all focused severity,
summary, Check Run, and fingerprint tests pass.

- [ ] **Step 5: Commit the canonical severity change**

```bash
git add src/core/severity.ts src/core/types.ts src/core/fingerprint.ts src/core/summary.ts src/core/check-run.ts tests/core/severity.test.ts tests/core/summary.test.ts tests/core/check-run.test.ts tests/core/fingerprint.test.ts
git commit -m "refactor: define P0-P3 severity contract"
```

### Task 2: Migrate configuration layers without changing precedence

**Files:**
- Create: `src/config/migrate.ts`
- Modify: `src/config/schema.ts:21-25`
- Modify: `src/config/load.ts:3-4,32-36,71-75`
- Modify: `tests/config/config.test.ts:4-16`

- [ ] **Step 1: Write failing configuration migration tests**

Extend `tests/config/config.test.ts` with these behaviors:

```ts
it("provides P0-P3 defaults and maps a legacy repository severity", () => {
  const result = loadConfig({
    repositoryText: "severity:\n  major:\n    blockMerge: true\n"
  });

  expect(result.severity.P0.blockMerge).toBe(false);
  expect(result.severity.P1.blockMerge).toBe(true);
  expect(result.severity.P2.blockMerge).toBe(false);
  expect(result.severity.P3.blockMerge).toBe(false);
});

it("lets a new key win over its legacy alias in one layer", () => {
  const result = loadConfig({
    repositoryText: [
      "severity:",
      "  major:",
      "    blockMerge: true",
      "  P1:",
      "    blockMerge: false"
    ].join("\n")
  });

  expect(result.severity.P1.blockMerge).toBe(false);
});

it("preserves external-layer precedence for a legacy alias", () => {
  const result = loadConfig({
    repositoryText: "severity:\n  P1:\n    blockMerge: false\n",
    external: { severity: { major: { blockMerge: true } } }
  });

  expect(result.severity.P1.blockMerge).toBe(true);
});
```

- [ ] **Step 2: Run the configuration tests and verify they fail against the new schema**

Run:

```bash
pnpm exec vitest run tests/config/config.test.ts
```

Expected: the schema rejects missing P0-P3 keys or the old fields remain
unmapped. This confirms the tests exercise behavior that does not exist yet.

- [ ] **Step 3: Implement per-layer severity alias migration**

Create `src/config/migrate.ts`:

```ts
import { LEGACY_SEVERITY_ALIASES } from "../core/severity.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function migrateSeverityConfigLayer(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.severity)) {
    return value;
  }

  const severity = { ...value.severity };
  for (const [legacy, canonical] of Object.entries(LEGACY_SEVERITY_ALIASES)) {
    if (severity[canonical] === undefined && severity[legacy] !== undefined) {
      severity[canonical] = severity[legacy];
    }
    delete severity[legacy];
  }

  return { ...value, severity };
}
```

Update `builtInDefaults.severity` and `reviewConfigSchema` to contain P0, P1,
P2, and P3. In `loadConfig`, call `migrateSeverityConfigLayer` separately on
the parsed repository object and `input.external` before passing both to
`deepMerge`. Do not normalize only after merging, because that would lose the
original layer precedence when an external layer uses a legacy key.

- [ ] **Step 4: Run the configuration tests and the full existing test suite**

Run:

```bash
pnpm exec vitest run tests/config/config.test.ts
pnpm test
```

Expected: the new migration tests and all existing tests pass.

- [ ] **Step 5: Commit the configuration migration**

```bash
git add src/config/migrate.ts src/config/schema.ts src/config/load.ts tests/config/config.test.ts
git commit -m "feat: migrate severity configuration to P0-P3"
```

### Task 3: Read legacy finding markers safely and write canonical markers

**Files:**
- Modify: `src/core/markers.ts:1,56-78`
- Create: `tests/core/markers.test.ts`
- Modify: `src/github/octokit-gateway.ts:337-340` only if the marker ownership predicate needs to use the stricter parser

- [ ] **Step 1: Write failing marker compatibility tests**

Create `tests/core/markers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildFindingMarker, isFindingComment, parseFindingMarker } from "../../src/core/markers.js";

const fields = {
  fingerprint: "fp",
  ruleId: "rule",
  severity: "P0" as const,
  source: "llm" as const,
  scopeKey: "llm:rule:file.ts",
  title: "Title",
  botResolved: false
};

describe("finding markers", () => {
  it("writes and reads canonical P0-P3 values", () => {
    const marker = buildFindingMarker({ ...fields, severity: "P3" });
    expect(parseFindingMarker(marker)?.severity).toBe("P3");
  });

  it("maps a legacy marker severity while reading persisted state", () => {
    const marker = buildFindingMarker({ ...fields, severity: "P1" }).replace('severity="P1"', 'severity="major"');
    expect(parseFindingMarker(marker)?.severity).toBe("P1");
  });

  it("rejects unknown marker severities as unmanaged", () => {
    const marker = buildFindingMarker(fields).replace('severity="P0"', 'severity="blocker"');
    expect(parseFindingMarker(marker)).toBeNull();
    expect(isFindingComment(marker)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the marker tests and observe the unsafe legacy cast failure**

Run:

```bash
pnpm exec vitest run tests/core/markers.test.ts
```

Expected: the legacy marker is currently returned as the unvalidated string
`major`, and unknown severities are currently treated as finding comments.

- [ ] **Step 3: Implement strict parsing with legacy conversion**

Import `parseSeverity` into `src/core/markers.ts`. After extracting the marker
fields, call `const parsedSeverity = parseSeverity(severity);` and return
`null` when it is `null`; otherwise return `severity: parsedSeverity`. Change
`isFindingComment` to return `parseFindingMarker(body) !== null`, ensuring the
GitHub gateway does not claim ownership of an invalid marker. Keep the marker
version `v1` for backwards-compatible parsing and let `buildFindingMarker`
continue to serialize only the canonical `Severity` type.

- [ ] **Step 4: Run marker and review reconciliation tests**

Run:

```bash
pnpm exec vitest run tests/core/markers.test.ts tests/core/review.test.ts
```

Expected: legacy markers are accepted as P0, P1, and P3, invalid markers are ignored,
and the existing review flow remains green.

- [ ] **Step 5: Commit marker compatibility**

```bash
git add src/core/markers.ts tests/core/markers.test.ts
git commit -m "feat: read legacy finding severities safely"
```

### Task 4: Integrate the adapted code-review-expert rubric into the model prompt

**Files:**
- Create: `src/providers/review-rubric.ts`
- Modify: `src/providers/prompt.ts:1-35`
- Modify: `src/providers/openai-compatible.ts:25-32`
- Create: `tests/providers/prompt.test.ts`
- Modify: `tests/providers/openai-compatible.test.ts:22-43,46-68`

- [ ] **Step 1: Write failing prompt and provider contract tests**

Create `tests/providers/prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildReviewPrompt } from "../../src/providers/prompt.js";

describe("buildReviewPrompt", () => {
  it("includes the adapted rubric and canonical JSON severity contract", () => {
    const prompt = buildReviewPrompt({ diff: "+const value = 1;", contextFiles: [], model: "test" });

    expect(prompt.system).toContain("P0");
    expect(prompt.system).toContain("P1");
    expect(prompt.system).toContain("P2");
    expect(prompt.system).toContain("P3");
    expect(prompt.system).toContain("SOLID");
    expect(prompt.system).toContain("race conditions");
    expect(prompt.system).toContain('"severity": "P0" | "P1" | "P2" | "P3"');
    expect(prompt.system).toContain("UNTRUSTED DATA");
  });
});
```

Update `tests/providers/openai-compatible.test.ts` so normal fixtures use P1.
Add a response with legacy severity `"major"` followed by a valid `"P3"`
response and assert that the provider retries once and returns P3. This proves
the Zod response schema does not silently accept legacy values from the model.

- [ ] **Step 2: Run the prompt/provider tests and verify they fail**

Run:

```bash
pnpm exec vitest run tests/providers/prompt.test.ts tests/providers/openai-compatible.test.ts
```

Expected: the prompt lacks the rubric and still advertises the old enum, and
the provider accepts the old model severity instead of retrying.

- [ ] **Step 3: Add the focused rubric and compose it with the existing prompt**

Create `src/providers/review-rubric.ts` with a static exported string that
contains these concrete rules:

```ts
export const CODE_REVIEW_EXPERT_RUBRIC = [
  "Review added lines for concrete, actionable defects; do not report generic advice.",
  "P0: security vulnerability, data loss, or correctness failure that must block merge.",
  "P1: high-impact logic error, significant SOLID or architecture issue, or performance regression.",
  "P2: code smell, maintainability problem, error-handling gap, or boundary-condition risk.",
  "P3: low-risk style, naming, or optional improvement; report only when specific and useful.",
  "Check correctness, data integrity, authorization, injection, secret exposure, supply chain, error propagation, async failures, input boundaries, resource limits, race conditions, check-then-act behavior, and shared state.",
  "Use the least severe level that accurately describes a concrete problem and explain the impact and fix in the finding body.",
  "Only report a finding when the diff or supplied context provides evidence; keep the finding anchored to an added diff line."
].join("\\n");
```

Compose this string into `SYSTEM_PROMPT` after the untrusted-data boundary
instructions and before the JSON contract. Keep the existing prompt-injection
defense and added-line-only rules. Change the JSON example in
`src/providers/prompt.ts` to use `P0` through `P3`, and change the Zod enum in
`src/providers/openai-compatible.ts` to `z.enum(["P0", "P1", "P2", "P3"])`.

- [ ] **Step 4: Run the prompt/provider tests and the full suite**

Run:

```bash
pnpm exec vitest run tests/providers/prompt.test.ts tests/providers/openai-compatible.test.ts
pnpm test
```

Expected: the rubric is present, P0-P3 is the only model output contract, and
all tests pass.

- [ ] **Step 5: Commit the model rubric integration**

```bash
git add src/providers/review-rubric.ts src/providers/prompt.ts src/providers/openai-compatible.ts tests/providers/prompt.test.ts tests/providers/openai-compatible.test.ts
git commit -m "feat: add structured code review rubric"
```

### Task 5: Update static analyzer severity mappings and test every adapter

**Files:**
- Modify: `src/providers/semgrep.ts:21-30,77`
- Modify: `src/providers/eslint.ts:21-23,98`
- Modify: `src/providers/ruff.ts:86`
- Modify: `src/providers/golangci-lint.ts:24-33,85`
- Create: `tests/providers/analyzer-severity.test.ts`

- [ ] **Step 1: Write failing adapter mapping tests**

Create a fake `ProcessRunner` in `tests/providers/analyzer-severity.test.ts`:

```ts
import { expect, it } from "vitest";
import type { ProcessRunner } from "../../src/providers/process-analyzer.js";
import { createSemgrepAnalyzer } from "../../src/providers/semgrep.js";
import { createEslintAnalyzer } from "../../src/providers/eslint.js";
import { createRuffAnalyzer } from "../../src/providers/ruff.js";
import { createGolangciLintAnalyzer } from "../../src/providers/golangci-lint.js";

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
  const result = await createSemgrepAnalyzer(runner(JSON.stringify({ results: [
    { check_id: "e", path: "src/example.ts", start: { line: 1 }, extra: { message: "e", lines: "e", severity: "ERROR" } },
    { check_id: "w", path: "src/example.ts", start: { line: 2 }, extra: { message: "w", lines: "w", severity: "WARNING" } },
    { check_id: "i", path: "src/example.ts", start: { line: 3 }, extra: { message: "i", lines: "i", severity: "INFO" } }
  ] }))).run(input);
  expect(result.findings.map((finding) => finding.severity)).toEqual(["P0", "P1", "P3"]);
});

it("maps ESLint 2/1 to P1/P3", async () => {
  const result = await createEslintAnalyzer(runner(JSON.stringify([{ filePath: "src/example.ts", messages: [
    { ruleId: "error", severity: 2, message: "error", line: 1 },
    { ruleId: "warn", severity: 1, message: "warn", line: 2 }
  ] }]))).run(input);
  expect(result.findings.map((finding) => finding.severity)).toEqual(["P1", "P3"]);
});

it("maps Ruff diagnostics to P3", async () => {
  const result = await createRuffAnalyzer(runner(JSON.stringify([
    { code: "E1", message: "message", filename: "src/example.py", location: { row: 1, column: 1 } }
  ]))).run({ ...input, changedPaths: ["src/example.py"] });
  expect(result.findings[0]?.severity).toBe("P3");
});

it("maps golangci-lint error/warning/unknown to P1/P3/P3", async () => {
  const result = await createGolangciLintAnalyzer(runner(JSON.stringify({ Issues: [
    { FromLinter: "e", Text: "e", Severity: "error", Pos: { Filename: "src/main.go", Line: 1 } },
    { FromLinter: "w", Text: "w", Severity: "warning", Pos: { Filename: "src/main.go", Line: 2 } },
    { FromLinter: "u", Text: "u", Pos: { Filename: "src/main.go", Line: 3 } }
  ] }))).run({ ...input, changedPaths: ["src/main.go"] });
  expect(result.findings.map((finding) => finding.severity)).toEqual(["P1", "P3", "P3"]);
});
```

- [ ] **Step 2: Run the adapter tests and confirm the old mappings fail**

Run:

```bash
pnpm exec vitest run tests/providers/analyzer-severity.test.ts
```

Expected: the adapters return legacy values, so the P0/P1/P3 assertions fail.

- [ ] **Step 3: Implement the canonical mappings**

Change the adapters to return these exact values without changing their process
invocation or completion-scope behavior:

```ts
// semgrep
case "ERROR": return "P0";
case "WARNING": return "P1";
default: return "P3";

// eslint
return severity >= 2 ? "P1" : "P3";

// ruff
severity: "P3",

// golangci-lint
case "error": return "P1";
default: return "P3";
```

- [ ] **Step 4: Run adapter, typecheck, and full tests**

Run:

```bash
pnpm exec vitest run tests/providers/analyzer-severity.test.ts
pnpm typecheck
pnpm test
```

Expected: all analyzer mapping tests and the complete suite pass.

- [ ] **Step 5: Commit analyzer mappings**

```bash
git add src/providers/semgrep.ts src/providers/eslint.ts src/providers/ruff.ts src/providers/golangci-lint.ts tests/providers/analyzer-severity.test.ts
git commit -m "refactor: map static analyzer findings to P0-P1-P3"
```

### Task 6: Update user-facing configuration, testing documentation, and attribution

**Files:**
- Modify: `examples/vetter.yml:16-22`
- Modify: `docs/configuration.md:40-46,87-96`
- Modify: `docs/testing.md:23-30,113-124`
- Create: `THIRD_PARTY_NOTICES.md`

- [ ] **Step 1: Update the example and configuration reference**

Replace the live example severity block with:

```yaml
severity:
  P0:
    blockMerge: false
  P1:
    blockMerge: false
  P2:
    blockMerge: false
  P3:
    blockMerge: false
```

Update the reference text to describe P0-P3, their meanings, ordering, and
the fact that `critical`, `major`, and `minor` remain accepted as input aliases
for P0, P1, and P3. State that new configurations should use the uppercase
canonical keys and that `version: 1` remains valid.

- [ ] **Step 2: Document marker compatibility and the verification command**

In `docs/testing.md`, state that marker severity values written by current
Vetter runs are P0-P3 and that old marker values are translated while reading.
Keep the marker format version at `v1`. Preserve the existing `pnpm` test,
typecheck, and build commands.

- [ ] **Step 3: Add the MIT attribution notice**

Create `THIRD_PARTY_NOTICES.md` with a source section that names:

```text
Project: sanyuan-skills
Component: skills/code-review-expert
Source: https://github.com/sanyuan0704/sanyuan-skills/tree/08b6572ef108f22d4e8a3ecf9182a4bbef097744/skills/code-review-expert
Copyright: Copyright (c) 2025 sanyuan0704
Adaptation: Review dimensions and P0-P3 severity guidance are adapted into src/providers/review-rubric.ts. The agent workflow and output format are not copied.
```

Include the complete MIT license text from the source repository, including
the copyright notice.

- [ ] **Step 4: Search live code and docs for stale labels**

Run:

```bash
rg -n --hidden -g '!node_modules' -g '!dist' 'critical|major|minor' src tests examples docs README.md THIRD_PARTY_NOTICES.md
```

Expected remaining matches are only intentional compatibility aliases, their
tests, the attribution/design history, or explanatory migration text. Any
live schema, prompt contract, analyzer output, summary, or Check Run label
match must be corrected before continuing.

- [ ] **Step 5: Commit documentation and attribution**

```bash
git add examples/vetter.yml docs/configuration.md docs/testing.md THIRD_PARTY_NOTICES.md
git commit -m "docs: document P0-P3 severity and review rubric attribution"
```

### Task 7: Build the distributable Action and verify the complete change

**Files:**
- Modify: `dist/action/index.js` (generated by the build)

- [ ] **Step 1: Run the complete verification commands**

Run each command from the repository root:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: Vitest reports all tests passing, TypeScript exits with code 0,
`pnpm build` exits with code 0 and regenerates the Action bundle, and
`git diff --check` reports no whitespace errors.

- [ ] **Step 2: Inspect generated and source changes**

Run:

```bash
git status --short
git diff --stat
rg -n 'severity.*(critical|major|minor)|\"severity\": \"critical\"|\"severity\": \"major\"|\"severity\": \"minor\"' src tests examples docs README.md
```

Confirm that production source and live documentation use P0-P3, while only
explicit compatibility code/tests/docs mention legacy labels. Confirm the
generated `dist/action/index.js` includes the new prompt and P0-P3 enum by
searching the bundle for `P0` and `CODE_REVIEW_EXPERT_RUBRIC`-derived text.

- [ ] **Step 3: Commit the generated Action bundle**

```bash
git add dist/action/index.js
git commit -m "dist: rebuild action after review severity migration"
```

- [ ] **Step 4: Re-run the final verification after the generated-file commit**

Run:

```bash
pnpm test && pnpm typecheck && pnpm build && git diff --check
```

Expected: all commands exit successfully and the worktree contains only the
intended commits and no uncommitted source changes.
