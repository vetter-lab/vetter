# vetter

Vetter is a stateless GitHub code review bot. It combines an external LLM with allowlisted static analyzers (Semgrep, ESLint, ruff, golangci-lint), posts inline review comments, maintains one summary comment per pull request, and publishes a `vetter / code-review` Check Run.

Vetter runs as either a **GitHub App** (webhook-driven) or a **GitHub Action** (workflow-driven) per repository. Both modes share the same TypeScript review core and never store review state outside GitHub itself — GitHub comments and review threads are the only persisted state, so there is no database to run or migrate.

## How it works

1. A pull request event or a push to a branch with an open PR triggers a review;
   resolving or reopening a review thread refreshes the summary from GitHub state.
2. Vetter loads `.vetter.yml` from the repository, merges it with built-in defaults and any runtime-level overrides.
3. It fetches the incremental diff, runs the configured LLM and static analyzers concurrently, and normalizes the results into findings.
4. It re-reads the PR head SHA immediately before mutating anything; a stale or superseded run is discarded (latest-wins).
5. It reconciles findings against existing Vetter-owned comments and threads: new findings get inline comments, fixed findings get their thread resolved, findings resolved by a human stay suppressed.
6. It rebuilds the summary comment and updates the Check Run conclusion.

See [docs/configuration.md](docs/configuration.md) for the full `.vetter.yml` reference and [docs/testing.md](docs/testing.md) for the state-machine semantics (`open` / `fixed` / `suppressed`) and behavioral guarantees.

## Choosing a runtime

- **GitHub App** — set up once per organization, works across all installed repositories without any workflow file. See [docs/github-app-setup.md](docs/github-app-setup.md).
- **GitHub Action** — added per repository via a workflow file, uses the repository's own `GITHUB_TOKEN`. See [docs/action-setup.md](docs/action-setup.md).

Only one runtime should be active for a given repository; if both are configured, set `runtime: app` or `runtime: action` in `.vetter.yml` to make the inactive one exit without writing comments.

## Development

Requires Node.js 22+ and pnpm 10.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

`pnpm build` runs the typecheck and produces `dist/app/server.js` (the App runtime, bundled with `tsup`) and `dist/action/index.js` (the Action runtime, bundled with `@vercel/ncc`).

## Documentation

- [docs/github-app-setup.md](docs/github-app-setup.md) — App creation, webhook, permissions, environment variables.
- [docs/action-setup.md](docs/action-setup.md) — Workflow setup, permissions, secrets, concurrency.
- [docs/configuration.md](docs/configuration.md) — `.vetter.yml` reference and override precedence.
- [docs/testing.md](docs/testing.md) — Finding state semantics and no-SQL recovery limits.
