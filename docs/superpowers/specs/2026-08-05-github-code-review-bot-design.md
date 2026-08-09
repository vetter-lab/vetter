# Vetter GitHub Code Review Bot Design

- Date: 2026-08-05
- Status: Design approved in brainstorming; pending implementation planning
- Scope: GitHub App and GitHub Action execution modes for one shared review core

## 1. Summary

Vetter will review code changes when a pull request is opened or updated and when a configured push updates an open pull request. A repository selects exactly one execution mode:

- GitHub App with an independent webhook worker
- GitHub Action with a repository workflow

Both modes use the same stateless TypeScript review core. The core combines an external LLM with allowlisted static analyzers, creates inline review comments, maintains one summary comment, and publishes one Check Run.

The system does not use SQL. GitHub review threads and comments are the source of persisted review state. Every bot-managed comment contains an invisible Vetter marker and a stable finding fingerprint. A newer review reconciles its findings against those comments.

The default behavior is:

- Review only branches associated with an open pull request.
- Review only the latest commit for a pull request.
- Do not block merging for any severity unless the repository explicitly configures a severity gate and requires the Vetter Check Run in branch protection.
- Respect a developer-resolved thread as a dismissal and do not reopen it automatically.

## 2. Goals and Non-goals

### Goals

- Review PR creation, PR updates, and eligible push events.
- Analyze the incremental diff plus required source context.
- Support language-agnostic LLM review and repository-configured static analyzers.
- Classify findings as `critical`, `major`, or `minor`.
- Create and update inline comments without duplicates.
- Maintain a summary table containing open, fixed, and dismissed findings.
- Resolve comments when a finding disappears after a complete analysis.
- Reopen only findings previously resolved by the bot and later detected again.
- Support configurable Check Run merge gates.
- Keep App and Action behavior identical through shared interfaces.

### Non-goals

- Automatic code changes or commits.
- Review of a push with no open PR.
- Arbitrary shell commands configured by a repository file.
- A SQL database or a separate review-state service.
- Treating comments from developers as bot-managed state.

## 3. Architecture

```text
                           +----------------------+
                           | GitHub App Webhook   |
                           +----------+-----------+
                                      |
                           +----------v-----------+
                           | App runtime adapter  |
                           +----------+-----------+
                                      |
+----------------------+              |
| GitHub Action        |--------------+
+----------+-----------+              |
           |                          |
           +------------+-------------+
                        v
              +-----------------------+
              | Shared Review Core    |
              | - diff and context    |
              | - analyzers           |
              | - LLM provider        |
              | - finding normalizer  |
              | - comment reconcile   |
              | - summary and Check   |
              +-----------+-----------+
                          |
                          v
              +-----------------------+
              | GitHub REST/GraphQL   |
              +-----------------------+
```

The planned module boundaries are:

- `review-core`: pure orchestration and reconciliation logic. It does not import GitHub SDKs.
- `github-gateway`: GitHub REST and GraphQL operations exposed through a narrow interface.
- `config`: YAML parsing, external override merging, schema validation, and default values.
- `model-providers`: an OpenAI-compatible provider interface with structured output validation.
- `analyzer-providers`: allowlisted adapters for tools such as Semgrep, ESLint, ruff, or golangci-lint.
- `app-runtime`: Webhook signature validation, App installation authentication, event normalization, and task scheduling.
- `action-runtime`: Action event parsing, token setup, and workflow concurrency configuration.

The core receives a `ReviewContext`, a `ReviewConfig`, and a snapshot of GitHub review state. It returns a set of GitHub mutations rather than calling GitHub directly. This makes the core deterministic and independently testable.

## 4. Event and Execution Flow

### Supported events

- `pull_request.opened`: review the current head commit.
- `pull_request.reopened`: review the current head commit.
- `pull_request.synchronize`: review the new head commit.
- `push`: find open PRs whose head branch matches the repository push policy; skip the event if no open PR is found.
- `pull_request.closed`: stop pending work and do not delete existing comments.

For a push associated with multiple open PRs, Vetter creates one review context per PR because the base branch and merge diff can differ. A repository can configure the accepted branch patterns. The no-PR skip rule always applies, even when a repository enables broad branch matching.

### Common pipeline

1. Normalize the event into `{repository, pullRequest, baseSha, headSha, eventId}`.
2. Load the built-in defaults, repository `.vetter.yml`, and external overrides.
3. Verify that the repository is enabled for the current runtime mode.
4. Fetch the incremental diff and required file context.
5. Run configured static analyzers and the LLM provider.
6. Validate and normalize all findings.
7. Re-read the PR head SHA. Discard the result if it is stale.
8. Read all Vetter comments, review threads, and the summary comment.
9. Reconcile findings and build GitHub mutations.
10. Apply comment, thread, summary, and Check Run mutations.

App mode uses an in-memory task key `{repository, pullRequestNumber}` and cancels older work for that key. Action mode uses a matching `concurrency` group with `cancel-in-progress: true`. Both modes perform the final head SHA check immediately before any mutation.

The App Webhook endpoint acknowledges a successfully accepted task quickly. Because there is no durable queue, a process crash after acknowledgement can lose that task; a later PR event or push normally triggers another run. A non-SQL queue such as Redis or SQS can be added later without changing review state semantics.

## 5. Finding Identity and Comment State

### Comment markers

Each inline comment contains a marker similar to:

```text
<!-- vetter:finding:v2 fingerprint="..." rule="..." anchor="..." -->
```

The PR issue comment containing the summary table contains:

```text
<!-- vetter:summary:v1 -->
```

Vetter only manages comments authored by the configured bot identity that contain a valid Vetter marker. User comments and unmarked bot comments are never modified.

### Finding fingerprint

The finding fingerprint is a SHA-256 digest of:

```text
rule id
normalized file path
normalized symbol or code anchor
normalized finding title
```

Line numbers are not included, so moving a finding within a file can reuse its comment. If the exact fingerprint does not match, a fallback match is allowed only when rule, path, and normalized title identify one unambiguous candidate. Ambiguous candidates create a new finding instead of merging automatically.

Finding markers also persist the source anchor. Vetter uses normalized anchor
matching to relocate summary lines after unrelated edits and to map a finding
back to the old side of an incremental diff. An unchanged anchor is not
marked fixed merely because GitHub reports the old review comment as
outdated; an anchor that disappears from a changed old location can be
marked fixed after the provider scope completes successfully.

### State rules

| State | Condition | Action |
| --- | --- | --- |
| `open` | Current finding exists and its thread is unresolved | Create or update inline comment |
| `dismissed` | Current finding exists and the thread was resolved by a developer | Keep resolved; do not reopen |
| `fixed` | Finding is absent from a complete analysis | Resolve an unresolved bot thread and retain it in the summary |

When a previously bot-resolved finding appears again, Vetter reopens and updates the original thread. GitHub `resolvedBy` is preferred to determine who resolved a thread. If it is unavailable, Vetter uses a marker field written when the bot resolves the thread; if the source is still unknown, Vetter conservatively treats the thread as dismissed.

An inline comment can only target a line in the current review diff. Findings that cannot be placed on a current diff line are retained in the summary with file and line information but do not create a new inline comment.

Vetter only marks a finding `fixed` when the relevant analyzer and file scope completed successfully. A failed or partial analysis never closes findings in an unverified scope.

## 6. Summary Comment and Check Run

The PR has one Vetter-managed summary issue comment. Each run rebuilds it from the current findings and existing Vetter threads. The table contains:

- severity
- state: `open`, `fixed`, or `dismissed`
- file and line
- short title
- link to the inline comment when one exists
- commit information when useful for the history

The summary retains fixed and dismissed findings. To stay within GitHub comment limits, descriptions remain in inline comments and table rows stay compact. Vetter must not silently drop rows; if the comment approaches the API limit, it switches to compact links and status-only rows.

Vetter creates one Check Run named `vetter / code-review`:

- `success` when no configured blocking severity is open.
- `failure` when a configured blocking severity is open.
- `failure` for an execution error, with the error shown in the Check Run output.
- No severity blocks merging by default.

Repository administrators must mark the Check Run as required in branch protection for it to block merging.

## 7. Configuration

Configuration is merged in this order:

1. Built-in defaults.
2. Repository `.vetter.yml`.
3. App environment configuration or Action `with`/`vars` configuration.

External configuration can override runtime enablement, event and branch policy, model selection, analyzer selection, and severity gates. Secret values are never accepted from `.vetter.yml`.

Example:

```yaml
version: 1

review:
  enabled: true
  incremental: true
  model: review-model

events:
  push:
    enabled: true
    requireOpenPullRequest: true
    branchPatterns:
      - "**"

severity:
  critical:
    blockMerge: false
  major:
    blockMerge: false
  minor:
    blockMerge: false

analyzers:
  - semgrep
  - eslint
```

Only one runtime mode is enabled for a repository. If both an App and an Action are accidentally configured, the external runtime setting is used as a guard and the non-selected adapter exits without writing comments.

Invalid configuration produces a failed Check Run and does not close existing findings. Analyzer names are allowlisted and cannot expand into arbitrary command execution.

## 8. Providers and GitHub Permissions

Recommended open source dependencies are:

- `octokit` and `@octokit/auth-app` for GitHub App authentication and API access.
- `@actions/core` and `@actions/github` for the Action entrypoint.
- `zod` for configuration and model output validation.
- `yaml` for `.vetter.yml` parsing.
- `@octokit/plugin-retry` and `@octokit/plugin-throttling` for API reliability.

The model provider uses a structured JSON contract. Invalid output is rejected and retried rather than being rendered directly as a comment. Analyzer adapters expose normalized findings and enforce timeout, output-size, and process limits.

The GitHub App requests:

- Contents: read
- Pull requests: read and write
- Checks: read and write
- Metadata: read

The Action uses equivalent `GITHUB_TOKEN` permissions or an explicitly configured App token. GraphQL is used for review thread resolution/reopening where required; REST is used for comments, review creation, and Check Runs where appropriate.

## 9. Error Handling and Security

- Validate Webhook HMAC signatures before event parsing.
- Retry transient GitHub and model errors with bounded exponential backoff.
- Re-read comments before writing after a conflict or retry.
- Never close findings after a model failure or incomplete analyzer scope.
- Treat source code, comments, and repository configuration as untrusted prompt input.
- Do not grant the model tool access or shell execution.
- Send only the incremental diff and necessary context to the external model by default.
- Redact common secrets before external transmission.
- Store App keys and model keys only in environment secrets or a secret manager.
- Run analyzers in isolated processes with time, memory, and output limits.
- Do not include secrets or full source snippets in hidden comment metadata.

The no-SQL design has explicit limitations:

- A process crash can lose an acknowledged in-memory App task.
- A deleted bot comment removes the state needed to reconcile that finding.
- Review state cannot be audited independently of GitHub comments.
- Duplicate delivery protection is process-local, so marker scans and head SHA checks are mandatory.

These limitations are acceptable for the first version. A non-SQL durable queue may improve delivery reliability without becoming the source of finding state.

## 10. Testing and Acceptance

### Unit tests

- Fingerprint generation, normalization, and unambiguous fallback matching.
- State transitions for open, fixed, and dismissed findings.
- Summary rendering and Check Run conclusion logic.
- Configuration precedence and validation.

### Reconcile integration tests

- Create a new inline comment.
- Re-run the same commit without duplicates.
- Reuse a comment after a line move.
- Resolve a missing finding after complete analysis.
- Keep a developer-resolved finding dismissed.
- Reopen a bot-resolved finding when it returns.
- Preserve findings when an analyzer scope fails.
- Reject a stale result before any mutation.

### Runtime contract tests

- Convert App Webhook and Action payloads into the same `ReviewContext`.
- Handle opened, reopened, synchronized, push, and closed events.
- Skip pushes with no open PR.
- Enforce latest-wins in both runtimes.
- Ensure the selected runtime is the only runtime that writes comments.

### GitHub sandbox tests

Use a test repository to verify permissions, REST and GraphQL pagination, inline review comments, thread resolve/reopen, summary comment replacement, Check Runs, rate-limit retry, and duplicate Webhooks. Validate the Action workflow separately with a workflow test harness.

### Acceptance criteria

- Repeating a review for one commit produces no duplicate comments.
- A fixed finding becomes `fixed` and its unresolved bot thread is resolved.
- A developer-resolved finding remains `dismissed` and is not reopened.
- A bot-resolved finding that returns is reopened and updated.
- An old commit cannot overwrite a newer review.
- Partial or failed analysis never closes unverified findings.
- Configured severity gates map correctly to the Vetter Check Run.
- A repository can run entirely with the App and no Action workflow, or entirely with the Action and no App Webhook.
