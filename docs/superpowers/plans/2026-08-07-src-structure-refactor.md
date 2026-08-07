# Source Structure and Prompt Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `src` around review domain, application orchestration, external integrations, and runtimes while preserving behavior and making review prompts independently maintainable.

**Architecture:** Move pure review rules from `src/core` to `src/review/domain`, split the end-to-end use case into `src/review/application`, and move GitHub, analyzer, and model integrations under `src/integrations`. Keep `src/config` and `src/runtimes` as composition boundaries. Build the model prompt through a stable `buildReviewPrompt` facade backed by focused review-prompt sections and a shared model response contract.

**Tech Stack:** TypeScript 5.9, NodeNext/ESM, Vitest, Zod, `parse-diff`, Octokit, OpenAI-compatible SDK, Fastify, `tsup`, and `@vercel/ncc`.

---

## File Ownership Map

| Responsibility | Files after this plan |
| --- | --- |
| Configuration parsing and migration | `src/config/load.ts`, `merge.ts`, `migrate.ts`, `schema.ts`, `types.ts` |
| Review domain data and rules | `src/review/domain/types.ts`, `severity.ts`, `branch-pattern.ts`, `diff/*`, `findings/*`, `reconciliation/*`, `reporting/*` |
| Review application use case | `src/review/application/run-review.ts`, `review-state.ts`, `review-comments.ts` |
| GitHub contract and adapter | `src/integrations/github/*` |
| Analyzer contract, registry, process runner, adapters | `src/integrations/analyzers/*` |
| Model contract, transport, response schema | `src/integrations/models/model.ts`, `openai-compatible.ts`, `review-contract.ts` |
| Review prompt composition | `src/integrations/models/prompts/review/*` |
| Model input security | `src/integrations/models/security/redact.ts` |
| App and Action composition roots | `src/runtimes/app/*`, `src/runtimes/action/*` |

No new alias or broad barrel layer will be added. `prompts/review/index.ts` is
the one intentional facade so model transports do not know prompt internals.

## Task 1: Capture Baseline and Prompt Contracts

**Files:**
- Modify: `tests/providers/prompt.test.ts`
- Test: `tests/providers/prompt.test.ts`

- [ ] **Step 1: Run the current verification baseline**

Run:

~~~bash
pnpm test
pnpm typecheck
~~~

Expected: the existing Vitest suite and TypeScript check pass before any source
move. Record failures as pre-existing instead of changing behavior to hide
them.

- [ ] **Step 2: Add characterization tests for prompt safety and composition**

Keep the current prompt test and add these tests to the existing file before
moving it:

~~~ts
it("redacts repository secrets before interpolation", () => {
  const prompt = buildReviewPrompt({
    diff: "+const token = 'sk-12345678901234567890';",
    contextFiles: [{ path: "config.ts", content: "Authorization: Bearer abc.def.ghi" }],
    model: "test"
  });

  expect(prompt.user).toContain("[REDACTED]");
  expect(prompt.user).not.toContain("sk-12345678901234567890");
  expect(prompt.user).not.toContain("Bearer abc.def.ghi");
});

it("keeps diff and context inside explicit untrusted markers", () => {
  const prompt = buildReviewPrompt({
    diff: "+const value = 1;",
    contextFiles: [{ path: "src/example.ts", content: "export const value = 1;" }],
    model: "test"
  });

  expect(prompt.user).toContain("--- BEGIN UNTRUSTED DIFF ---");
  expect(prompt.user).toContain("--- END UNTRUSTED DIFF ---");
  expect(prompt.user).toContain("--- BEGIN UNTRUSTED FILE (src/example.ts) ---");
  expect(prompt.user).toContain("--- END UNTRUSTED FILE (src/example.ts) ---");
});

it("keeps prompt sections in the current order", () => {
  const prompt = buildReviewPrompt({ diff: "+const value = 1;", contextFiles: [], model: "test" });

  expect(prompt.system.indexOf("Review rubric:")).toBeGreaterThanOrEqual(0);
  expect(prompt.system.indexOf("Review rubric:")).toBeLessThan(
    prompt.system.indexOf("Respond with a single JSON object")
  );
  expect(prompt.system.indexOf("Respond with a single JSON object")).toBeLessThan(
    prompt.system.indexOf("- Output ONLY the JSON object described above.")
  );
});
~~~

These tests pin the security boundary and ordering without duplicating the
entire prompt string.

- [ ] **Step 3: Run the focused characterization test**

Run:

~~~bash
pnpm exec vitest run tests/providers/prompt.test.ts
~~~

Expected: all prompt tests pass against the current implementation.

- [ ] **Step 4: Commit the baseline contract tests**

~~~bash
git add tests/providers/prompt.test.ts
git commit -m "test: pin review prompt safety contracts"
~~~

## Task 2: Move and Split the Review Domain

**Files:**
- Create: `src/config/types.ts`
- Create: `src/review/domain/types.ts`
- Create: `src/review/domain/severity.ts`
- Create: `src/review/domain/branch-pattern.ts`
- Create: `src/review/domain/diff/types.ts`
- Create: `src/review/domain/diff/parser.ts`
- Create: `src/review/domain/diff/anchor.ts`
- Create: `src/review/domain/findings/text.ts`
- Create: `src/review/domain/findings/fingerprint.ts`
- Create: `src/review/domain/findings/normalize.ts`
- Create: `src/review/domain/reconciliation/markers.ts`
- Create: `src/review/domain/reconciliation/reconcile.ts`
- Create: `src/review/domain/reporting/summary.ts`
- Create: `src/review/domain/reporting/check-run.ts`
- Modify: `src/config/load.ts` and all current imports from `src/core/*`
- Test: `tests/config/config.test.ts`, `tests/core/*.test.ts`

- [ ] **Step 1: Create the new domain/config directories and move pure files**

Run:

~~~bash
mkdir -p src/review/domain/diff src/review/domain/findings
mkdir -p src/review/domain/reconciliation src/review/domain/reporting
git mv src/core/types.ts src/review/domain/types.ts
git mv src/core/severity.ts src/review/domain/severity.ts
git mv src/core/branch-pattern.ts src/review/domain/branch-pattern.ts
git mv src/core/normalize.ts src/review/domain/findings/text.ts
git mv src/core/markers.ts src/review/domain/reconciliation/markers.ts
git mv src/core/reconcile.ts src/review/domain/reconciliation/reconcile.ts
git mv src/core/summary.ts src/review/domain/reporting/summary.ts
~~~

Create `src/config/types.ts`:

~~~ts
export type RuntimeMode = "app" | "action";
~~~

Remove `RuntimeMode` from `src/review/domain/types.ts` and make
`src/config/load.ts` import it from `./types.js`.

- [ ] **Step 2: Split diff parsing from anchor lookup**

Create `src/review/domain/diff/types.ts` with the existing public shapes:

~~~ts
export type ChangedFileStatus = "added" | "modified" | "deleted" | "renamed";

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  patch: string;
  addedLines: number[];
  removedLines: number[];
  scopeKey: string;
}

export interface ReviewAnchor {
  path: string;
  line: number;
  side: "RIGHT";
}
~~~

Move `parseChangedFiles` and its private helpers from `src/core/diff.ts`
to `diff/parser.ts`. It imports `parse-diff` and the types from
`./types.js`.

Move `findReviewAnchor` to `diff/anchor.ts`:

~~~ts
import type { ChangedFile, ReviewAnchor } from "./types.js";

export function findReviewAnchor(files: ChangedFile[], path: string, line: number): ReviewAnchor | null {
  const file = files.find((candidate) => candidate.path === path);
  if (!file || !file.addedLines.includes(line)) {
    return null;
  }
  return { path, line, side: "RIGHT" };
}
~~~

Update callers to import `parseChangedFiles` from `diff/parser.js` and
`findReviewAnchor` from `diff/anchor.js`. Preserve raw patch handling.

- [ ] **Step 3: Split finding normalization from identity helpers**

Move `computeFingerprint` and `matchExistingFinding` to
`review/domain/findings/fingerprint.ts`. Its imports become:

~~~ts
import { createHash } from "node:crypto";
import { normalize } from "./text.js";
import type { ExistingFinding, Finding, FindingDraft } from "../types.js";
~~~

Move `normalizeFinding` to `findings/normalize.ts`. It imports
`computeFingerprint` from `./fingerprint.js`, `SEVERITIES` from
`../severity.js`, and finding types from `../types.js`. Preserve its
validation message, trimming behavior, scope key, and fingerprint input.

Update `reconciliation/reconcile.ts` to import
`matchExistingFinding` from `../findings/fingerprint.js`,
`ReviewAnchor` from `../diff/types.js`, and domain types from
`../types.js`.

- [ ] **Step 4: Update reconciliation/reporting imports and isolate Check Run policy**

Update `markers.ts`, `reconcile.ts`, and `summary.ts` to use new sibling
paths while preserving all exported interfaces and functions.

Change `review/domain/reporting/check-run.ts` so it no longer imports
`ReviewConfig`. Define:

~~~ts
import type { Severity } from "../types.js";
import type { SummaryRow } from "../reconciliation/reconcile.js";

export type SeverityPolicy = Readonly<Record<Severity, { blockMerge: boolean }>>;

export interface EvaluateCheckRunInput {
  rows: SummaryRow[];
  severity: SeverityPolicy;
  failures: Array<{ provider: string; message: string }>;
}
~~~

Replace `input.config.severity` with `input.severity`; preserve all existing
titles, summaries, counts, failure behavior, and conclusions.

- [ ] **Step 5: Move domain tests and update imports**

Run:

~~~bash
mkdir -p tests/review/domain/diff tests/review/domain/findings
mkdir -p tests/review/domain/reconciliation tests/review/domain/reporting
git mv tests/core/diff.test.ts tests/review/domain/diff/diff.test.ts
git mv tests/core/fingerprint.test.ts tests/review/domain/findings/fingerprint.test.ts
git mv tests/core/markers.test.ts tests/review/domain/reconciliation/markers.test.ts
git mv tests/core/severity.test.ts tests/review/domain/severity.test.ts
git mv tests/core/summary.test.ts tests/review/domain/reporting/summary.test.ts
git mv tests/core/check-run.test.ts tests/review/domain/reporting/check-run.test.ts
~~~

Update diff/fingerprint/marker/severity/summary imports. Change Check Run test
inputs from `config: { severity: ... }` to `severity: { ... }`.

- [ ] **Step 6: Run domain/config tests and commit**

Run:

~~~bash
pnpm exec vitest run tests/config tests/review/domain
pnpm typecheck
~~~

Expected: selected tests pass and no TypeScript import errors remain.

~~~bash
git add src/config src/review tests/config tests/review/domain
git commit -m "refactor: organize review domain modules"
~~~

## Task 3: Split the Review Application Service

**Files:**
- Create: `src/review/application/run-review.ts`
- Create: `src/review/application/review-state.ts`
- Create: `src/review/application/review-comments.ts`
- Modify: runtime/test imports
- Delete after verified move: `src/core/review.ts`
- Test: move `tests/core/review.test.ts` to `tests/review/application/review.test.ts`

- [ ] **Step 1: Move the review test and update its public import**

~~~bash
mkdir -p tests/review/application
git mv tests/core/review.test.ts tests/review/application/review.test.ts
~~~

Use:

~~~ts
import { runReview } from "../../src/review/application/run-review.js";
~~~

Keep gateway fakes and assertions unchanged.

- [ ] **Step 2: Extract persisted finding reconstruction**

Move `toExistingFindings` into
`src/review/application/review-state.ts` with the same mapping:

~~~ts
import type { ReviewStateSnapshot } from "../../integrations/github/types.js";
import { parseFindingMarker } from "../domain/reconciliation/markers.js";
import { wasResolvedByBot } from "../domain/reconciliation/reconcile.js";
import type { ExistingFinding, FindingState } from "../domain/types.js";

export function toExistingFindings(
  snapshot: ReviewStateSnapshot,
  botLogins: Set<string>
): ExistingFinding[] {
  const findings: ExistingFinding[] = [];

  for (const thread of snapshot.reviewThreads) {
    for (const comment of thread.comments) {
      const marker = parseFindingMarker(comment.body);
      if (!marker) {
        continue;
      }

      const lastAction: ExistingFinding["lastAction"] = marker.botResolved ? "bot-resolved" : "updated";
      const resolvedByBot = wasResolvedByBot({ resolvedByLogin: thread.resolvedByLogin, lastAction }, botLogins);
      const state: FindingState = !thread.isResolved ? "open" : resolvedByBot ? "fixed" : "suppressed";

      findings.push({
        fingerprint: marker.fingerprint,
        ruleId: marker.ruleId,
        source: marker.source,
        scopeKey: marker.scopeKey,
        severity: marker.severity,
        title: marker.title,
        body: comment.body,
        path: comment.path,
        line: comment.line,
        commentId: comment.commentId,
        threadId: thread.threadId,
        isResolved: thread.isResolved,
        resolvedByLogin: thread.resolvedByLogin,
        lastAction,
        state
      });
    }
  }

  return findings;
}
~~~

Import GitHub snapshots from `../../integrations/github/types.js`, marker
parsing from `../domain/reconciliation/markers.js`,
`wasResolvedByBot` from `../domain/reconciliation/reconcile.js`, and
finding types from `../domain/types.js`.

- [ ] **Step 3: Extract inline comment rendering and mutation**

Move `renderInlineBody` and `applyReconciliationPlan` into exported
functions in `review-comments.ts`, preserving their current bodies:

~~~ts
export function renderInlineBody(finding: RenderableFinding, botResolved: boolean): string {
  const marker = buildFindingMarker({
    fingerprint: finding.fingerprint,
    ruleId: finding.ruleId,
    severity: finding.severity,
    source: finding.source,
    scopeKey: finding.scopeKey,
    title: finding.title,
    botResolved
  });

  return [`**[${finding.severity.toUpperCase()}] ${finding.title}**`, "", finding.body, "", marker].join("\n");
}

export async function applyReconciliationPlan(input: {
  gateway: GitHubGateway;
  pullRequestRef: PullRequestRef;
  headSha: string;
  plan: ReconciliationPlan;
}): Promise<void> {
  const { gateway, pullRequestRef, headSha, plan } = input;

  const reviewComments: CreateReviewCommentInput[] = plan.createInline.map(({ finding, anchor }) => ({
    path: anchor.path,
    line: anchor.line,
    side: anchor.side,
    body: renderInlineBody(finding, false)
  }));

  await gateway.createReview({ ...pullRequestRef, commitId: headSha, comments: reviewComments });

  for (const update of plan.updateInline) {
    await gateway.updateReviewComment({
      owner: pullRequestRef.owner,
      repo: pullRequestRef.repo,
      commentId: update.commentId,
      body: renderInlineBody(update.finding, update.botResolved)
    });
  }

  for (const threadId of plan.resolveThreads) {
    await gateway.resolveThread({ threadId });
  }

  for (const threadId of plan.reopenThreads) {
    await gateway.reopenThread({ threadId });
  }
}
~~~

Preserve marker fields, visible title format, creation/update shape, and
resolve/reopen order. Import reconciliation types from
`../domain/reconciliation/reconcile.js` and GitHub contracts from
`../../integrations/github/*`.

- [ ] **Step 4: Move orchestration into `run-review.ts`**

Move the remaining `src/core/review.ts` implementation to
`src/review/application/run-review.ts`. Keep `RunReviewInput`,
`RunReviewResult`, `toSyntheticPatch`, `toPullRequestRef`, provider
execution, stale-head checks, reconciliation, summary, and Check Run ordering.

Replace private helper calls with:

~~~ts
const existingFindings = toExistingFindings(reviewState, botLogins);
await applyReconciliationPlan({ gateway, pullRequestRef, headSha: context.headSha, plan });
~~~

Pass `severity: config.severity` to `evaluateCheckRun`. Import config from
`../../config/schema.js`, domain modules from `../domain/*`, and
integration contracts from `../../integrations/*`.

- [ ] **Step 5: Run the application test and commit**

Run:

~~~bash
pnpm exec vitest run tests/review/application/review.test.ts
pnpm typecheck
~~~

~~~bash
git add src/review/application tests/review/application
git commit -m "refactor: split review application service"
~~~

## Task 4: Move GitHub Integration Files

**Files:**
- Move: `src/github/*` to `src/integrations/github/*`
- Modify: imports in `src/review`, `src/runtimes`, and tests

- [ ] **Step 1: Move the adapter directory**

~~~bash
mkdir -p src/integrations
git mv src/github src/integrations/github
~~~

Update only relative imports. Keep gateway interfaces, GitHub data types,
authentication, GraphQL thread operations, and REST mutations unchanged.

- [ ] **Step 2: Scan and update all GitHub imports**

Use target paths such as:

~~~ts
import type { GitHubGateway } from "../../integrations/github/gateway.js";
import type { ReviewStateSnapshot } from "../../integrations/github/types.js";
import { createOctokitGateway } from "../../integrations/github/octokit-gateway.js";
~~~

Run:

~~~bash
rg -n 'src/github|\.\./github|\.\./\.\./github' src tests
~~~

Expected: no source or test references to the old location remain.

- [ ] **Step 3: Run focused tests and commit**

~~~bash
pnpm exec vitest run tests/review/application/review.test.ts tests/workflows/action-workflow.test.ts
pnpm typecheck
git add src/integrations/github src/review src/runtimes tests
git commit -m "refactor: move GitHub integration boundary"
~~~

## Task 5: Move and Split Analyzer Integrations

**Files:**
- Create: `src/integrations/analyzers/types.ts`
- Create: `src/integrations/analyzers/registry.ts`
- Move: `src/providers/process-analyzer.ts` to `src/integrations/analyzers/process.ts`
- Move: analyzer adapter files to `src/integrations/analyzers/`
- Test: move `tests/providers/analyzer-severity.test.ts` to `tests/integrations/analyzers/analyzer-severity.test.ts`

- [ ] **Step 1: Create analyzer contracts in `types.ts`**

Move the current interfaces while preserving fields and comments:

~~~ts
import type { FindingDraft, ReviewSource } from "../../review/domain/types.js";

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

export interface AnalyzerProvider {
  readonly name: Exclude<ReviewSource, "llm">;
  run(input: AnalyzerRunInput): Promise<AnalyzerRunResult>;
}

export interface ProviderRun {
  findings: FindingDraft[];
  completedScopes: Set<string>;
  failures: Array<{ provider: string; message: string }>;
}
~~~

- [ ] **Step 2: Move process execution and tool adapters**

~~~bash
mkdir -p src/integrations/analyzers
git mv src/providers/process-analyzer.ts src/integrations/analyzers/process.ts
git mv src/providers/semgrep.ts src/integrations/analyzers/semgrep.ts
git mv src/providers/eslint.ts src/integrations/analyzers/eslint.ts
git mv src/providers/ruff.ts src/integrations/analyzers/ruff.ts
git mv src/providers/golangci-lint.ts src/integrations/analyzers/golangci-lint.ts
~~~

Update adapters to import domain finding types from
`../../review/domain/types.js`, analyzer contracts from `./types.js`, and
`ProcessRunner` from `./process.js`. Preserve fixed commands, parsers,
severity mappings, completed scopes, and errors.

- [ ] **Step 3: Create the analyzer registry facade**

Create `src/integrations/analyzers/registry.ts` with the existing registry
and factory logic, changing only imports. Keep the current `satisfies`
constraint and unknown-name error:

~~~ts
export type AnalyzerName = keyof typeof analyzerRegistry;

export function createAnalyzerProvider(name: string, processRunner: ProcessRunner): AnalyzerProvider {
  if (!Object.prototype.hasOwnProperty.call(analyzerRegistry, name)) {
    throw new Error(`unknown analyzer: ${name}`);
  }
  const factory = analyzerRegistry[name as AnalyzerName];
  return factory(processRunner);
}
~~~

- [ ] **Step 4: Move analyzer tests and update imports**

~~~bash
mkdir -p tests/integrations/analyzers
git mv tests/providers/analyzer-severity.test.ts tests/integrations/analyzers/analyzer-severity.test.ts
~~~

Update imports to the new analyzer paths and keep P0/P1/P3 mapping
assertions unchanged.

- [ ] **Step 5: Run analyzer tests and commit**

~~~bash
pnpm exec vitest run tests/integrations/analyzers
pnpm typecheck
git add src/integrations/analyzers src/runtimes tests/integrations/analyzers
git commit -m "refactor: organize analyzer integrations"
~~~

## Task 6: Reorganize Model Contract and Review Prompt

**Files:**
- Move: `src/providers/model.ts` to `src/integrations/models/model.ts`
- Move: `src/providers/openai-compatible.ts` to `src/integrations/models/openai-compatible.ts`
- Create: `src/integrations/models/review-contract.ts`
- Create: `src/integrations/models/prompts/review/{index,builder,system,user,rubric,output-contract}.ts`
- Move: `src/providers/redact.ts` to `src/integrations/models/security/redact.ts`
- Test: move model/prompt tests under `tests/integrations/models`

- [ ] **Step 1: Move model contract and security helper**

~~~bash
mkdir -p src/integrations/models/prompts/review src/integrations/models/security
git mv src/providers/model.ts src/integrations/models/model.ts
git mv src/providers/redact.ts src/integrations/models/security/redact.ts
~~~

Update `model.ts` to import `FindingDraft` from
`../../review/domain/types.js`. Preserve model interfaces and all redaction
patterns and behavior.

- [ ] **Step 2: Extract the response schema and canonical contract**

Create `src/integrations/models/review-contract.ts` by moving the current
Zod schemas out of `openai-compatible.ts` and export them:

~~~ts
import { z } from "zod";

export const findingSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(["P0", "P1", "P2", "P3"]),
  title: z.string(),
  body: z.string(),
  path: z.string(),
  line: z.number().int(),
  codeAnchor: z.string()
});

export const modelResponseSchema = z.object({
  findings: z.array(findingSchema)
});

export const MODEL_OUTPUT_CONTRACT =
  '{"findings": [{"ruleId": string, "severity": "P0" | "P1" | "P2" | "P3", "title": string, "body": string, "path": string, "line": number, "codeAnchor": string}]}';
~~~

The actual implementation must preserve current schema behavior and prompt
contract text exactly.

- [ ] **Step 3: Split prompt composition into pure modules**

Create `prompts/review/builder.ts` with:

~~~ts
import type { ModelReviewInput } from "../../model.js";
import { buildSystemPrompt } from "./system.js";
import { buildUserPrompt } from "./user.js";

export interface ReviewPrompt {
  system: string;
  user: string;
}

export function buildReviewPrompt(input: ModelReviewInput): ReviewPrompt {
  return {
    system: buildSystemPrompt(),
    user: buildUserPrompt(input)
  };
}
~~~

The actual file imports `buildSystemPrompt` from `./system.js` and
`buildUserPrompt` from `./user.js`.

Implement these focused sections without rewording current strings:

- `rubric.ts`: move `CODE_REVIEW_EXPERT_RUBRIC`.
- `output-contract.ts`: render the current JSON-only instructions from
  `../../review-contract.js`.
- `system.ts`: preserve role, untrusted-data safety, rubric, output contract,
  and rules section order; never import the OpenAI SDK.
- `user.ts`: render diff/context content, call `redactSecrets` before
  interpolation, and preserve all untrusted markers.
- `index.ts`: re-export `buildReviewPrompt` and `ReviewPrompt` from
  `./builder.js`.

The builder must not embed repository text in the system prompt. Identical
inputs must produce identical system and user strings after the move.

- [ ] **Step 4: Move the model transport and update imports**

~~~bash
git mv src/providers/openai-compatible.ts src/integrations/models/openai-compatible.ts
~~~

Use these imports in the adapter:

~~~ts
import { findReviewAnchor } from "../../review/domain/diff/anchor.js";
import { parseChangedFiles } from "../../review/domain/diff/parser.js";
import type { FindingDraft } from "../../review/domain/types.js";
import { modelResponseSchema } from "./review-contract.js";
import type { ModelProvider, ModelReviewInput, ModelReviewResult } from "./model.js";
import { buildReviewPrompt } from "./prompts/review/index.js";
~~~

Keep client creation, request options, retry loop, JSON parsing, Zod
validation, anchor validation, and finding mapping unchanged.

- [ ] **Step 5: Move model tests and update imports**

~~~bash
mkdir -p tests/integrations/models/prompts
git mv tests/providers/prompt.test.ts tests/integrations/models/prompts/review.test.ts
git mv tests/providers/openai-compatible.test.ts tests/integrations/models/openai-compatible.test.ts
~~~

Update imports to new paths and retain the characterization tests. The
existing legacy severity retry test must still reject `major` first and
accept `P3` on the retry.

- [ ] **Step 6: Run model/prompt tests and commit**

~~~bash
pnpm exec vitest run tests/integrations/models
pnpm typecheck
git add src/integrations/models tests/integrations/models
git commit -m "refactor: modularize review prompt integration"
~~~

## Task 7: Update Runtime Composition and Current Documentation

**Files:**
- Modify: `src/runtimes/app/server.ts`
- Modify: `src/runtimes/app/events.ts`
- Modify: `src/runtimes/action/main.ts`
- Modify: `src/runtimes/action/context.ts`
- Modify: `docs/testing.md`
- Modify: remaining source/test imports reported by `rg`

- [ ] **Step 1: Update App runtime imports**

Use these target paths in `src/runtimes/app/server.ts`:

~~~ts
import { loadConfig } from "../../config/load.js";
import { deepMerge } from "../../config/merge.js";
import type { ReviewConfig } from "../../config/schema.js";
import { runReview } from "../../review/application/run-review.js";
import type { ReviewContext } from "../../review/domain/types.js";
import { createInstallationClient } from "../../integrations/github/auth.js";
import type { GitHubGateway } from "../../integrations/github/gateway.js";
import { createOctokitGateway } from "../../integrations/github/octokit-gateway.js";
import { createAnalyzerProvider } from "../../integrations/analyzers/registry.js";
import { runAnalyzerProcess } from "../../integrations/analyzers/process.js";
import { createOpenAiCompatibleModelProvider } from "../../integrations/models/openai-compatible.js";
~~~

Update `events.ts` to import branch policy and domain types from
`review/domain`, and the gateway contract from
`integrations/github`. Keep webhook validation, scheduling, checkout
lifecycle, and configuration precedence unchanged.

- [ ] **Step 2: Update Action runtime imports**

Use equivalent paths in `src/runtimes/action/main.ts` and
`src/runtimes/action/context.ts`. Keep the Action build entrypoint and all
`package.json` scripts unchanged.

- [ ] **Step 3: Update current testing documentation**

In `docs/testing.md`, update current source references:

~~~text
src/core/reconcile.ts -> src/review/domain/reconciliation/reconcile.ts
src/core/review.ts -> src/review/application/review-state.ts
src/core/fingerprint.ts -> src/review/domain/findings/fingerprint.ts
src/core/check-run.ts -> src/review/domain/reporting/check-run.ts
~~~

Leave historical planning documents and approved historical designs unchanged.

- [ ] **Step 4: Scan for stale paths and commit runtime/docs updates**

Run:

~~~bash
rg -n 'src/core|src/providers|src/github|\.\./core|\.\./providers|\.\./github' src tests docs/testing.md
~~~

Expected: no stale imports or current documentation references remain.

~~~bash
git add src/runtimes docs/testing.md src
git commit -m "refactor: update runtime composition imports"
~~~

## Task 8: Full Verification and Delivery Review

**Files:**
- Verify: all `src`, `tests`, and current documentation paths
- Generated output: inspect `dist` changes after build

- [ ] **Step 1: Run the complete test suite**

~~~bash
pnpm test
~~~

Expected: all Vitest tests pass.

- [ ] **Step 2: Run the strict TypeScript check**

~~~bash
pnpm typecheck
~~~

Expected: `tsc --noEmit` exits successfully with no unresolved imports or
Check Run policy type errors.

- [ ] **Step 3: Build both production runtimes**

~~~bash
pnpm build
~~~

Expected: typecheck, App bundling, and Action bundling pass. Inspect
`git status --short` and `git diff --stat`; generated `dist` files should
remain unchanged unless a bundler necessarily encodes a meaningful source
change. Do not commit unrelated generated churn.

- [ ] **Step 4: Check the final diff and structure**

~~~bash
git diff --check
rg --files src tests | sort
rg -n 'buildReviewPrompt|review-contract|runReview|createAnalyzerProvider|createOctokitGateway' src tests
~~~

Expected:

- `src/core`, `src/providers`, and top-level `src/github` no longer exist.
- Prompt files live under `src/integrations/models/prompts/review`.
- Runtime entrypoints remain in place.
- Stable function names are present at their new paths.
- The diff contains no deliberate prompt wording change.

- [ ] **Step 5: Commit only required final adjustments**

If verification requires a small import or documentation correction, run the
focused test again and commit only those files:

~~~bash
git add src tests docs/testing.md
git commit -m "chore: verify source structure refactor"
~~~

Do not create this commit when there are no final adjustments. Report test,
typecheck, build, and diff-check results in the handoff.
