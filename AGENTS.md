# AI Pull Request Workflow

This document describes how an AI agent should prepare and create a pull
request for Vetter. PR descriptions should use the following fixed structure:

PR titles and descriptions must always be written in English.

- `Background`: explain the context and why the change is needed.
- `Problem`: describe the current incorrect behavior, limitation, or user impact.
- `Changes`: summarize the implementation, grouped by component or runtime when
  useful. Include a separate `Docs & tests` subsection when documentation or
  tests are changed.
- `Verification`: list the commands that were actually run and their results.

## 1. Inspect the Repository

Before changing files:

1. Read the relevant source, tests, and documentation.
2. Check the current branch and worktree with `git status --short`.
3. Preserve existing user changes. Do not reset, checkout, or delete files
   that are outside the requested scope.
4. Identify the repository's required verification commands. The standard
   commands for this repository are:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Run the narrowest relevant tests during development and run the complete
required checks before creating the PR.

## 2. Create a Working Branch

Create a new branch from the current `main` branch, unless the user has
explicitly asked to build on another branch:

```bash
git fetch origin main
git switch main
git pull --ff-only origin main
git switch -c <type>/<short-description>
```

Use a descriptive branch prefix:

- `feat/` for a new feature
- `fix/` for a bug fix
- `docs/` for documentation changes
- `refactor/` for behavior-preserving restructuring
- `test/` for test-only changes

If the worktree contains relevant uncommitted changes, keep them on the new
branch and inspect the diff before committing. Do not use a destructive command
to make the worktree clean.

## 3. Implement and Verify

Keep the change focused on the requested behavior. Update tests and
documentation when the public behavior or user workflow changes.

Before committing:

```bash
git diff --check
git status --short
pnpm typecheck
pnpm test
pnpm build
```

Only stage files belonging to the task. Use one logical commit when possible:

```bash
git add <task-files>
git commit -m "<type>: <concise imperative summary>"
```

The commit message should describe the result, for example:
`fix: open summary file links in new tab`.

## 4. Push the Branch

Push the branch and configure its upstream tracking branch:

```bash
git push -u origin <branch-name>
```

Confirm that the pushed branch contains the intended commit and no unrelated
files before creating the PR.

## 5. Create the Pull Request

Use `main` as the base branch unless the user specifies another target. Use a
short title in the same `<type>: <summary>` format as the commit message.

Create the PR with the following body structure:

```markdown
## Background

Explain the context and why this change is needed.

## Problem

Describe the current incorrect behavior, limitation, or user impact.

## Changes

### Component or runtime
- Describe the implementation change.
- Mention relevant compatibility or behavior details.

### Docs & tests
- List documentation changes.
- List test or fixture changes.

## Verification

- `pnpm typecheck` passes
- `pnpm test` passes (include the actual count when available)
- `pnpm build` passes
```

The `Changes` subsections should match the actual ownership boundaries of the
work. For a small change, one `Changes` section is enough. Do not include a
section or verification result that was not actually completed.

Example command:

```bash
gh pr create \
  --base main \
  --head <branch-name> \
  --title "fix: concise summary" \
  --body-file <pr-description.md>
```

If a temporary description file is used, it must not be committed unless it is
part of the requested documentation change.

## 6. Final Checks and Handoff

After creation, verify the PR metadata:

```bash
gh pr view <number> --json number,title,state,baseRefName,headRefName,url
git status --short
```

The final report to the user should include:

- the new branch name
- the commit SHA
- the PR URL and target branch
- the verification commands and their results
- any checks that could not be run or any remaining risk

Do not merge, close, approve, or request reviewers unless the user explicitly
asks for those actions.

## 7. Generated Distribution Files

Whenever source code is changed, rebuild the project and update the generated
files under `dist` before committing. For Action changes, `dist/action/index.js`
must be regenerated with `pnpm build:action`; for App changes, regenerate the
App distribution as part of `pnpm build`. Verify that the generated files are
included in the final diff.
