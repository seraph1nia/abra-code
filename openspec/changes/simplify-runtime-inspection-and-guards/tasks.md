# Tasks

## 1. Inspect one worker using its ticket

- [x] 1.1 Extract a pure membership check beside `historicalWorkers` for current role sessions, the pending session intent, correction rounds and finishing synchronization history. Use it on the selected execution in `Queries.inspectWorker` and reuse it in session-only `Queries.assignment`. Run the worker inspection cases in `packages/runtime/tests/unit/declarations.test.ts`. Preserve historical role precedence and the existing missing-role outcome for an intent-only session.
- [x] 1.2 Extend the populated-workspace fixture pattern in `packages/runtime/tests/unit/visibility.test.ts` for the worker query. Assert one selected execution read, zero fleet scans, and only the selected native read for current and historical workers. Verify foreign sessions are refused before native access, missing executions keep their existing error, and native read failure returns `WORKER_UNAVAILABLE`. Run both focused suites with `pnpm test:one`.

## 2. Share review RPC authorization and refusal handling

- [x] 2.1 In `packages/runtime/src/web/gateway.ts`, route `reviewReceipt`, `reviewList`, `review`, `reviewAsset` and `reviewSubmit` through one typed helper that runs the existing supervisor check before the review operation, maps domain errors to the existing RPC refusal, and provides the host Effect context. Preserve each handler's typed input, result and admission dependencies. Verify with `pnpm runtime:check`.
- [x] 2.2 Exercise the registered review handlers with authorized and rejected sessions. Prove rejection prevents review-owner calls, including submission, and that owner failures retain their refusal code and message. Reuse existing gateway fixtures where available and run the focused gateway cases plus `packages/runtime/tests/fast/interactive-reviews.test.ts`.

## 3. Move visual-report history rules to their owner

- [x] 3.1 Extract the visual-report comparison from `Records.write` into a pure runtime validator beside the report contracts. Invoke it inside the existing coordinated write, before persistence. Preserve matching by request ID, JSON equality semantics for optional fields, captured identities and artifacts, published status, and notice identity and monotonic flags. Verify through the record writer that legal progress persists and removal, rebinding, or rollback raises `REPORT_HISTORY` while preserving the prior record. Run the relevant cases in `packages/runtime/tests/unit/records.test.ts` and `packages/runtime/tests/unit/report-artifacts.test.ts`.
- [x] 3.2 Fold straightforward guard cleanup into touched files. For example, in `storage/store.ts`, express the existing encoding failure as `encoded === undefined`. Check each edit for equivalent evaluation order, accepted values and error classification. Verify the storage and report suites above and review the patch for unrelated formatting or cleanup.

## 4. Break the planning and worker-admission cycle last

- [x] 4.1 As a separate planning/admission patch, extract the existing location and idle checks into a runtime-backed inspection module used by both planning and worker sessions. In `createWorkflow`, construct inspection, planning, then worker sessions. Supply initialized planning checks to authorization and admission at their existing call points. Verify the planning forward declaration and callback cycle are gone, run `pnpm runtime:check`, and exercise launch and recovery with `packages/runtime/tests/unit/planning-baselines.test.ts`.
- [x] 4.2 Verify moved-session, busy-worker and uncertain-message refusals and the timing of planning checks before native admission through the existing planning, worker lifecycle and message tests. Fold equivalent negated comparisons in the touched session code into this patch, such as expressing the waiting branch as `turn.kind === "waiting"`. Run `pnpm test:one packages/runtime/tests/unit/planning-baselines.test.ts packages/runtime/tests/unit/worker-lifecycle.test.ts packages/runtime/tests/unit/messages.test.ts`.

## 5. Verify the integrated change

- [x] 5.1 Run `pnpm check` and `pnpm test:all` on the completed patches and record the outcomes. Use the repository's disposable fixtures for native and Git journeys.

`pnpm check` passed. `pnpm test:all` passed all 826 tests across 141 files.
One planning recovery test exceeded its five-second limit during an earlier overlapping
run. The focused planning, worker lifecycle and message suites passed all 67 tests
when rerun together after repository-wide verification.
