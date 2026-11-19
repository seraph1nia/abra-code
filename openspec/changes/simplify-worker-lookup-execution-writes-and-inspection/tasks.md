# Tasks

## 1. Restore review drafts when a view reopens

- [x] 1.1 Update `apps/web/src/review-state.ts` to reread storage on the transition from zero to one subscriber, using the existing session/review/revision/hash identity. Distinguish unreadable or invalid storage from a valid draft. Preserve unsaved local answers and in-flight submissions, and publish a changed snapshot to all mounted copies. Add a two-tab regression in `web-coherence.test.ts` that unmounts every view in A, edits in B, then reopens A without a page reload.
- [x] 1.2 Exercise pending and admitted receipts, unavailable storage and a foreign revision on resubscription. Assert zero sends on reopen, same-ID reconciliation, shared state across simultaneously mounted copies, and retention of unsaved edits. Run `pnpm web:build` and the focused browser review cases. Update the draft recovery description in `docs/web-workspace.md`.

## 2. Observe OpenSpec apply progress once per completion check

- [x] 2.1 In `packages/runtime/src/openspec/adapter.ts`, have `implemented()` use the validated apply result returned by its own `plan()` invocation. Preserve schema binding, prerequisite and strict validation, tracked-task consistency and all-done checks. Count one apply observation per invocation for complete and unfinished work. Change the fixture between invocations and verify the second call observes fresh progress. Run the focused OpenSpec adapter and `integration/openspec-schema.test.ts` cases.

## 3. Share the disposable native fixture restart

- [x] 3.1 Replace the ten restart callbacks in `tests/e2e/native-fixture.ts` under `packages/runtime` with one fixture-owned restart operation. Capture the owned child, observe its exit before requesting shutdown, then start its replacement, wait for readiness and activate the central location. Keep the crash journey’s five-second escalation explicit and release its timer on exit. Run the planning-recovery and instrumented crash-windows journeys using the disposable recipes in `docs/verification/`. Verify retained identity, cleanup and restart evidence in both.

## 4. Pilot explicitly owned execution patches

- [x] 4.1 Add a typed patch to `storage/store.ts` using the existing owned-field types. Omitted fields preserve current values, explicit removals clear optional fields, and a patch cannot both set and remove the same field. Apply it to the latest record inside existing coordination and reuse execution, operation, fingerprint and control-generation checks, record validators and notification behavior. In `unit/records.test.ts` and `integration/record-concurrency.test.ts`, prove unrelated concurrent evidence and extension fields survive, stale owners fail, and failed writes leave both caller and stored record intact.
- [x] 4.2 Convert the verification receipt write in `workflow/checks.ts` to set the new verification receipt and clear the old review receipt in one guarded commit. Return or synchronize the committed execution before launching Review. Exercise the existing verification and worker lifecycle paths, including a superseded operation. Retain other writers on their supported interface so the pilot can land independently.

## 5. Resolve known worker sessions by ticket

- [x] 5.1 Keep per-runtime positive session-to-ticket hints beside retained assignment reads. Reuse the executions already loaded at plugin activation and learn candidates from committed assignments and successful fallback lookups. Cover role slots, pending intent and both historical worker lists. Validate a hit against a fresh execution, discard stale hints, and search authoritative records on a miss. Avoid caching negative results across peer commits. Verify restart with preexisting records, a peer writer, an interrupted or failed assignment save, and recovery from a stale candidate.
- [x] 5.2 Route session-only prompt, context and tool assignment, progress observation, active-worker obligations and applicable role-specific report/check lookups through that reader. Preserve each caller’s membership predicate, refusal and timing, including execution-time rechecks after asynchronous work. Leave ticket-scoped inspection direct, and keep supervisor attention provenance and population queries on their own semantics. In a 100-execution fixture, instrument storage calls through the actual hook and progress paths. Require zero collection scans for known valid candidates, correct fallback on miss and zero unrelated native session reads. Run worker-assignment, visibility, guard, obligation and worker lifecycle regressions; exercise pause, role replacement and generation changes.

## 6. Load planning evidence on demand

- [x] 6.1 Extract the common overview projection from `Visibility.detail` and expose a fixed typed overview read through visibility RPC, web backend, shared HTTP contracts and browser data. Keep full detail for existing consumers and Plan. Reuse the same ticket observation within a full-detail call. Check the pinned native integration in `docs/supported-apis.md`, update the documented read, and verify the HTTP and native result shapes. Extend `unit/visibility.test.ts` to count zero OpenSpec commands, live/archive listings and proposal reads for Overview, including an unavailable worktree.
- [x] 6.2 Switch `UnloadedInspector` and Overview in `apps/web/src/inspector.tsx` to the lightweight read, including off-page URLs, refresh and scoped invalidations. Keep document bookmarks, worktree and archive Plan reads, policy-specific scope, and separate error feedback. Exercise direct Overview and Plan navigation, a slow Plan followed by a selection change, and a burst of invalidations during a slow overview read. Build the web app and run the relevant `web-workspace.test.ts` and `web-coherence.test.ts` cases. Update `docs/web-workspace.md`.

## 7. Migrate finder ties to bytewise issue ID order

- [x] 7.1 Implement the next graph format (v9) in the existing SQLite startup transaction. Fresh graphs should create only the necessary priority/ID and filtered indexes. Migrate v8 and older supported layouts, replace rank-based indexes, remove obsolete rank and collation state, and drop rank allocation from single and batch inserts. Keep the primary ordering by priority, existing Unicode search semantics, filters, totals and bounded hydration. Align finder test doubles and finder-facing projections. Check actual query plans for filtered and unfiltered pages and confirm zero rank-allocation seeks across 1,000 disposable inserts.
- [x] 7.2 Extend fast and integration work-query/work-graph suites for mixed case and punctuation across page boundaries, different runtime locales, and single/batch inserts after migration. Verify supported legacy upgrades and reopen, preserved issue IDs, dependencies, events, request payloads and retry receipts, transaction rollback on injected failure, and refusal of future versions. Update version-sensitive fixtures, including the future-version sentinel. Document the changed tie order, offset behavior, stopping old service processes, a consistent pre-upgrade backup and restoration with the matching binary in `docs/work-graph.md`.

## 8. Verify the integrated change

- [x] 8.1 Run `pnpm check`, `pnpm test:all` and strict OpenSpec validation. Retain the session read counts, overview and completion call counts, finder insert counts, and the focused browser and native journey outcomes with their fixture sizes and commands. Verify the existing ticket-scoped worker inspection still reads one ticket with zero fleet scans.

## Workflow follow-up

- When syncing or archiving spec deltas, apply `add-interactive-plan-and-report-reviews` and `deepen-workspace-read-and-publication` before this change. Confirm that the canonical finder has one tie-order requirement and the review requirement retains its original lost-response scenario.
