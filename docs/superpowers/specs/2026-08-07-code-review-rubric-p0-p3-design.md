# Code Review Rubric and P0-P3 Severity Design

> Status: superseded. This historical design predates the LLM-only review
> pipeline; any analyzer references are retained only as historical context.

**Date:** 2026-08-07

**Status:** Proposed

## Goal

Integrate the review guidance from `sanyuan0704/sanyuan-skills`'s
`code-review-expert` skill into Vetter's existing model review contract, and
replace the internal `critical`/`major`/`minor` severity enum with `P0`/`P1`/
`P2`/`P3` without losing continuity for existing repository configuration or
GitHub comments.

## Scope

The integration covers only the `code-review-expert` skill. Its agent-terminal
workflow, user confirmation flow, removal-plan template, and Markdown report
format are not runtime behavior for Vetter and will not be copied into the
model prompt.

The review rubric will be adapted to Vetter's single model call and strict JSON
output. It will guide the model to inspect:

- correctness and data integrity;
- security, authorization, injection, secret exposure, and supply-chain risks;
- error handling and asynchronous failure propagation;
- boundary conditions and input validation;
- performance, resource usage, and unbounded work;
- race conditions, check-then-act behavior, and shared state; and
- focused SOLID and architecture concerns.

The model will still review only added diff lines and must provide a concrete,
actionable finding with an in-diff line and code anchor. Purely generic advice
and unsupported style nitpicks will not be requested.

## Alternatives

### Direct skill injection

Embedding the complete external `SKILL.md` would preserve its wording but
would also expose workflow instructions that do not apply to an API-backed
review provider. It would conflict with Vetter's JSON-only response contract
and make the prompt larger and less predictable.

### Adapted rubric (selected)

Extract the relevant review criteria into a focused, version-controlled rubric
module used by the existing system prompt. Keep the current provider pipeline,
diff-anchor validation, retry behavior, and schema validation unchanged except
for the severity enum. Record the external source and MIT attribution in a
third-party notice.

### Independent second model pass

Running a second reviewer could increase coverage, but it would double model
cost and latency and require cross-pass deduplication and severity merging. It
does not solve the mismatch between the external skill's agent workflow and
Vetter's runtime contract.

## Architecture

### Review rubric

Add a focused rubric constant/module under `src/providers/` and compose it into
the existing model system prompt. The rubric defines P0-P3 semantics and
review dimensions, while the existing prompt remains responsible for marking
repository content as untrusted and specifying the JSON response shape.

The model response schema will accept exactly `P0`, `P1`, `P2`, or `P3`.
`P3` is the canonical level for concrete low-risk suggestions. The static
analyzers retain their current three-level behavior and map their lowest level
to `P3`.

### Canonical severity model

Vetter's internal `Severity` type and all rendered output use the following
ordered values:

| Severity | Meaning | Default merge behavior |
| --- | --- | --- |
| `P0` | Critical security, data-loss, or correctness issue; blocks merge when configured | `false` |
| `P1` | High-impact logic, architecture/SOLID, or performance issue | `false` |
| `P2` | Medium code-quality, maintainability, error-handling, or boundary issue | `false` |
| `P3` | Low-risk style, naming, or optional improvement | `false` |

The ordering is `P0`, `P1`, `P2`, `P3` everywhere findings are sorted or
summarized.

### Configuration migration

The schema will expose `severity.P0`, `severity.P1`, `severity.P2`, and
`severity.P3`. Built-in defaults will include all four entries with
`blockMerge: false`.

Before deep merging each repository and external configuration layer, Vetter
will translate legacy keys as follows:

```text
critical -> P0
major    -> P1
minor    -> P3
```

The translation happens per layer so external legacy overrides retain the same
precedence as their original keys. If a layer supplies both a legacy key and
its new counterpart, the new counterpart wins. Legacy keys are removed from
the normalized layer before schema validation. Configuration `version: 1`
remains valid because this is a compatible input alias, not a new config
format.

### Finding marker format

Finding markers use the v2 format with canonical P0-P3 values and a required
verbatim code anchor. Comments without a valid v2 marker are ignored as
unmanaged state. Existing fingerprints do not change because severity is not
part of the fingerprint input.

### Static analyzer mapping

Static analyzers keep their current semantic mapping while using canonical
values:

- Semgrep `ERROR` maps to `P0`, `WARNING` maps to `P1`, and other values map to
  `P3`.
- ESLint severity `2` maps to `P1`; lower values map to `P3`.
- Ruff diagnostics map to `P3`.
- golangci-lint `error` maps to `P1`; `warning` and unknown values map to
  `P3`.

This avoids inventing a P0 classification for tools whose current adapters do
not distinguish critical security or correctness failures, and keeps legacy
low-priority diagnostics at P3. P2 remains available for medium-severity
findings identified by the model or future analyzers with enough signal.

## Data flow

1. Vetter parses repository YAML and runtime overrides.
2. Each configuration layer's legacy severity aliases are normalized before
   the existing deep merge.
3. The model provider receives the existing untrusted-labeled diff/context plus
   the adapted review rubric and emits JSON with a P0-P3 severity.
4. Static analyzer results are converted directly to P0, P1, or P3 findings.
5. `normalizeFinding` validates canonical severity values and computes the
   existing fingerprint.
6. Marker parsing maps old persisted values before reconciliation.
7. Summary sorting, inline comment labels, Check Run counts, and merge gates
   consume the canonical P0-P3 values.

## Error handling and safety

- Malformed model JSON, unknown severity, and invalid diff anchors continue to
  trigger the existing retry path.
- Unknown legacy marker severities are ignored; they cannot reach the
  reconciliation or Check Run code as an unsafe cast.
- Invalid configuration still fails schema validation and does not close any
  existing finding scope.
- Repository content remains explicitly untrusted data. The adapted rubric is
  static trusted system content and cannot be overridden by diff text.
- The integration does not add new shell commands, network calls, or model
  passes.

## Testing

Add focused tests for:

- P0-P3 model response acceptance and rejection of legacy/unknown model
  severities;
- prompt inclusion of the adapted rubric and P0-P3 JSON contract;
- legacy configuration mapping, P3 defaults, and new-key precedence;
- legacy marker mapping, unknown marker rejection, and canonical marker
  rendering;
- P0-P3 ordering and Check Run counts;
- all static analyzer severity mappings; and
- the existing review reconciliation path continuing to accept old comments.

Run the complete test suite, typecheck, and production build. Update the
configuration example and reference documentation to show P0-P3 and explain
the legacy aliases.

## Attribution

The adapted review guidance is based on `sanyuan0704/sanyuan-skills`,
`skills/code-review-expert`, at the source revision documented in
`THIRD_PARTY_NOTICES.md`. The MIT license and copyright notice will be
preserved there.
