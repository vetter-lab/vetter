# Configuration reference

Vetter is configured by merging three layers, in this order (later layers
win):

1. **Built-in defaults** (hardcoded in `src/config/load.ts`).
2. **Repository `.vetter.yml`** (checked out at the commit under review).
3. **External overrides** — App mode's `VETTER_CONFIG_JSON` /
   `VETTER_MODEL_NAME` env vars, or Action mode's `with:`/`vars:` workflow
   inputs.

The merge is a deep merge (`src/config/merge.ts`): objects are merged
key-by-key, arrays and scalars are replaced wholesale. The merged result is
validated against a Zod schema (`src/config/schema.ts`); invalid
configuration throws, which surfaces as a failed Check Run rather than a
silently-applied partial config, and never causes existing findings to be
closed (see [Task 6](../src/core/review.ts)'s "no scope closes on error"
rule).

## Full example

See [`examples/vetter.yml`](../examples/vetter.yml):

```yaml
version: 1

review:
  enabled: true
  incremental: true
  model: gpt-4o-mini
  language: en
  maxDiffBytes: 200000

events:
  push:
    enabled: true
    requireOpenPullRequest: true
    branchPatterns:
      - "**"

severity:
  P0:
    blockMerge: false
  P1:
    blockMerge: false
  P2:
    blockMerge: false
  P3:
    blockMerge: false

limits:
  modelRetries: 2
```

## Keys

### `version`

Must be exactly `1`. Reserved for future breaking config format changes.

### `runtime` (optional)

`"app"` or `"action"`. When set, the non-matching runtime refuses to write
any comments for the repository — this is the guard against accidentally
running both a GitHub App and an Action workflow against the same repo. If
omitted, both runtimes are allowed to act.

### `review`

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Whether the LLM provider runs at all. |
| `incremental` | `true` (literal) | `true` | Reserved; must always be `true` — full-file review is not supported. |
| `model` | string | `gpt-4o-mini` | Model name passed to the OpenAI-compatible provider. Can be overridden by `model-name` (Action) or `VETTER_MODEL_NAME` (App). |
| `language` | string | `en` | Language for LLM finding titles and bodies, summary comments, and Check Run text. Use a locale such as `zh-CN`, `ja-JP`, or `en`. |
| `maxDiffBytes` | positive integer | `200000` | Reserved cap on diff size sent to the model. |

### `events.push`

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Whether push events trigger a review at all. |
| `requireOpenPullRequest` | `true` (literal) | `true` | **Cannot be disabled.** `loadConfig` throws if any layer tries to set this to `false`. A push with no matching open PR is always skipped — Vetter never reviews a bare push without a PR context. |
| `branchPatterns` | string array | `["**"]` | Glob patterns (`*` within a segment, `**` across segments) matched against the pushed branch name to decide whether to look for open PRs at all. |

### `severity`

One entry per severity (`P0`, `P1`, `P2`, `P3`), each with:

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `blockMerge` | boolean | `false` for all four | When `true`, any **open** finding of that severity makes the `vetter / code-review` Check Run conclude `failure`. Repository branch protection must separately mark that Check Run as required for it to actually block merging. |

By default, no severity blocks merging — Vetter is report-only until a
repository opts in.

Severity is ordered from `P0` (highest) through `P3` (lowest). `P0` covers
critical security, data-loss, and correctness issues; `P1` covers high-impact
logic, architecture, and performance issues; `P2` covers code-quality,
maintainability, error-handling, and boundary issues; and `P3` covers concrete
low-risk style or optional improvements.

For backwards compatibility, repository and external configuration may still
use `critical`, `major`, and `minor`. They are translated to `P0`, `P1`, and
`P3` respectively. When both a legacy key and its canonical counterpart are
provided in the same layer, the canonical key wins. New configuration should
use the uppercase P0-P3 keys; `version: 1` remains valid.

### `limits`

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `modelRetries` | integer 0–3 | `2` | Additional attempts after the first, on malformed model output or transient errors. |


## Secret restriction

`.vetter.yml` can never carry credentials. Any key matching
`api[-_]?key`, `private[-_]?key`, `token`, or `secret` (case-insensitive),
at any nesting depth, causes `loadConfig` to throw immediately
(`assertNoSecretKeys` in `src/config/schema.ts`). Model and App credentials
must come from runtime environment variables or Action secrets — never from
a file checked into the repository.

## The push/no-PR invariant

`events.push.requireOpenPullRequest` is fixed to `true` and cannot be
overridden by any configuration layer. This means: **a push to a branch
with no open pull request never triggers a review**, regardless of how
broad `branchPatterns` is set. Both runtimes enforce this — the App
runtime's webhook normalizer returns no `ReviewContext`s for such a push,
and the Action runtime's entrypoint logs and exits successfully without
calling any provider.
