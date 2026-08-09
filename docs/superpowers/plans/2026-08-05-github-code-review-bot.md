# GitHub Code Review Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Vetter as a stateless GitHub code review bot that supports either a GitHub App or a GitHub Action per repository, reviews the latest open-PR commit, reconciles inline comments from GitHub thread state, maintains a summary table, and publishes a configurable Check Run.

**Architecture:** A TypeScript review core owns configuration, diff processing, provider orchestration, finding identity, comment reconciliation, summary rendering, and Check Run evaluation. A GitHub App webhook adapter and a GitHub Action adapter normalize events into the same `ReviewContext`; neither adapter stores review state in SQL. GitHub comments and review threads are the state source, with in-memory latest-wins scheduling in App mode and Action concurrency groups in Action mode.

**Tech Stack:** Node.js 22, pnpm 10, TypeScript, Vitest, Zod, YAML, Octokit REST/GraphQL, Fastify, OpenAI-compatible SDK, `parse-diff`, `@actions/github`, `@vercel/ncc`, and allowlisted analyzer processes for Semgrep, ESLint, ruff, and golangci-lint.

---

## File Map

The implementation will create this focused structure:

```text
package.json
pnpm-lock.yaml
tsconfig.json
vitest.config.ts
action.yml
.gitignore

src/
  config/schema.ts
  config/load.ts
  config/merge.ts
  core/types.ts
  core/diff.ts
  core/fingerprint.ts
  core/normalize.ts
  core/reconcile.ts
  core/summary.ts
  core/check-run.ts
  core/review.ts
  github/types.ts
  github/auth.ts
  github/gateway.ts
  github/octokit-gateway.ts
  providers/model.ts
  providers/openai-compatible.ts
  providers/prompt.ts
  providers/redact.ts
  providers/analyzer.ts
  providers/process-analyzer.ts
  providers/semgrep.ts
  providers/eslint.ts
  providers/ruff.ts
  providers/golangci-lint.ts
  runtimes/app/events.ts
  runtimes/app/scheduler.ts
  runtimes/app/server.ts
  runtimes/action/context.ts
  runtimes/action/main.ts

tests/
  fixtures/example.patch
  config/config.test.ts
  core/fingerprint.test.ts
  core/diff.test.ts
  core/reconcile.test.ts
  core/summary.test.ts
  core/check-run.test.ts
  providers/model.test.ts
  providers/analyzer.test.ts
  github/gateway.test.ts
  runtimes/app/events.test.ts
  runtimes/app/scheduler.test.ts
  runtimes/action/context.test.ts
  integration/review.test.ts

docs/
  action-setup.md
  github-app-setup.md
  configuration.md
  testing.md

examples/
  vetter-action.yml
  vetter.yml

Dockerfile
.env.example
```

## Task 1: Bootstrap the TypeScript Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/index.ts`
- Create: `tests/bootstrap.test.ts`

- [ ] **Step 1: Create the package manifest and scripts**

Run:

```bash
pnpm add @actions/core @actions/github @octokit/auth-app @octokit/plugin-retry @octokit/plugin-throttling fastify fastify-raw-body octokit openai parse-diff yaml zod
pnpm add -D @octokit/webhooks-types @types/node @vercel/ncc tsup tsx typescript vitest
```

Set `package.json` to expose these scripts:

```json
{
  "name": "vetter",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "build": "pnpm typecheck && pnpm build:app && pnpm build:action",
    "build:app": "tsup src/runtimes/app/server.ts --format esm --out-dir dist/app",
    "build:action": "ncc build src/runtimes/action/main.ts -o dist/action",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Add TypeScript and Vitest configuration**

Create `tsconfig.json` with strict ESM compilation:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "tests", "vitest.config.ts"]
}
```

Create `vitest.config.ts` with Node execution and test discovery under `tests/**/*.test.ts`.

- [ ] **Step 3: Add the first importable source module and smoke test**

Create `src/index.ts`:

```ts
export const packageName = "vetter";
```

Create `tests/bootstrap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { packageName } from "../src/index.js";

describe("project bootstrap", () => {
  it("exports the package name", () => {
    expect(packageName).toBe("vetter");
  });
});
```

- [ ] **Step 4: Add generated and secret files to `.gitignore`**

The file must ignore `node_modules`, `dist`, `coverage`, `.env`, `.env.*`, and `.DS_Store` while keeping `.env.example` tracked.

- [ ] **Step 5: Verify the bootstrap**

Run:

```bash
pnpm typecheck
pnpm test -- tests/bootstrap.test.ts
```

Expected: TypeScript exits with code 0 and Vitest reports 1 passing test.

- [ ] **Step 6: Commit the bootstrap**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts .gitignore src/index.ts tests/bootstrap.test.ts
git commit -m "chore: bootstrap TypeScript review bot"
```

## Task 2: Define Domain Types and Configuration

**Files:**
- Create: `src/core/types.ts`
- Create: `src/config/schema.ts`
- Create: `src/config/merge.ts`
- Create: `src/config/load.ts`
- Create: `tests/config/config.test.ts`
- Create: `examples/vetter.yml`

- [ ] **Step 1: Write tests for configuration defaults and precedence**

Cover these exact cases:

```ts
it("merges defaults, repository config, and external overrides in that order", () => {
  const result = loadConfig({
    repositoryText: "review:\n  model: repo-model\n",
    external: { review: { model: "external-model" } }
  });

  expect(result.review.model).toBe("external-model");
  expect(result.review.incremental).toBe(true);
  expect(result.severity.major.blockMerge).toBe(false);
});

it("rejects a repository config that attempts to disable the open-PR requirement", () => {
  expect(() => loadConfig({
    repositoryText: "events:\n  push:\n    requireOpenPullRequest: false\n"
  })).toThrowError(/requireOpenPullRequest/);
});

it("rejects an analyzer that is not in the allowlist", () => {
  expect(() => loadConfig({
    repositoryText: "analyzers:\n  - arbitrary-shell\n"
  })).toThrowError(/analyzer/);
});
```

- [ ] **Step 2: Define the core types used by every adapter**

Create `src/core/types.ts` with these public shapes:

```ts
export type Severity = "critical" | "major" | "minor";
export type ReviewSource = "llm" | "semgrep" | "eslint" | "ruff" | "golangci-lint";
export type FindingState = "open" | "fixed" | "dismissed";
export type RuntimeMode = "app" | "action";

export interface ReviewContext {
  repository: { owner: string; name: string; fullName: string };
  pullRequestNumber: number;
  baseSha: string;
  headSha: string;
  eventId: string;
  source: "pull_request" | "push";
}

export interface FindingDraft {
  ruleId: string;
  severity: Severity;
  title: string;
  body: string;
  path: string;
  line: number;
  codeAnchor: string;
  source: ReviewSource;
  scopeKey: string;
}

export interface Finding extends FindingDraft {
  fingerprint: string;
}

export interface ExistingFinding {
  fingerprint: string;
  ruleId: string;
  severity: Severity;
  title: string;
  body: string;
  path: string;
  line: number | null;
  commentId: number;
  threadId: string | null;
  isResolved: boolean;
  resolvedByLogin: string | null;
  lastAction: "created" | "updated" | "bot-resolved" | null;
  state: FindingState;
}
```

- [ ] **Step 3: Implement the Zod configuration schema**

Define `ReviewConfig` with these rules:

```ts
const severityRule = z.object({ blockMerge: z.boolean() });

export const reviewConfigSchema = z.object({
  version: z.literal(1),
  runtime: z.enum(["app", "action"]).optional(),
  review: z.object({
    enabled: z.boolean(),
    incremental: z.literal(true),
    model: z.string().min(1),
    maxDiffBytes: z.number().int().positive()
  }),
  events: z.object({
    push: z.object({
      enabled: z.boolean(),
      requireOpenPullRequest: z.literal(true),
      branchPatterns: z.array(z.string().min(1))
    })
  }),
  severity: z.object({
    critical: severityRule,
    major: severityRule,
    minor: severityRule
  }),
  analyzers: z.array(z.enum(["semgrep", "eslint", "ruff", "golangci-lint"])),
  limits: z.object({
    modelRetries: z.number().int().min(0).max(3),
    analyzerTimeoutMs: z.number().int().positive(),
    maxAnalyzerOutputBytes: z.number().int().positive()
  })
});
```

Reject secret-shaped keys such as `apiKey`, `privateKey`, `token`, and `secret` when they occur in repository YAML. Keep provider secrets in runtime environment variables.

- [ ] **Step 4: Implement configuration loading and deep merge**

Implement:

```ts
export interface ConfigInput {
  repositoryText?: string;
  external?: unknown;
  runtime: RuntimeMode;
}

export function loadConfig(input: ConfigInput): ReviewConfig {
  const defaults = builtInDefaults;
  const repository = parseRepositoryYaml(input.repositoryText ?? "");
  const merged = deepMerge(defaults, repository, input.external ?? {});
  const parsed = reviewConfigSchema.parse(merged);

  if (parsed.runtime && parsed.runtime !== input.runtime) {
    throw new Error(`runtime ${input.runtime} is disabled by configuration`);
  }

  return parsed;
}
```

Use `YAML.parse`, reject non-object YAML roots, and make `requireOpenPullRequest` permanently true so no configuration can enable no-PR review.

- [ ] **Step 5: Add the example repository configuration**

Create `examples/vetter.yml` with the approved defaults, enabled push review, `branchPatterns: ["**"]`, all three `blockMerge: false`, and `analyzers: ["semgrep", "eslint"]`.

- [ ] **Step 6: Run the configuration tests**

```bash
pnpm test -- tests/config/config.test.ts
pnpm typecheck
```

Expected: all configuration tests pass and the typecheck exits successfully.

- [ ] **Step 7: Commit the domain and configuration layer**

```bash
git add src/core/types.ts src/config/schema.ts src/config/merge.ts src/config/load.ts tests/config/config.test.ts examples/vetter.yml
git commit -m "feat: add review domain and configuration schema"
```

## Task 3: Implement Diff Parsing and Finding Identity

**Files:**
- Create: `src/core/diff.ts`
- Create: `src/core/fingerprint.ts`
- Create: `src/core/normalize.ts`
- Create: `tests/fixtures/example.patch`
- Create: `tests/core/diff.test.ts`
- Create: `tests/core/fingerprint.test.ts`

- [ ] **Step 1: Create a diff fixture with added, removed, and context lines**

The fixture must contain one changed TypeScript file with an added line at a known new-file line number and a second file with a deleted-only hunk. Keep the fixture under 100 lines so parser failures are easy to inspect.

- [ ] **Step 2: Write tests for changed-line anchors**

Test the exact contract:

```ts
it("returns a RIGHT anchor only for a line added to the current diff", () => {
  const diff = parseChangedFiles([fixtureFile]);

  expect(findReviewAnchor(diff, "src/example.ts", 12)).toEqual({
    path: "src/example.ts",
    line: 12,
    side: "RIGHT"
  });
});

it("returns null when a finding line is outside the current diff", () => {
  const diff = parseChangedFiles([fixtureFile]);

  expect(findReviewAnchor(diff, "src/example.ts", 3)).toBeNull();
});
```

- [ ] **Step 3: Implement `parseChangedFiles` using `parse-diff`**

Return a normalized `ChangedFile` with `path`, `status`, `patch`, `addedLines`, `removedLines`, and `scopeKey`. Store only added line numbers as valid inline review anchors.

- [ ] **Step 4: Write fingerprint tests**

Verify that line changes do not change the fingerprint, a rule/path/title change does change it, and an ambiguous fallback is rejected by the matching helper.

- [ ] **Step 5: Implement versioned fingerprinting and finding normalization**

Use:

```ts
createHash("sha256")
  .update([draft.ruleId, draft.path, normalize(draft.codeAnchor), normalize(draft.title)].join("\n"))
  .digest("hex");
```

Normalize whitespace, line endings, and repeated spaces. Keep line number out of the digest. `normalizeFinding` must trim text, validate the severity enum, compute `scopeKey` as `${source}:${ruleId}:${path}`, and attach the fingerprint.

- [ ] **Step 6: Run diff and fingerprint tests**

```bash
pnpm test -- tests/core/diff.test.ts tests/core/fingerprint.test.ts
pnpm typecheck
```

Expected: all tests pass and the new functions are available to the core package.

- [ ] **Step 7: Commit diff and identity handling**

```bash
git add src/core/diff.ts src/core/fingerprint.ts src/core/normalize.ts tests/fixtures/example.patch tests/core/diff.test.ts tests/core/fingerprint.test.ts
git commit -m "feat: add diff anchors and finding fingerprints"
```

## Task 4: Add Model and Static Analyzer Providers

**Files:**
- Create: `src/providers/model.ts`
- Create: `src/providers/openai-compatible.ts`
- Create: `src/providers/prompt.ts`
- Create: `src/providers/redact.ts`
- Create: `src/providers/analyzer.ts`
- Create: `src/providers/process-analyzer.ts`
- Create: `src/providers/semgrep.ts`
- Create: `src/providers/eslint.ts`
- Create: `src/providers/ruff.ts`
- Create: `src/providers/golangci-lint.ts`
- Create: `tests/providers/model.test.ts`
- Create: `tests/providers/analyzer.test.ts`

- [ ] **Step 1: Define provider contracts and failure scopes**

Create these interfaces:

```ts
export interface ModelProvider {
  review(input: {
    diff: string;
    contextFiles: Array<{ path: string; content: string }>;
    model: string;
  }): Promise<{ findings: FindingDraft[]; scopeKeys: string[] }>;
}

export interface AnalyzerProvider {
  readonly name: ReviewSource;
  run(input: {
    repositoryPath: string;
    changedPaths: string[];
    timeoutMs: number;
    maxOutputBytes: number;
  }): Promise<{ findings: FindingDraft[]; completedScopes: string[] }>;
}

export interface ProviderRun {
  findings: FindingDraft[];
  completedScopes: Set<string>;
  failures: Array<{ provider: string; message: string }>;
}
```

- [ ] **Step 2: Test prompt construction and secret redaction**

Verify that the prompt contains the diff and explicit JSON-only output instructions, labels repository text as untrusted, and does not include values matching private-key, bearer-token, or common API-key patterns.

- [ ] **Step 3: Implement the structured OpenAI-compatible provider**

Use `openai` with configurable `baseURL`, `apiKey`, and `model`. Send `temperature: 0` and `response_format: { type: "json_object" }`. Parse the response with a Zod schema requiring:

```ts
{
  findings: Array<{
    ruleId: string;
    severity: "critical" | "major" | "minor";
    title: string;
    body: string;
    path: string;
    line: number;
    codeAnchor: string;
  }>
}
```

Retry malformed JSON and transient provider errors up to `modelRetries`. A final failure returns a provider failure and no completed scope for the LLM.

- [ ] **Step 4: Implement the fixed analyzer command runner**

Use `spawn` with an argument array, never a shell string. Enforce timeout, kill the child process on timeout, cap stdout/stderr bytes, parse JSON output, and return a failure scope when the process exits non-zero.

The analyzer registry must be an explicit map:

```ts
const analyzerRegistry = {
  semgrep: createSemgrepAnalyzer,
  eslint: createEslintAnalyzer,
  ruff: createRuffAnalyzer,
  "golangci-lint": createGolangciLintAnalyzer
} as const;
```

Reject every analyzer name not in this map.

- [ ] **Step 5: Implement Semgrep, ESLint, ruff, and golangci-lint adapters**

Each adapter must:

- invoke its fixed executable with fixed JSON output arguments;
- pass only changed file paths selected by the core;
- convert diagnostics to `FindingDraft` values;
- use a deterministic `ruleId`, title, code anchor, path, and line;
- return completed scope keys only after valid output is parsed.

Use `semgrep --json --config auto`, `eslint --format json`, `ruff check --output-format json`, and `golangci-lint run --out-format json`. If an executable is unavailable, return a named provider failure without closing old findings.

- [ ] **Step 6: Test provider behavior with process and model fakes**

Use a fake `ModelClient` and fake process runner. Test malformed model output, redaction, timeout, non-zero analyzer exit, invalid analyzer names, valid JSON conversion, and scope completion.

- [ ] **Step 7: Run provider tests**

```bash
pnpm test -- tests/providers/model.test.ts tests/providers/analyzer.test.ts
pnpm typecheck
```

Expected: all provider tests pass without requiring a live model or installed analyzer binary.

- [ ] **Step 8: Commit provider abstractions and adapters**

```bash
git add src/providers tests/providers
git commit -m "feat: add model and analyzer providers"
```

## Task 5: Implement the GitHub Gateway

**Files:**
- Create: `src/github/types.ts`
- Create: `src/github/auth.ts`
- Create: `src/github/gateway.ts`
- Create: `src/github/octokit-gateway.ts`
- Create: `tests/github/gateway.test.ts`

- [ ] **Step 1: Define GitHub gateway interfaces**

Expose these operations without leaking Octokit types into the core:

```ts
export interface GitHubGateway {
  getPullRequest(input: { owner: string; repo: string; number: number }): Promise<PullRequestSnapshot>;
  findOpenPullRequestsForHead(input: { owner: string; repo: string; branch: string }): Promise<PullRequestSnapshot[]>;
  listChangedFiles(input: PullRequestRef): Promise<ChangedFile[]>;
  listReviewState(input: PullRequestRef): Promise<ReviewStateSnapshot>;
  createReview(input: CreateReviewInput): Promise<void>;
  updateReviewComment(input: { commentId: number; body: string }): Promise<void>;
  createIssueComment(input: { owner: string; repo: string; number: number; body: string }): Promise<{ id: number }>;
  updateIssueComment(input: { owner: string; repo: string; commentId: number; body: string }): Promise<void>;
  resolveThread(input: { threadId: string }): Promise<void>;
  reopenThread(input: { threadId: string }): Promise<void>;
  upsertCheckRun(input: CheckRunInput): Promise<void>;
}
```

`ReviewStateSnapshot` must include all paginated Vetter-marked review threads, all paginated PR issue comments, and the resolved-by login when GitHub returns it.

- [ ] **Step 2: Write gateway tests with an in-memory fake**

Test that the core can use the interface without importing Octokit, and test pagination, summary comment lookup by marker, and filtering by configured bot logins.

- [ ] **Step 3: Implement App and token authentication**

Create `createInstallationClient({ appId, privateKey, installationId })` using `@octokit/auth-app`, and `createTokenClient(token)` for Action mode. Do not log tokens or private keys.

- [ ] **Step 4: Implement REST operations and retry/throttling**

Use Octokit for pull request metadata, paginated changed files, review creation, review comment updates, issue comment creation/update, and Check Run creation/update. Configure retry and throttling handlers to retry secondary rate limits with bounded backoff.

- [ ] **Step 5: Implement GraphQL review-thread operations**

Use paginated GraphQL queries for `pullRequest.reviewThreads` and mutations shaped as:

```graphql
mutation ResolveReviewThread($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { id isResolved resolvedBy { login } }
  }
}
```

Use `unresolveReviewThread` for bot-resolved regressions. Convert GraphQL nodes into the gateway's `ExistingFinding` shape and preserve a null thread ID for REST comments that cannot be mapped.

- [ ] **Step 6: Run gateway tests**

```bash
pnpm test -- tests/github/gateway.test.ts
pnpm typecheck
```

Expected: fake REST/GraphQL responses produce the same gateway shapes consumed by the core.

- [ ] **Step 7: Commit the GitHub gateway**

```bash
git add src/github tests/github
git commit -m "feat: add GitHub REST and GraphQL gateway"
```

## Task 6: Implement Reconciliation, Summary, and Review Orchestration

**Files:**
- Create: `src/core/reconcile.ts`
- Create: `src/core/summary.ts`
- Create: `src/core/check-run.ts`
- Create: `src/core/review.ts`
- Create: `tests/core/reconcile.test.ts`
- Create: `tests/core/summary.test.ts`
- Create: `tests/core/check-run.test.ts`
- Create: `tests/integration/review.test.ts`

- [ ] **Step 1: Write the reconciliation state-transition tests**

Cover these fixtures:

```ts
it("creates a new inline finding", () => {
  const plan = reconcileFindings({
    current: [newFinding("fp-new", "major")],
    existing: [],
    completeScopes: new Set(["llm:rule:file.ts"]),
    botLogins: new Set(["vetter[bot]"])
  });

  expect(plan.createInline).toHaveLength(1);
  expect(plan.resolveThreads).toHaveLength(0);
});

it("marks a missing unresolved bot thread fixed", () => {
  const plan = reconcileFindings({
    current: [],
    existing: [existingFinding({ fingerprint: "fp-old", isResolved: false, lastAction: "updated" })],
    completeScopes: new Set(["llm:rule:file.ts"]),
    botLogins: new Set(["vetter[bot]"])
  });

  expect(plan.resolveThreads).toEqual(["thread-old"]);
  expect(plan.history[0]?.state).toBe("fixed");
});

it("does not reopen a developer-resolved current finding", () => {
  const plan = reconcileFindings({
    current: [newFinding("fp-old", "major")],
    existing: [existingFinding({ fingerprint: "fp-old", isResolved: true, resolvedByLogin: "developer" })],
    completeScopes: new Set(["llm:rule:file.ts"]),
    botLogins: new Set(["vetter[bot]"])
  });

  expect(plan.reopenThreads).toHaveLength(0);
  expect(plan.history[0]?.state).toBe("dismissed");
});
```

Also cover bot-resolved regression, line-outside-diff summary-only findings, ambiguous fingerprint fallback, and incomplete analyzer scopes.

- [ ] **Step 2: Implement `reconcileFindings` as a pure function**

Implement this signature:

```ts
export function reconcileFindings(input: {
  current: Finding[];
  existing: ExistingFinding[];
  completeScopes: Set<string>;
  botLogins: Set<string>;
}): ReconciliationPlan;
```

The function must index existing findings by fingerprint, match unambiguous fallback candidates, emit create/update/resolve/reopen mutations, preserve fixed and dismissed history, and never resolve an existing finding whose scope is absent from `completeScopes`.

- [ ] **Step 3: Implement marker rendering and summary rebuilding**

Render inline bodies with a short visible title/body followed by the hidden finding marker. Render exactly one summary marker and a compact Markdown table. Preserve every existing Vetter row that is not replaced by a current finding. Sort rows by severity (`critical`, `major`, `minor`) and then path and line.

- [ ] **Step 4: Implement Check Run evaluation**

Use this rule:

```ts
const blocking = openFindings.some(
  (finding) => config.severity[finding.severity].blockMerge
);
```

Return `success` when `blocking` is false, `failure` when it is true, and `failure` with an execution-error summary when the provider pipeline fails. Keep the configured severity details in the Check Run output.

- [ ] **Step 5: Implement the review service**

`runReview` must:

1. Load changed files and context through `GitHubGateway`.
2. Run the LLM and configured analyzers with `Promise.allSettled`.
3. Normalize provider findings and collect completed scopes and failures.
4. Re-read the PR head SHA through the gateway.
5. Return `stale` without mutations when the SHA differs.
6. Read review state and call the pure reconciliation function.
7. Apply new reviews, comment updates, thread mutations, summary update, and Check Run mutations in that order.

Do not apply any close or resolve mutation when the run has a provider failure for the affected scope.

- [ ] **Step 6: Add end-to-end core integration tests**

Use fake providers and a fake gateway to prove that the same review service creates one inline comment and one summary comment on the first run, updates the existing comment on the second run, resolves a fixed finding, keeps a developer dismissal, and rejects a stale head SHA.

- [ ] **Step 7: Run core tests**

```bash
pnpm test -- tests/core/reconcile.test.ts tests/core/summary.test.ts tests/core/check-run.test.ts tests/integration/review.test.ts
pnpm typecheck
```

Expected: all state, summary, Check Run, and orchestration tests pass.

- [ ] **Step 8: Commit the shared review core**

```bash
git add src/core tests/core tests/integration
git commit -m "feat: add review reconciliation and orchestration"
```

## Task 7: Build the GitHub App Runtime

**Files:**
- Create: `src/runtimes/app/events.ts`
- Create: `src/runtimes/app/scheduler.ts`
- Create: `src/runtimes/app/server.ts`
- Create: `tests/runtimes/app/events.test.ts`
- Create: `tests/runtimes/app/scheduler.test.ts`
- Create: `.env.example`
- Create: `Dockerfile`

- [ ] **Step 1: Write Webhook event normalization tests**

Test that pull request `opened`, `reopened`, and `synchronize` events produce a `ReviewContext`, push events resolve open PR heads, and a push with no open PR returns `[]`. Test that unsupported event actions return no work.

- [ ] **Step 2: Implement raw-body HMAC verification and event parsing**

Use `fastify-raw-body` so the route verifies the exact request bytes:

```ts
const expected = `sha256=${createHmac("sha256", webhookSecret)
  .update(rawBody)
  .digest("hex")}`;

const valid = timingSafeEqual(
  Buffer.from(expected),
  Buffer.from(signatureHeader)
);
```

Reject invalid signatures with HTTP 401. Read `x-github-event` and `x-github-delivery`, parse the payload only after verification, and attach the delivery ID to the normalized context.

- [ ] **Step 3: Implement latest-wins scheduling**

Create an in-memory `Map<string, AbortController>` keyed by `${owner}/${repo}#${pullRequestNumber}`. On enqueue, abort and replace the previous controller. Before any GitHub mutation, fetch the current head SHA and discard an aborted or stale run. Limit concurrent PR keys to the configured worker count.

- [ ] **Step 4: Implement the Fastify server and health endpoint**

Expose:

- `POST /webhooks/github` for verified Webhooks;
- `GET /healthz` returning `{ "status": "ok" }`;
- HTTP 202 after the event has been accepted into the in-memory scheduler;
- HTTP 400 for malformed payloads and HTTP 500 only when the scheduler cannot accept the event.

Create the App installation Octokit client from `VETTER_APP_ID`, `VETTER_PRIVATE_KEY`, and the installation ID in the payload. Load per-repository external configuration from `VETTER_CONFIG_JSON`, keyed by `owner/name`.

- [ ] **Step 5: Add App runtime tests**

Use fake timers and a fake review runner to assert that a second event aborts the first, a stale run produces no gateway mutations, invalid signatures never reach the scheduler, and health checks remain available while a review runs.

- [ ] **Step 6: Add container and environment configuration**

Create `.env.example` with names only:

```text
VETTER_WEBHOOK_SECRET=
VETTER_APP_ID=
VETTER_PRIVATE_KEY=
VETTER_CONFIG_JSON={}
VETTER_MODEL_API_KEY=
VETTER_MODEL_BASE_URL=
VETTER_MODEL_NAME=
PORT=3000
```

Create a multi-stage `Dockerfile` that installs pnpm dependencies, builds `dist/app/server.js`, copies production dependencies and `dist/app`, exposes port 3000, and starts `node dist/app/server.js`.

- [ ] **Step 7: Run App runtime tests and build**

```bash
pnpm test -- tests/runtimes/app/events.test.ts tests/runtimes/app/scheduler.test.ts
pnpm build:app
pnpm typecheck
```

Expected: App tests pass, `dist/app/server.js` is produced, and typecheck passes.

- [ ] **Step 8: Commit the App runtime**

```bash
git add src/runtimes/app tests/runtimes/app .env.example Dockerfile
git commit -m "feat: add GitHub App webhook runtime"
```

## Task 8: Build the GitHub Action Runtime

**Files:**
- Create: `src/runtimes/action/context.ts`
- Create: `src/runtimes/action/main.ts`
- Create: `action.yml`
- Create: `examples/vetter-action.yml`
- Create: `tests/runtimes/action/context.test.ts`

- [ ] **Step 1: Write Action context tests**

Test pull request events, push events with one matching open PR, push events with multiple matching open PRs, and push events with no open PR. The no-PR case must return an empty review list without calling the review service.

- [ ] **Step 2: Implement event context normalization**

Use `@actions/github` context and the shared gateway to convert event payloads into the same `ReviewContext` used by App mode. Read the repository token from the action input `github-token`, never from a source file.

- [ ] **Step 3: Implement the Action entrypoint**

`main.ts` must:

1. Read `github-token`, `model-api-key`, `model-base-url`, `model-name`, and `config-path` with `@actions/core`.
2. Load `.vetter.yml` from `config-path`, then merge Action `vars` overrides.
3. Build the token gateway, providers, and review service.
4. Normalize the current event.
5. Run one review per matching open PR.
6. Call `core.setFailed` on configuration, provider, or GitHub execution errors.
7. Emit a neutral log and exit successfully when the push has no open PR.

- [ ] **Step 4: Define the Action metadata and permissions**

Create `action.yml` with `using: node20`, `main: dist/action/index.js`, required input `github-token`, optional inputs for model credentials and config path, and a description that the action does not review pushes without open PRs.

- [ ] **Step 5: Add the consumer workflow example**

Create `examples/vetter-action.yml`:

```yaml
name: Vetter review

on:
  pull_request:
    types: [opened, reopened, synchronize]
  push:

permissions:
  contents: read
  pull-requests: write
  checks: write

concurrency:
  group: vetter-${{ github.repository }}-${{ github.head_ref || github.ref_name }}
  cancel-in-progress: true

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: vetter-lab/vetter@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          model-api-key: ${{ secrets.VETTER_MODEL_API_KEY }}
          model-base-url: ${{ vars.VETTER_MODEL_BASE_URL }}
          model-name: ${{ vars.VETTER_MODEL_NAME }}
```

- [ ] **Step 6: Build and test the Action bundle**

```bash
pnpm test -- tests/runtimes/action/context.test.ts
pnpm build:action
pnpm typecheck
```

Expected: context tests pass and `dist/action/index.js` exists for `action.yml`.

- [ ] **Step 7: Commit the Action runtime**

```bash
git add src/runtimes/action action.yml examples/vetter-action.yml dist/action
git commit -m "feat: add GitHub Action runtime"
```

## Task 9: Add Documentation and Configuration Guidance

**Files:**
- Modify: `README.md`
- Create: `docs/github-app-setup.md`
- Create: `docs/action-setup.md`
- Create: `docs/configuration.md`
- Create: `docs/testing.md`

- [ ] **Step 1: Document GitHub App installation**

Document App creation, Webhook URL and secret, subscribed events, repository selection, required permissions, environment variables, installation-token behavior, health check, and the fact that App mode requires no Action workflow.

- [ ] **Step 2: Document Action installation**

Document the example workflow, required permissions, secrets, `concurrency`, checkout requirements for analyzers, and the fact that Action mode does not require a GitHub App Webhook.

- [ ] **Step 3: Document `.vetter.yml` and override precedence**

Document every supported key, default values, allowed analyzers, severity gate behavior, branch patterns, secret restrictions, and the invariant that pushes without open PRs are skipped.

- [ ] **Step 4: Document state semantics and recovery limits**

Explain `open`, `fixed`, and `dismissed`, manual resolve behavior, bot-resolved regressions, hidden markers, summary comment ownership, no-SQL limitations, and the optional non-SQL queue boundary.

- [ ] **Step 5: Update the README with the supported modes and verification commands**

Include:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

State the expected behavior for a repeated commit, a fixed finding, a manually resolved finding, and a failed analyzer.

- [ ] **Step 6: Run documentation checks**

```bash
pnpm typecheck
pnpm test
git diff --check
```

Expected: all tests and typecheck pass, and `git diff --check` reports no whitespace errors.

- [ ] **Step 7: Commit documentation**

```bash
git add README.md docs
git commit -m "docs: document App and Action review modes"
```

## Task 10: Run Full Verification in a GitHub Sandbox

**Files:**
- Modify only test fixtures or docs if verification identifies a documented mismatch.
- Test: `tests/integration/review.test.ts`

- [ ] **Step 1: Run the complete local verification suite**

```bash
pnpm typecheck
pnpm test
pnpm build
```

Expected: typecheck, all Vitest suites, App build, and Action bundle build pass.

- [ ] **Step 2: Create a disposable test repository and install the GitHub App**

Use a repository with a deliberately introduced finding and verify that the App receives `pull_request.opened` and `synchronize` events, creates inline comments, creates the summary marker comment, and publishes `vetter / code-review`.

- [ ] **Step 3: Verify comment reconciliation manually**

Perform these commits in the test PR:

1. Add a new finding and verify one inline comment.
2. Push the same commit event twice and verify no duplicate.
3. Fix the finding and verify the thread is resolved and the summary row is `fixed`.
4. Reintroduce a bot-resolved finding and verify the thread reopens.
5. Manually resolve a still-present finding and verify it remains `dismissed`.

- [ ] **Step 4: Verify stale and rapid-push behavior**

Push two commits rapidly and confirm the older run cannot update comments or the Check Run after the newer head SHA exists. Confirm an App process restart does not produce duplicate finding comments when the next event is delivered.

- [ ] **Step 5: Verify Action mode independently**

Disable the App for a second test repository, add the example workflow, trigger PR and push events, and confirm the Action produces the same summary, thread state, and Check Run outcomes without any App Webhook.

- [ ] **Step 6: Record verification evidence**

Add the commands, test repository constraints, event payloads, and observed GitHub API results to `docs/testing.md`. Do not record tokens, private keys, or source code from private repositories.

- [ ] **Step 7: Commit final verification notes**

```bash
git add docs/testing.md tests/integration/review.test.ts
git commit -m "test: verify App and Action review flows"
```

## Plan Self-Review

### Spec coverage

- App-only operation is implemented in Tasks 7 and 10.
- Action-only operation is implemented in Task 8 and verified in Task 10.
- Shared stateless core is implemented in Tasks 2, 3, 4, and 6.
- External LLM and allowlisted analyzers are implemented in Task 4.
- Incremental diff review and current-line inline anchors are implemented in Task 3.
- Finding fingerprints and comment-driven state are implemented in Task 3 and Task 6.
- `open`, `fixed`, and `dismissed` behavior, including manual resolve and bot regression, is implemented in Task 6.
- Summary table and Check Run behavior are implemented in Task 6.
- Latest-wins, stale SHA protection, and no-PR push skipping are implemented in Tasks 7 and 8.
- Configuration precedence, runtime selection, secrets, and permissions are implemented in Tasks 2, 7, and 8.
- Retry, partial analyzer failure, prompt safety, and process limits are implemented in Tasks 4, 5, 6, and 7.
- Local, integration, runtime contract, and GitHub sandbox coverage is implemented in Tasks 1, 3, 4, 5, 6, 7, 8, and 10.

### Placeholder scan

The plan contains no placeholder instructions or unspecified implementation steps. Every task identifies files, test commands, expected outcomes, and a commit boundary.

### Type consistency

The shared `ReviewContext`, `Finding`, `ExistingFinding`, `ReviewConfig`, `GitHubGateway`, `ModelProvider`, and `AnalyzerProvider` names are defined before their first use. App and Action adapters both produce `ReviewContext`, and the core consumes the gateway and provider interfaces without runtime-specific types.
