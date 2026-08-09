# Finding state semantics, recovery limits, and expected behavior

Vetter has no SQL database. Every piece of review state — which findings
exist, whether they're open, and who resolved them — lives entirely in
GitHub: inline review comments, review threads, and one summary issue
comment. This document explains the state machine that follows from that
design, its recovery limits, and the behavior you should expect for common
scenarios.

## Finding states

| State | Meaning | How it's produced |
| --- | --- | --- |
| `open` | The finding is currently reported and its thread is unresolved. | A current review run reproduces the finding, and no human has resolved its thread. |
| `fixed` | The finding disappeared from a **complete incremental** review pass. | An existing bot thread is unresolved, its location is included in the commit diff, and the provider/path scope that would have reported it finished successfully this run. Vetter resolves the thread. |
| `dismissed` | A human resolved the thread themselves. | The thread is resolved and `resolvedBy` (or the fallback marker field) identifies a non-bot login. Vetter never reopens this automatically. |

State transitions are computed by the pure function `reconcileFindings` in
`src/review/domain/reconciliation/reconcile.ts`, driven entirely by comparing
this run's findings against `ExistingFinding`s reconstructed from GitHub
thread/comment state (`toExistingFindings` in
`src/review/application/review-state.ts`).

## Hidden markers

Every inline comment Vetter writes carries a hidden HTML comment:

```text
<!-- vetter:finding:v2 fingerprint="..." rule="..." severity="..." source="..." scope="..." title="..." anchor="..." bot-resolved="..." -->
```

Current comments write canonical `P0`, `P1`, `P2`, and `P3` severity values.
Finding markers always use canonical `P0`, `P1`, `P2`, and `P3` severity values
and require a verbatim code anchor. A marker without an anchor is not treated
as Vetter-managed state.

And the one summary comment carries:

```text
<!-- vetter:summary:v1 -->
```

Every summary row carries a hidden `vetter:summary-row:v1` marker so a
review-thread state refresh can preserve it, including summary-only rows
(findings without an inline review comment).

Summary rows written by older versions with `state="suppressed"` remain
readable and are canonicalized to `dismissed` when the summary is rebuilt.

During a normal review run, these summary-row markers are also used as a
fallback for a finding that is missing from a transient GitHub thread
snapshot. Thread state remains authoritative whenever the thread is present;
the fallback prevents a cancelled or overlapping run from dropping a resolved
finding from the next summary.

Vetter only ever reads or mutates a comment that (a) is authored by a
configured bot login and (b) contains a valid marker. Comments without a
marker — including other bot comments and all human comments — are never
touched. This is what makes GitHub comments a safe append/rebuild target
without a separate state store.

## Fingerprinting and matching

Each review run sends only the event's changed range to the providers. For an
initial pull request review, that range is `base...head`. For a
`pull_request.synchronize` or push event, it is `before...after`, so findings
from earlier commits are recovered from GitHub state but are not reviewed as
new input again.

A finding's identity (`src/review/domain/findings/fingerprint.ts`) is a SHA-256 digest of its
rule ID, normalized path, normalized code anchor, and normalized title —
deliberately **excluding the line number**, so a finding that moves within
a file due to unrelated edits elsewhere keeps its existing comment thread
instead of spawning a duplicate.

If the exact fingerprint doesn't match, a fallback match by rule + path + code
anchor is allowed only when it's unambiguous (exactly one existing finding
shares that identity). Requiring the anchor prevents a fixed finding from
being reused for a different occurrence of the same rule in the same file.
Ambiguous or changed-anchor candidates are treated as no match, and a new
finding/comment is created instead of risking a merge into the wrong thread.

GitHub's `line` and `originalLine` are treated as location hints, not finding
identity. For a finding with a persisted anchor, Vetter searches the previous
and current file contents and updates the summary location when the anchor
moves. If the persisted anchor is unavailable in the previous file, Vetter
falls back to the persisted line to determine whether the old location is part
of the current diff. It only marks the finding fixed when that location is part
of the current diff and the provider scope completed successfully. If the
anchor occurs multiple times, Vetter keeps the previous location rather than
guessing.

## Recovery limits (no-SQL tradeoffs)

Because there is no durable queue or database:

- **A process crash after a webhook is acknowledged (App mode) can lose
  that in-flight review.** There's no retry from a queue. In practice, a
  subsequent PR event (another push, or the next `synchronize`) triggers
  a fresh run that reconciles against whatever state is actually on
  GitHub, so the system self-heals on the next event rather than staying
  wrong forever.
- **Deleting both the bot comment and its summary row destroys the state needed
  to reconcile that specific finding.** If the summary row remains, Vetter can
  preserve the finding state until a later complete review replaces it.
- **Review state cannot be audited independently of GitHub.** There is no
  side channel to inspect what Vetter "thinks" is open besides the actual
  threads and the summary comment.
- **Duplicate webhook delivery protection is process-local in App mode.** The
  App scheduler's latest-wins `Map<string, AbortController>` and the stale
  head-SHA check in `runReview` prevent out-of-order delivery from producing
  stale comments. Action mode additionally checks the workflow run status
  before mutation so a cancelled duplicate run exits without writing.

These are accepted tradeoffs for the current design. A non-SQL durable
queue (Redis, SQS) could reduce the crash-loses-work window without
changing how finding state itself is derived — GitHub comments remain the
source of truth either way.

## Expected behavior for common scenarios

- **Repeated review of the same commit** (e.g. a duplicate webhook
  delivery, or re-running the same head SHA): produces no duplicate
  comments. Every current finding either fingerprint-matches an existing
  comment (updated in place) or is genuinely new.
- **A finding that gets fixed**: on the next run, the finding is absent
  from the provider's output, its location is part of the commit diff, and if
  that provider's scope for the affected file completed successfully, Vetter
  resolves the corresponding thread and marks it `fixed` in the summary — the
  inline comment is kept, not deleted. Findings outside the commit diff stay
  open for a later review that includes their location.
- **A finding that only moves**: when unrelated lines are inserted or deleted,
  the persisted anchor relocates the summary row but the finding remains
  `open`. Vetter does not create a second review thread merely because GitHub
  reports the original comment as outdated.
- **A finding a developer manually resolves** (clicks "Resolve
  conversation" without Vetter reopening it): stays `dismissed`
  permanently. Vetter never reopens a thread it didn't resolve itself,
  even if the same finding is detected again in a later run — as long as
  the fingerprint still matches, it's treated as intentionally dismissed.
  When the App is subscribed to `pull_request_review_thread`, the summary
  and Check Run are refreshed immediately from the webhook without
  rerunning providers. The Action runtime does not support this trigger,
  so resolving or reopening a thread in Action mode is only detected on
  the next `synchronize` or `push` event.
- **A finding that returns after Vetter resolved it as fixed, then
  regresses**: Vetter detects that the thread it previously resolved was
  bot-resolved (via `resolvedBy` or the marker's `bot-resolved` field),
  reopens the thread, and updates the comment — this is not treated as a
  dismissal.
- **A developer reopens a review thread**: the same lightweight sync changes
  the row back to `open` and recalculates the Check Run.
- **A failed or timed-out analyzer**: its findings are dropped for this
  run, but — critically — none of its previously reported findings are
  closed, because `reconcileFindings` only marks a finding `fixed` when
  the specific provider/path scope is in `completeScopes`. A failed
  provider always fails the Check Run (see `evaluateCheckRun` in
  `src/review/domain/reporting/check-run.ts`), so a `success` conclusion is a reliable signal
  that every configured provider actually ran to completion.

## Running the verification suite locally

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

`pnpm build` runs `pnpm typecheck` first, then produces `dist/app/server.js`
(App runtime, via `tsup`) and `dist/action/index.js` (Action runtime, via
`@vercel/ncc`).
