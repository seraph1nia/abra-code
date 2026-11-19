# Proposal

## Why

A session-only lookup read all 100 executions in a disposable 100-ticket fixture, and opening Overview for one active full-OpenSpec ticket requested both OpenSpec status and apply instructions. Execution writers also repeat field ownership at 71 call sites, while reopening a review can show an older answer than the one saved in another tab.

## What Changes

- Resolve known worker sessions to a candidate ticket, then read its current execution and apply the caller’s existing role, phase, generation and ownership checks. Retain discovery and recovery for missing or stale candidates.
- Introduce a typed execution patch that describes assigned and removed fields once. Pilot it in the verification receipt commit and use that patch as the model for subsequent conversions.
- Give Overview and inspector bootstrap a lightweight ticket read. Fetch planning evidence on demand for Plan and preserve the existing full-detail contract for its callers.
- Refresh exact-identity review drafts when their first subscriber returns. Preserve pending submissions, confirmed receipts and locally unsaved edits.
- Use the validated apply observation returned by `OpenSpec.plan()` for the completion check in the same invocation.
- Give the disposable native test fixture one restart operation for its ten restart callbacks, including the crash journey’s bounded forced shutdown.
- **BREAKING** — Sort equal-priority finder rows by ascending bytewise issue ID across installations. Retire the locale-dependent rank allocator and migrate graph indexes. Existing bookmarks keep their issue IDs, but an offset can now select a different page of tied issues.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `worker-policy` gains a bounded lookup for known worker sessions with fresh authorization at each entry point.
- `work-visibility` gains independently loadable Overview evidence and replaces the finder’s locale-sensitive tie-breaker.
- `interactive-reviews` extends exact-revision draft recovery to the first subscriber after an unmounted interval. The capability is introduced by the implemented `add-interactive-plan-and-report-reviews` change.

## Impact

The affected owners are runtime worker assignment and storage, coding checks, OpenSpec, SQLite work discovery, workspace visibility and its HTTP/native contracts, the web inspector and review draft store, and the native test fixture. The proposed work uses existing dependencies.

## Scope and Choices

Land the draft fix, single OpenSpec observation and fixture restart independently. Keep the execution patch pilot small. A per-runtime session hint can reuse executions already read during plugin activation. Cached data selects where to read and fresh records determine authority. SQLite continues to own issue order and dependencies, OpenCode owns sessions, and the plugin owns execution relationships.

The finder change supersedes the **Priority ties span pages** scenario in `deepen-workspace-read-and-publication`. Preserve its bounded hydration, exact count and freshness requirements. Reconcile the finder and review deltas after their introducing changes reach canonical specs, in that order of precedence. Run the graph migration with old service processes stopped and document recovery from a pre-upgrade database backup.
