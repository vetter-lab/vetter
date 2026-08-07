# GitHub Action setup

Vetter's Action runtime reviews the pull request tied to the current
workflow run, using the same review core as the App runtime. A repository
can run entirely on the Action with no GitHub App Webhook configured at all.

## 1. Add the workflow

Copy [`examples/vetter-action.yml`](../examples/vetter-action.yml) into
`.github/workflows/vetter-action.yml`:

```yaml
name: Vetter review

on:
  pull_request:
    types: [opened, reopened, synchronize]
  pull_request_review_comment:
    types: [created]
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
      - name: Install semgrep
        run: pip install semgrep
      - uses: vetter-lab/vetter@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          model-api-key: ${{ secrets.VETTER_MODEL_API_KEY }}
          model-base-url: ${{ vars.VETTER_MODEL_BASE_URL }}
          model-name: ${{ vars.VETTER_MODEL_NAME }}
```

## 2. Required permissions

The workflow's `permissions` block must grant:

- `contents: read` — to check out the repository for static analyzers.
- `pull-requests: write` — to create/update inline review comments, resolve
  and reopen review threads, and post the summary comment.
- `checks: write` — to publish the `vetter / code-review` Check Run.

`secrets.GITHUB_TOKEN` already carries these scopes when the permissions
block above is present; no additional App installation is required.

## 3. Secrets and variables

| Input | Source | Purpose |
| --- | --- | --- |
| `github-token` | `secrets.GITHUB_TOKEN` (or a PAT) | Required. All GitHub API calls. |
| `model-api-key` | `secrets.VETTER_MODEL_API_KEY` | API key for the OpenAI-compatible review model. |
| `model-base-url` | `vars.VETTER_MODEL_BASE_URL` | Optional model endpoint override. |
| `model-name` | `vars.VETTER_MODEL_NAME` | Optional model name override, merged as `review.model`. |
| `config-path` | workflow input | Optional path to the repository's config file. Defaults to `.vetter.yml`. |

Model credentials should be stored as encrypted repository or organization
secrets, never committed to `.vetter.yml`.

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

## 5. Analyzer prerequisites

`actions/checkout@v4` must run before the Vetter step so that any
configured static analyzers have real files on disk to scan — the Action
runtime reads analyzer input from `GITHUB_WORKSPACE`, unlike the App
runtime, which does an ephemeral shallow clone per review. `fetch-depth: 0`
is recommended so incremental diffing has full history available if a future
analyzer needs it; a shallow checkout also works if you're only running
semgrep.

The default example enables `semgrep`, so the workflow installs it before
the Vetter step with `pip install semgrep`. Other analyzers must be installed
the same way before the Vetter step if they are enabled in `.vetter.yml`:

- `semgrep` — `pip install semgrep`
- `eslint` — install with the repository's package manager, and require the
  repository to have an ESLint configuration file
- `ruff` — `pip install ruff`
- `golangci-lint` — install the `golangci-lint` binary

Semgrep is a good default because it ships its own rule set and does not
depend on repository-local lint configuration.

## 6. Push events with no open PR

The workflow's `on: push` trigger runs on every push, including pushes to
branches with no open pull request. The Action entrypoint detects this case,
logs an informational message, and exits successfully without calling any
provider or writing anything to GitHub — it never fails the job for a push
that isn't tied to a PR.

## 7. Action mode does not require a GitHub App

The Action runtime authenticates entirely through the workflow's own token
(`github-token`). No GitHub App installation, webhook secret, or `.env` file
is needed. If a repository is only using the Action, skip
[github-app-setup.md](github-app-setup.md) entirely.
