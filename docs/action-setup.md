# GitHub Action setup

Vetter's Action runtime reviews the pull request tied to the current
workflow run, using the same review core as the App runtime. Each synchronize
or push run reviews only the `before...after` commit range; the initial pull
request review uses the PR base. A repository
can run entirely on the Action with no GitHub App Webhook configured at all.

## 1. Add the workflow

Copy [`examples/vetter-action.yml`](../examples/vetter-action.yml) into
`.github/workflows/vetter-action.yml`:

```yaml
name: Vetter review

on:
  pull_request:
    types: [opened, reopened, synchronize]
  push:

permissions:
  actions: read
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
      - uses: vetter-lab/vetter@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          model-api-key: ${{ secrets.VETTER_MODEL_API_KEY }}
          config: |
            version: 1
            review:
              enabled: true
              incremental: true
              model: gpt-4o-mini
              baseUrl: https://api.openai.com/v1
              language: en
              maxDiffBytes: 200000
            events:
              push:
                enabled: true
                requireOpenPullRequest: true
                branchPatterns:
                  - "**"
            severity:
              P0: { blockMerge: false }
              P1: { blockMerge: false }
              P2: { blockMerge: false }
              P3: { blockMerge: false }
            limits:
              modelRetries: 2
```

## 2. Required permissions

The workflow's `permissions` block must grant:

- `contents: read` — to read the repository diff and optional `.vetter.yml`.
- `actions: read` — to let cancelled duplicate workflow runs stop before they write comments.
- `pull-requests: write` — to create/update inline review comments, resolve
  and reopen review threads, and post the summary comment.
- `checks: write` — to publish the `vetter / code-review` Check Run.

`secrets.GITHUB_TOKEN` already carries these scopes when the permissions
block above is present; no additional App installation is required.

## 3. Secrets and variables

| Input | Source | Purpose |
| --- | --- | --- |
| `github-token` | `secrets.GITHUB_TOKEN` (or a PAT) | Required. All GitHub API calls. |
| `model-api-key` | `secrets.VETTER_MODEL_API_KEY` | Required API key for the OpenAI-compatible review model. |
| `config` | workflow YAML | Optional inline YAML using every field in the configuration reference. It overrides `.vetter.yml`. |
| `model` | workflow YAML | Optional direct override for `review.model`. |
| `base-url` / `baseUrl` | workflow YAML | Optional direct override for `review.baseUrl`. |
| `config-path` | workflow input | Optional path to the repository's config file. Defaults to `.vetter.yml`. |

Model credentials should be stored as encrypted repository or organization
secrets, never committed to workflow YAML or `.vetter.yml`. The workflow can
be used alone, or together with `.vetter.yml`; when both exist, its `config`
and direct inputs take precedence.

## 4. Concurrency

The `concurrency` block is required, not optional. GitHub Actions has no
built-in equivalent to the App runtime's in-memory scheduler, so
`cancel-in-progress: true` on a group keyed by the source branch enforces the
same "latest-wins" rule across both triggers: `github.head_ref` supplies the
branch for a pull request, while `github.ref_name` supplies the same branch
name for a push. A new commit therefore cancels the older event's in-progress
run before it can write duplicate or stale comments.

Keep the key branch-based for both events. Do not use
`${{ github.event.pull_request.number || github.ref }}`: a pull request event
then keys by PR number while a push event keys by branch ref, allowing both
reviews for the same commit to run concurrently.

The Action runtime does not subscribe to `pull_request_review_thread`
events because GitHub Actions does not support that trigger. Resolving or
reopening a review thread is only detected on the next `synchronize` or
`push` event that triggers a review. The App runtime handles
`pull_request_review_thread` events separately and refreshes the summary
without rerunning the LLM.

## 5. Push events with no open PR

The workflow's `on: push` trigger runs on every push, including pushes to
branches with no open pull request. The Action entrypoint detects this case,
logs an informational message, and exits successfully without calling the
LLM or writing anything to GitHub — it never fails the job for a push
that isn't tied to a PR.

## 6. Action mode does not require a GitHub App

The Action runtime authenticates entirely through the workflow's own token
(`github-token`). No GitHub App installation, webhook secret, or `.env` file
is needed. If a repository is only using the Action, skip
[github-app-setup.md](github-app-setup.md) entirely.
