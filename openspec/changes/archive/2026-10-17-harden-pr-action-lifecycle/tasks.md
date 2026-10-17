# Tasks

## 1. Canonical check provenance (F3)

- [x] 1.1 Extend the typed check/status observation and consumed forge schemas with stable source, head, application, current revision and source-link evidence; add same-name required/advisory application and status-versus-check-run fixtures in `tests/unit/forge-readiness.test.ts` and verify classification remains distinct.
- [x] 1.2 Share authoritative check normalization between readiness and feedback, removing the second name-based summary reconstruction in `src/git/feedback.ts`; add the F3 regression in `tests/unit/pr-feedback.test.ts` and verify `[blocking, advisory]` remains unchanged through feedback and retry eligibility, including stale attempts, incomplete pagination and unavailable logs.
- [x] 1.3 Share one canonical observation within each owned delivery operation and preserve cadence/backoff and existing required-context/no-check behavior; verify forge-call fixtures have no duplicate policy reads and existing readiness tests pass, and update `docs/supported-apis.md` for every newly consumed field and the classification boundary.

## 2. Semantic action targets and compatible records (F2)

- [x] 2.1 Replace optional cross-kind payload combinations with validated per-kind semantic targets and a new action-record version; verify action/identity contract tests reject invalid combinations and retain existing manual body, reviewer-target and approval input restrictions.
- [x] 2.2 Add an explicit supported version-1 action decoder/normalizer preserving original IDs, forms, payloads, markers, receipts, serialized evidence and budget usage; verify storage/contract fixtures for prepared, running, uncertain, confirmed, duplicate historical and unsupported records, including conservative refusal of incomplete identities.
- [x] 2.3 Group eligible findings by repository/PR/head/workflow/run/source-attempt target and reserve one logical rerun; add the F2 two-job regression to `tests/unit/pr-actions.test.ts` and adapter coverage in `tests/unit/actions-evidence.test.ts`, verifying one reservation and at most one POST while the run still reports the old attempt, distinct-run independence and pause/restart reuse.
- [x] 2.4 Preserve old owned-reply recognition, finding history and current-head authority during mixed-version reconciliation; verify edited findings, old markers, changed generations and exhausted-budget fixtures, and document compatible action identity and non-refunded historical reservations in `docs/recovery.md`.

## 3. Preparation, submission and reconciliation (F4)

- [x] 3.1 Replace the forge action `send` flag with typed read-only preparation, bound submission and exact-target reconciliation operations; reuse reviewer eligibility logic and add adapter tests proving identity/source/permission reads cannot admit a remote write or create send uncertainty.
- [x] 3.2 Persist submission admission only after preparation and a current generation/pause check, immediately before the write; add the F4 permission-read recovery regression to `tests/unit/pr-actions.test.ts` and verify the unchanged approved action eventually sends once, reuses its reservation/form and distinguishes permanent denial from retryable unavailability.
- [x] 3.3 Classify post-admission process failures, deadlines, malformed output and interruption as potentially submitted unless typed evidence proves no effect; verify lost reply/ready/reviewer/rerun responses and crash-at-admission fixtures reconcile without duplicate submissions and cannot be retried from error-text matching.
- [x] 3.4 Update retained updates, tool/observer contracts, feedback projections and terminal labels for definite unsubmitted preparation versus uncertain writes; verify `tests/unit/tool-contracts.test.ts`, storage and visibility fixtures plus focused native renderer scenarios preserve omission, bounded errors, stale-response handling and read-only views.
- [x] 3.5 Update `docs/recovery.md` and the action section of `docs/supported-apis.md` to distinguish read failures before submission from ambiguous write outcomes; verify documented recovery steps match the typed outcomes and do not promise safe resend of legacy uncertainty.

## 4. Shared action obligations and merge clearance (F1)

- [x] 4.1 Introduce the pure controller-owned required-action calculation for ready, on-ready reviewers, verified replies, dependent thread resolution and eligible reruns; verify focused planner tests cover missing outbox records, fulfilled receipts, manual defaults, rejected obligations, stale unsent targets and uncertain possible effects.
- [x] 4.2 Use the same calculation for automatic scheduling and fresh pre-merge clearance, moving lifecycle policy out of the GitHub merge adapter while preserving its exact identity and guarded-head checks; add the F1 regression in controller/delivery fixtures and verify explicit finish, completed human merge approval and periodic reconciliation all wait for missing required actions before any merge command.
- [x] 4.3 Retain existing finding assessment, attention/correction, open-decision, external custody and forge-review barriers; verify same-head approval survives ordinary waits, changed heads reject old approval, confirmed reviewer requests do not satisfy required reviews and edited threads invalidate unsent follow-through.
- [x] 4.4 Update `docs/architecture.md` and `docs/operations.md` with the shared obligation owner and user-visible waits; verify enabled reply/resolution/reviewer settings have the same meaning across all merge routes and disabled automation creates no new public action or automatic obligation.

## 5. Cohesive controller and fixture ownership (F5)

- [x] 5.1 Move complete PR feedback/disposition/action/correction operations and due observation/action/block-recovery coordination into a focused workflow service sharing the existing `Operations`, `Records` and correction services; wire controller routes and finalization through the application composition and verify existing feedback/correction tests pass without duplicated lock acquisition or new proxy chains.
- [x] 5.2 Move external capacity/admission/custody handoff into its owning validation service while keeping native verification ordering in the lifecycle dispatcher; verify `tests/unit/external-validation.test.ts`, capacity and coordination tests retain one writer, stop/restart behavior and reservation release on preflight failure.
- [x] 5.3 Split feedback/external terminal scenario fixtures from `tests/tui/sidebar.ts` using the existing real renderer harness; verify all terminal scenarios still execute and inspect native e2e helper placement so new acceptance coverage does not add another large inline fixture.
- [x] 5.4 Bring `src/workflow/advancement.ts` and `tests/tui/sidebar.ts` below 1,000 lines without moving unrelated responsibilities into another umbrella module; verify line counts, focused public interfaces and no newly introduced or previously smaller touched module crossing 1,000 lines, and update `docs/architecture.md` and `docs/testing.md` to match the final ownership and fixture layout.

## 6. Integrated acceptance and required checks

- [x] 6.1 Extend the fake-forge native acceptance path for merge-before-monitor, two failed jobs in one attempt and recoverable permission preflight; verify one PR, one rerun reservation/submission, no early merge, preserved approval and no public writes or user-remote pushes using `pnpm test:e2e` and extracted fixture helpers.
- [x] 6.2 Run the combined restart/pause/mixed-version acceptance matrix across canonical observation, staged dispatch and required-action clearance; verify uncertain writes never replay, defaults remain unchanged, budgets/history persist and external custody still blocks a second writer or publisher.
- [x] 6.3 Run `pnpm check`, `pnpm test`, `pnpm test:e2e` and `openspec validate harden-pr-action-lifecycle --strict`; verify all pass, all F1–F5 acceptance criteria are met and every fixture uses disposable repositories/fake services without a shared no-mistakes daemon or live model.
