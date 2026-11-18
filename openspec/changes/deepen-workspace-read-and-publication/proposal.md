# Proposal

## Why

Loading a finder page still materializes unrelated work and repeats readiness computation. Review publication also exposes an in-progress head before its revision is fully committed, which makes independent reads and restart recovery harder to reason about.

## What Changes

- Give the finder a bounded read interface. Preserve filtering, locale-sensitive ordering, exact totals and page navigation while obtaining fleet evidence separately from page rows.
- Give interactive review publication an explicit commit point. Keep the previous commit visible until a new revision is ready, and return typed outcomes for pending publication, unavailable evidence and recovery. Preserve immutable revisions, native call idempotency and feedback receipts.
- Narrow the read and publication ports as these callers move. Adopt explicit committed results within the changed paths and reuse existing Effect scopes, typed failures and guarded writes.
- Distinguish missing paths from unreadable storage at the OpenSpec archive and worktree provisioning gates. Restore the existing production browser startup budget in an independently verified step.
- Delete `docs/codebase-review.md` as the final implementation task after the change carries the accepted scope, follow-up dispositions and verification evidence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `work-visibility` — Require page-local finder projection and independent, revision-aware fleet coverage.
- `typed-contracts` — Require committed and pending review publication to remain distinguishable across reads, retries and restart. Require filesystem absence to be distinguished from observation failure at the scoped lifecycle gates.

## Impact

The main paths are the SQLite work graph, retained read projections and their workspace callers, the native interactive review owner and gateway, the OpenSpec archive and Git worktree adapters, and the browser entry graph. Keep the finder and review wire compatibility used by existing callers. Keep the work graph, native store, OpenCode and OpenSpec in their current ownership roles.

## Scope and Choices

1. Land finder reads first. SQLite owns page ordering, filters and count. A page may require an exact SQL count for substring search. Full population hydration, application-side ID ranking and fleet aggregation are separate work with separate evidence. Retain comparable 1,000- and 50,000-issue measurements and deterministic read-count checks.
2. Build review hardening on the accepted `add-interactive-plan-and-report-reviews` implementation. Recheck its final source before coding. Retain its response correlation, native admission proof and revision recovery coverage where already present. Keep stored review identities and existing checkpoint authority intact.
3. Use the narrowed interfaces in the migrated paths. Keep global execution-write changes, broad directory moves, general Effect conversions and remaining audit ideas out of this change. Record concrete follow-ups in these artifacts only where they have an identified owner or proof still needed.
4. Defer standalone diagram prep removal until callers and the effect of its manifest entry on retained renderer fingerprints and in-progress exports can be verified. Keep out-of-tree command compatibility checks with that follow-up.
5. The bounded migration here covers finder-specific indexing and review-head compatibility if required. Any incompatible persisted-format change needs its own explicit design and approval.
