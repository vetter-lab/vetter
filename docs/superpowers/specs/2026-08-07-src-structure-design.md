# Source Structure and Prompt Maintenance Design

- Date: 2026-08-07
- Status: Pending user review
- Scope: Reorganize the TypeScript source tree and split the review prompt into maintainable sections without changing runtime behavior.

## 1. Context

Vetter currently groups most review logic under `src/core` and both model and
static-analyzer integrations under `src/providers`. The top-level folders are
easy to find at first, but their contents are becoming mixed:

- `core` contains domain types, diff parsing, finding identity, persisted
  comment markers, reconciliation, reporting, and the end-to-end review
  application service.
- `providers` contains model contracts, an OpenAI adapter, prompt policy,
  secret redaction, analyzer contracts, process execution, and four analyzer
  adapters.
- `core/review.ts` combines orchestration, GitHub-state reconstruction, and
  comment mutation rendering.
- The model prompt is currently one composition file. Its rubric, output
  contract, untrusted repository content handling, and secret redaction will
  become harder to evolve independently as more review modes are added.

The existing design documents already describe separate review-core,
GitHub-gateway, model-provider, analyzer-provider, and runtime boundaries. This
change makes those boundaries visible in the source tree while keeping the
current public behavior and build entrypoints.

## 2. Goals

- Organize source files by review domain, application orchestration, external
  integrations, and runtime composition.
- Make prompt policy, dynamic repository content, output contract, and secret
  redaction independently maintainable.
- Keep `runReview`, provider factory functions, gateway interfaces, runtime
  entrypoints, and prompt output behavior compatible.
- Keep imports explicit and avoid introducing path aliases or a broad barrel
  export layer.
- Move tests to mirror the new ownership boundaries.
- Preserve a review implementation that can still be tested without live
  GitHub or model calls.

## 3. Non-goals

- No new review features, prompt wording changes, model calls, or analyzer
  behavior.
- No change to the GitHub state machine, finding fingerprints, severity
  semantics, or configuration precedence.
- No complete ports-and-adapters rewrite or dependency injection framework.
- No compatibility aliases for old internal source paths. The package is
  private and its supported package entrypoint remains `src/index.ts`.
- No split of cohesive external adapters such as the Octokit gateway unless a
  compilation or test boundary requires it.

## 4. Target Architecture

```text
src/
  config/
    load.ts
    merge.ts
    migrate.ts
    schema.ts
    types.ts
  review/
    domain/
      types.ts
      severity.ts
      branch-pattern.ts
      diff/
        types.ts
        parser.ts
        anchor.ts
      findings/
        text.ts
        fingerprint.ts
        normalize.ts
      reconciliation/
        markers.ts
        reconcile.ts
      reporting/
        summary.ts
        check-run.ts
    application/
      run-review.ts
      review-state.ts
      review-comments.ts
  integrations/
    github/
      auth.ts
      gateway.ts
      octokit-gateway.ts
      types.ts
    analyzers/
      types.ts
      registry.ts
      process.ts
      semgrep.ts
      eslint.ts
      ruff.ts
      golangci-lint.ts
    models/
      model.ts
      openai-compatible.ts
      review-contract.ts
      prompts/
        review/
          index.ts
          builder.ts
          system.ts
          user.ts
          rubric.ts
          output-contract.ts
      security/
        redact.ts
  runtimes/
    app/
      checkout.ts
      events.ts
      scheduler.ts
      server.ts
    action/
      context.ts
      main.ts
  index.ts
```

### 4.1 Review domain

`review/domain` contains deterministic review rules and data structures. It
may use standard library code and the existing pure diff parser dependency,
but it must not import GitHub SDKs, OpenAI SDKs, process execution helpers, or
runtime modules.

- `types.ts` owns `ReviewContext`, finding shapes, finding states, and review
  sources.
- `severity.ts` owns canonical severity ordering and persisted-value parsing.
- `branch-pattern.ts` owns the pure branch matching policy.
- `diff/` separates parse-diff conversion from added-line anchor lookup. The
  `diff/types.ts` file prevents parser and anchor modules from importing each
  other for type definitions.
- `findings/` owns text normalization, fingerprint computation, finding
  normalization, and existing-finding matching.
- `reconciliation/` owns marker parsing and the open/fixed/suppressed state
  transition plan.
- `reporting/` owns summary rendering and Check Run evaluation.

`reporting/check-run.ts` will receive a narrow severity policy shape rather
than importing the full Zod-derived `ReviewConfig`. The application layer
passes `config.severity` into that shape. This keeps the domain independent
of configuration parsing while preserving the same conclusion and count
rules.

### 4.2 Review application

`review/application` owns the end-to-end use case and is allowed to depend on
domain modules, configuration types, and integration contracts.

- `run-review.ts` keeps `runReview` and the provider execution, stale-head
  guard, reconciliation, summary, and Check Run orchestration.
- `review-state.ts` reconstructs `ExistingFinding` values from GitHub comments
  and review threads.
- `review-comments.ts` renders inline comment bodies and applies the inline
  review/thread mutation portion of a reconciliation plan.

The split is intentionally limited. Patch synthesis and the orchestration
sequence remain in `run-review.ts` because they describe one application use
case rather than independent domain rules.

### 4.3 External integrations

`integrations` contains implementations and narrow contracts for systems
outside the review domain.

- `github/` moves the existing gateway interface, GitHub data types,
  authentication, and Octokit implementation together.
- `analyzers/types.ts` owns analyzer input/result/provider contracts.
- `analyzers/registry.ts` owns the allowlist and analyzer factory.
- `analyzers/process.ts` owns process execution and `ProcessRunner`.
- The four analyzer files remain one adapter per tool.
- `models/model.ts` owns the model provider contract.
- `models/openai-compatible.ts` owns OpenAI-compatible transport and retry
  behavior.
- `models/review-contract.ts` owns the Zod response schemas and the canonical
  response contract data shared by validation and prompt rendering.

### 4.4 Prompt structure

The public prompt entrypoint is `integrations/models/prompts/review/index.ts`.
The model adapter imports only `buildReviewPrompt` and the prompt result type;
it does not know how the prompt is assembled.

The review prompt is composed from pure modules:

- `builder.ts` coordinates the system and user builders.
- `system.ts` combines role, untrusted-data safety instructions, rubric, and
  output requirements.
- `user.ts` renders the diff and optional context files as explicitly marked
  untrusted repository data.
- `rubric.ts` contains review dimensions and P0-P3 guidance.
- `output-contract.ts` renders the model response contract from
  `models/review-contract.ts`.
- `security/redact.ts` remains a separate security boundary and is called
  before repository text is interpolated into any model message.

The stable API remains `buildReviewPrompt(input): ReviewPrompt`, with the same
`system` and `user` fields. Future prompt variants can be added under
`prompts/<task>/` or `prompts/review/<variant>/` without putting conditional
string assembly into the model transport adapter. A template engine or prompt
DSL is deliberately out of scope.

The initial refactor must preserve the current rendered strings and section
ordering for the same input. Prompt content changes require a separate
behavioral change and test review.

## 5. Dependency Rules

```text
runtimes -> application, config, integrations
application -> domain, config, integration contracts
integrations -> domain types and external SDKs/process APIs
config -> domain severity/type primitives only
domain -> standard library and pure parsing dependencies
```

Specific rules:

- No module under `review/domain` imports from `runtimes` or
  `integrations`.
- Runtime modules instantiate concrete adapters and remain the composition
  root for App and Action execution.
- Model and analyzer implementations may consume domain finding types, but
  domain code does not import their implementation details.
- The prompt builder does not import the OpenAI SDK.
- The OpenAI adapter does not construct prompt sections directly.
- No new path aliases are added; relative `.js` imports remain consistent
  with the repository's NodeNext configuration.

## 6. Migration Map

The implementation will move files and update imports as follows:

| Current path | Target path or change |
| --- | --- |
| `src/core/types.ts` | `src/review/domain/types.ts` |
| `src/core/severity.ts` | `src/review/domain/severity.ts` |
| `src/core/branch-pattern.ts` | `src/review/domain/branch-pattern.ts` |
| `src/core/diff.ts` | `src/review/domain/diff/types.ts`, `parser.ts`, `anchor.ts` |
| `src/core/normalize.ts` | `src/review/domain/findings/text.ts` |
| `src/core/fingerprint.ts` | `src/review/domain/findings/fingerprint.ts`, `normalize.ts` |
| `src/core/markers.ts` | `src/review/domain/reconciliation/markers.ts` |
| `src/core/reconcile.ts` | `src/review/domain/reconciliation/reconcile.ts` |
| `src/core/summary.ts` | `src/review/domain/reporting/summary.ts` |
| `src/core/check-run.ts` | `src/review/domain/reporting/check-run.ts` |
| `src/core/review.ts` | `src/review/application/run-review.ts`, `review-state.ts`, `review-comments.ts` |
| `src/config/*` | Stay in `src/config`; add `config/types.ts` for `RuntimeMode` |
| `src/github/*` | `src/integrations/github/*` |
| `src/providers/analyzer.ts` | `src/integrations/analyzers/types.ts`, `registry.ts` |
| `src/providers/process-analyzer.ts` | `src/integrations/analyzers/process.ts` |
| `src/providers/{semgrep,eslint,ruff,golangci-lint}.ts` | `src/integrations/analyzers/` |
| `src/providers/model.ts` | `src/integrations/models/model.ts` |
| `src/providers/openai-compatible.ts` | `src/integrations/models/openai-compatible.ts` |
| `src/providers/prompt.ts` | `src/integrations/models/prompts/review/` |
| `src/providers/review-rubric.ts` | `prompts/review/rubric.ts` |
| `src/providers/redact.ts` | `src/integrations/models/security/redact.ts` |
| `src/runtimes/*` | Stay in place; update imports only |
| `src/index.ts` | Stay in place |

Tests will mirror the new ownership paths. Historical planning documents that
describe the original implementation layout will remain historical records;
current testing documentation will be updated where it references moved
source files.

## 7. Compatibility and Error Handling

- `runReview`, gateway factories, analyzer factories, model factories,
  `buildReviewPrompt`, and `runAnalyzerProcess` retain their current function
  contracts.
- App and Action build commands remain unchanged.
- Finding markers, severity migration, fingerprints, and GitHub mutations are
  unchanged.
- Prompt rendering is byte-for-byte stable for existing inputs.
- Moving the Check Run input from `ReviewConfig` to a narrow structural policy
  does not change its error or conclusion behavior.
- Failed providers continue to report incomplete scopes and cannot close
  findings outside verified scopes.
- No new error recovery or fallback behavior is introduced by the reorg.

## 8. Testing and Verification

Tests will be moved with the modules and updated to import the new paths.
Focused prompt coverage will verify:

- the composed system prompt contains the rubric, safety instructions, and
  canonical response contract;
- diff and context files remain clearly marked as untrusted;
- secret-shaped values are redacted before interpolation;
- section ordering remains stable; and
- the model response schema accepts exactly the same P0-P3 contract and
  rejects legacy/unknown severity values.

The implementation is complete only after all of the following pass:

```text
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

The final diff must show no changes to generated `dist` output unless the
existing build process requires them, and no prompt text changes beyond
reformatting into equivalent sections.

## 9. Risks and Mitigations

- Relative import errors during moves are caught by `pnpm typecheck` and the
  full test suite.
- Prompt contract drift is reduced by co-locating response schemas with the
  canonical contract data and testing the composed prompt.
- Over-fragmentation is limited by keeping cohesive adapters intact and
  splitting only the current mixed review application and diff modules.
- Future prompt additions should add or update a focused section module and
  its test, rather than editing the transport adapter.
