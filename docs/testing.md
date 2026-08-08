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
| `fixed` | The finding disappeared from a **complete** review pass. | An existing bot thread is unresolved, but the finding no longer appears, and the provider/path scope that would have reported it finished successfully this run. Vetter resolves the thread. |
| `suppressed` | A human resolved the thread themselves. | The thread is resolved and `resolvedBy` (or the fallback marker field) identifies a non-bot login. Vetter never reopens this automatically. |

State transitions are computed by the pure function `reconcileFindings` in
`src/review/domain/reconciliation/reconcile.ts`, driven entirely by comparing
this run's findings against `ExistingFinding`s reconstructed from GitHub
thread/comment state (`toExistingFindings` in
`src/review/application/review-state.ts`).

## Hidden markers

Every inline comment Vetter writes carries a hidden HTML comment:

```text
<!-- vetter:finding:v1 fingerprint="..." rule="..." severity="..." source="..." scope="..." title="..." bot-resolved="..." -->
```

Current comments write canonical `P0`, `P1`, `P2`, and `P3` severity values.
Comments written by older Vetter versions with `critical`, `major`, or `minor`
are translated to `P0`, `P1`, or `P3` while they are read. Unknown severity
values are not treated as Vetter-managed markers. The marker format remains
`v1`, so existing comment state can be reconciled without a separate migration.

And the one summary comment carries:

```text
<!-- vetter:summary:v1 -->
```

Summary-only rows (findings without an inline review comment) also carry a
hidden `vetter:summary-row:v1` marker so a review-thread state refresh can
preserve them.

Vetter only ever reads or mutates a comment that (a) is authored by a
configured bot login and (b) contains a valid marker. Comments without a
marker — including other bot comments and all human comments — are never
touched. This is what makes GitHub comments a safe append/rebuild target
without a separate state store.

## Fingerprinting and matching

A finding's identity (`src/review/domain/findings/fingerprint.ts`) is a SHA-256 digest of its
rule ID, normalized path, normalized code anchor, and normalized title —
deliberately **excluding the line number**, so a finding that moves within
a file due to unrelated edits elsewhere keeps its existing comment thread
instead of spawning a duplicate.

If the exact fingerprint doesn't match, a fallback match by rule + path is
allowed only when it's unambiguous (exactly one existing finding shares
that rule and path). Ambiguous fallback candidates are treated as no
match, and a new finding/comment is created instead of risking a merge
into the wrong thread.

## Recovery limits (no-SQL tradeoffs)

Because there is no durable queue or database:

- **A process crash after a webhook is acknowledged (App mode) can lose
  that in-flight review.** There's no retry from a queue. In practice, a
  subsequent PR event (another push, or the next `synchronize`) triggers
  a fresh run that reconciles against whatever state is actually on
  GitHub, so the system self-heals on the next event rather than staying
  wrong forever.
- **Deleting a bot comment destroys the state needed to reconcile that
  specific finding.** Vetter will treat the finding as never having
  existed and create a new comment for it if it reappears.
- **Review state cannot be audited independently of GitHub.** There is no
  side channel to inspect what Vetter "thinks" is open besides the actual
  threads and the summary comment.
- **Duplicate webhook delivery protection is process-local only.** The App
  scheduler's latest-wins `Map<string, AbortController>` and the stale
  head-SHA check in `runReview` are what prevent a duplicate/out-of-order
  delivery from producing wrong or duplicate comments — not idempotency
  keys or a persisted delivery log.

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
  from the provider's output, and if that provider's scope for the
  affected file completed successfully, Vetter resolves the corresponding
  thread and marks it `fixed` in the summary — the inline comment is kept,
  not deleted.
- **A finding a developer manually resolves** (clicks "Resolve
  conversation" without Vetter reopening it): stays `suppressed`
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
  suppression.
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
