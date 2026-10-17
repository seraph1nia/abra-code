# Tasks

## 1. Policy contracts, profiles and compatible persistence

- [x] 1.1 Add validated profile, publication, reviewers, discussion, CI-retry and validation-engine settings to config/onboarding/tool contracts; verify invalid enums, negative/unbounded budgets and malformed target identities are rejected by contract tests before mutation.
- [x] 1.2 Implement the strict/standard/quick resolver, explicit override provenance and registration-update precedence; verify a table of profile/workflow combinations, custom overrides, research behavior and profile-omitting updates preserves documented semantics.
- [x] 1.3 Persist optional task profile preference through work model/intake/SQLite/request codecs with an additive migration; verify legacy implicit/explicit request retries retain their IDs and changing an explicit task profile rejects request rebinding atomically.
- [x] 1.4 Extend execution policy snapshots with resolver provenance and independent automation/engine authority; verify repository edits, software reload and retry cannot widen an active execution's authority or select a different workflow.
- [x] 1.5 Document profiles and independent settings in `docs/configuration.md` and project examples; verify every documented example decodes and legacy examples retain native/manual conservative defaults.

## 2. Durable feedback and action contracts

- [x] 2.1 Define versioned observation, finding revision, applicability, disposition, diagnostic batch and outward-action contracts using existing identity/schema conventions; verify malformed identities, timestamps, impossible states and unknown versions yield bounded preserved-record diagnostics.
- [x] 2.2 Add retained feedback/action/history access through `Records` with controller ownership and revision checks; verify concurrent updates preserve newer worker progress, approval/decision history and immutable finding revisions.
- [x] 2.3 Implement active finding, batch/text/log and paged-history limits; verify overflow/incomplete substantive content cannot evict unresolved findings or produce merge clearance.
- [x] 2.4 Document feedback identity, revision, completeness and history ownership in `docs/architecture.md`; verify a restart fixture retains unhandled and handled revisions without inventing a clean observation for a legacy record.

## 3. GitHub observation and failure evidence

- [x] 3.1 Share canonical current-attempt check/status and required/advisory policy evaluation between observation and readiness; verify `tests/unit/forge-readiness.test.ts` retains missing-context, app-binding, newer-attempt and required-only behavior.
- [x] 3.2 Extend the forge adapter with typed submitted reviews, published thread/comment connections and ordinary PR-comment reads; update `tests/unit/forge-findings.test.ts` to verify empty-body inline reviews, comment-only feedback, bots, old unresolved threads and later review verdicts.
- [x] 3.3 Implement complete nested pagination and before/after PR identity checks; verify mixed-head, unavailable-page, malformed-source and unpublished-review fixtures never establish feedback clearance.
- [x] 3.4 Add bounded Actions run/job failure-evidence reads with independent detail-availability status; verify unavailable logs preserve a known check failure while advisory failures remain non-repairing under required-only policy.
- [x] 3.5 Record newly consumed GitHub fields/endpoints and permission requirements in `docs/supported-apis.md`; verify adapter fixtures exercise every consumed identity/completeness field and no observation invokes a mutation.

## 4. Quiet monitoring and bounded diagnostic attention

- [x] 4.1 Integrate due feedback reconciliation with the central native monitor for pending approval and known CI/review delivery blocks; verify controlled-clock tests cover cadence/backoff, eventual recovered CI and observation before a human merge decision.
- [x] 4.2 Implement semantic revision deduplication, old-head applicability and own-reply recognition; verify unchanged polls/restarts create no model turns and edited feedback creates a new assessable revision without dropping prior evidence.
- [x] 4.3 Add persisted PR-feedback diagnostic batches and native admission identity reuse to `AttentionService`; verify lost-response restart, capacity contention, concurrent new revisions and diagnostic exhaustion/zero budget produce one admission or a durable user-needed decision as specified.
- [x] 4.4 Add a central feedback-disposition route and extend bounded diagnostic tool permissions; verify stale generation/head/revision arguments and worker calls fail while authorized classification cannot approve merge, post a reply or expand scope.
- [x] 4.5 Document ordinary PR waits versus actionable feedback and diagnostic budgets in `docs/operations.md`; verify pause, non-PR work, uncertain ownership and active writers admit no background diagnostic or repair.

## 5. Correction loop and pre-merge coordination

- [x] 5.1 Revalidate selected retained finding revisions against current authoritative sources and scope before correction; verify old-thread reassessment, edited/deleted findings, changed PR/head/target and scope-changing feedback are handled without automatic scope expansion.
- [x] 5.2 Make corrective round reservation/native admission retryable with the existing owned operation; verify a lost launch response consumes one round, duplicate/repeated findings require inspection and zero/exhausted repair policy retains a decision.
- [x] 5.3 Connect feedback rounds to the existing verification/independent Review/revision-archive lifecycle; extend `tests/unit/corrections.test.ts` to prove unchanged PR identity, immutable prior archives and rejection of old-head merge forms after correction.
- [x] 5.4 Add a fresh feedback/action clearance barrier immediately before guarded merge; verify concurrent diagnosis/correction, unconfirmed sources, unaddressed findings and scope decisions prevent merge while ordinary same-head waits retain authorization.
- [x] 5.5 Update `tests/unit/delivery-wait.test.ts` and `docs/recovery.md` for failed-check recovery and feedback-bound waits; verify restart resumes eligible work without manual retry, duplicate PR creation or weakened forge protections.

## 6. Recoverable outward actions and draft PR lifecycle

- [x] 6.1 Implement the controller-owned prepared/running/uncertain/confirmed action outbox and source reconciliation seam; verify command-response loss, identity change and ambiguous effects never replay an outward action blindly.
- [x] 6.2 Add provisional publication evidence and draft creation/update after idle Apply under explicit publication policy; verify early drafts show pending gates, reuse the same owned PR and cannot authorize final delivery, cleanup or issue closure.
- [x] 6.3 Implement automatic-ready and manual-ready controller actions after current verification/Review/archival; verify failed checks, changed heads and externally changed draft state cannot fabricate gate receipts or create a second PR.
- [x] 6.4 Preserve manually authored PR content through provisional and final summary updates; verify existing marker ambiguity/content-limit behavior and actual pending/passed evidence in temporary forge fixtures.
- [x] 6.5 Document draft settings, manual waits and uncertain-action recovery in `docs/configuration.md` and `docs/recovery.md`; verify defaults retain final-ready publication and setup/research do not acquire early-draft behavior.

## 7. Reviewer requests and public review follow-through

- [x] 7.1 Add evidence-backed reviewer suggestions from supported CODEOWNERS/recent authorship and eligibility reads; verify suggestions alone send no request and configured/manual users/teams are validated against the exact repository.
- [x] 7.2 Implement manual/on-ready reviewer requests and separate correction re-request authority through the action outbox; verify pending/submitted-review reconciliation prevents repeated notifications across polling, response loss and restart.
- [x] 7.3 Prepare bounded replies from published corrective-head verification/Review receipts and add authorized inline/ordinary discussion writes; verify unpublished fixes, edited finding revisions, private context and own-reply loops cannot produce unsupported public responses.
- [x] 7.4 Implement separately authorized thread resolution after refreshing revisions, addressed evidence and viewer permission; verify new objections invalidate stale resolution, replies/resolution have separate receipts and no action dismisses a review verdict.
- [x] 7.5 Extend merge clearance with required/uncertain discussion actions and retain remote conversation-resolution requirements; verify prepared replies alone cannot satisfy policy and same-head required reviews still gate merge.
- [x] 7.6 Document reviewer targets, reply/resolution authority and authenticated action identity in `docs/configuration.md` and `docs/operations.md`; verify manual defaults produce no GitHub writes and public-action recovery tests cover removed/edited action markers.

## 8. Finite GitHub Actions reruns

- [x] 8.1 Add exact-head run/attempt eligibility, explicit workflow allowlists and retained transient/infrastructure classification; verify missing contexts, code defects, advisory/non-Actions checks, active attempts and unknown ownership do not trigger automatic reruns.
- [x] 8.2 Implement failed-job rerun actions with an independent reserved budget and fresh attempt observation; verify one eligible retry consumes one rerun and no code-repair round, with no debug logging or fork-approval bypass.
- [x] 8.3 Reconcile uncertain rerun responses and exhausted retries with feedback attention/merge clearance; verify lost responses do not duplicate retries and no in-flight attempt or exhausted failure is reported as success.
- [x] 8.4 Document allowed workflows, failure classification and separate budget semantics in `docs/configuration.md` and `docs/operations.md`; verify controlled-clock fixtures preserve counters across new heads and restart.

## 9. Optional no-mistakes protocol and setup

- [x] 9.1 Add a version/feature-probed no-mistakes adapter and pinned maintained TOON decoder; verify isolated v1.84-compatible fixtures cover launch receipts, quoted/multiline findings, structured errors, active gates, terminal/unknown outcomes and malformed output without touching shared runtime state.
- [x] 9.2 Add explicit central validation setup/preflight with executable, initialization, daemon and finite fix-limit diagnostics; verify native-only projects ignore missing engines and selection never silently initializes hooks/remotes, installs tools or restarts a shared daemon.
- [x] 9.3 Define versioned external run, custody, gate response and adoption receipts plus the `validating_external` lifecycle state; verify legacy record compatibility, active capacity/retained-resource accounting and rejection of unknown/inconsistent custody evidence.
- [x] 9.4 Document the initial supported no-mistakes CLI/output contract and integration-owned skipped stages in `docs/supported-apis.md`; verify all advertised flags/consumed fields have executable fixture coverage rather than assuming newer versions are compatible.

## 10. External validation lifecycle and custody recovery

- [x] 10.1 Admit external validation from an idle clean implementation commit with retained intent, run budget, launch nonce and generation; verify exact target branch, `--skip=rebase,push,pr,ci`, bounded waits and private-intent handling through a recording process fixture.
- [x] 10.2 Drive one active external run and finite in-scope gates through retained decisions; verify scope/protected-path/verification exceptions require explicit decisions, `--yes` is not inferred and elapsed waits reattach without another run reservation.
- [x] 10.3 Enforce external custody against native Apply, correction, publication and retirement; verify concurrent controller actions and worker shell attempts cannot become a second writer or external pipeline driver.
- [x] 10.4 Adopt only offered guarded synchronization/custody actions and preserve external fix commits; verify conflicting refs, missing objects, unexpected skipped stages/overrides and uncertain responses retain a recovery blocker without destructive fallback.
- [x] 10.5 Rerun configured native verification and independent Review on the adopted content before archival/publication; verify external success never supplies a native receipt or bypasses fresh merge approval after a changed head.
- [x] 10.6 Implement restart, pause, explicit abort/scope invalidation and custody-return reconciliation; verify original run/admission reuse, no blind gate-response replay, no deletion of external-owned worktrees and no replacement writer while termination/custody is uncertain.
- [x] 10.7 Document engine selection, explicit setup, finite run/fix budgets, pause semantics and recovery in `docs/configuration.md`, `docs/operations.md` and `docs/recovery.md`; verify examples through decoded fixtures and keep shared daemons/runs untouched by tests.

## 11. Native tools, TUI policy and feedback visibility

- [x] 11.1 Extend typed controller tools and read-only visibility projections with feedback, policy provenance, action receipts, rerun/run budgets and custody detail; verify successful wire outputs, bounded errors and stale-generation rejection with contract tests.
- [x] 11.2 Add lazy ticket feedback/history/action/external-validation views using host theme and native navigation; extend `tests/tui/sidebar.ts` to verify CI waits, round 1/2, stale observations, reviewer state, uncertain replies and external answer owners at narrow/wide layouts.
- [x] 11.3 Add explicit controller-routed draft/reviewer/reply/resolution/rerun/external-gate controls with concrete target and authority; verify opening/refreshing views never mutates state and worker/wrong-location calls remain rejected.
- [x] 11.4 Preserve after-commit invalidation, offline freshness, keymap remapping, editor/dialog focus and scoped disposal; verify native observer/TUI tests cover late responses and history after worktree retirement.
- [x] 11.5 Update `docs/architecture.md` and `docs/operations.md` with the final plugin/service ownership and user flows; verify documented controls match the delivered tool and projection contracts.

## 12. Integrated acceptance and required checks

- [x] 12.1 Add a native fixture-provider end-to-end scenario for implementation -> draft -> verification/Review/archive -> ready/reviewer request -> CI/review feedback -> scoped correction -> evidence reply/thread resolution -> fresh approval -> merge/preservation/retirement; verify one PR, preserved archives and no user-remote/public writes.
- [x] 12.2 Add integrated recovery coverage for CI reruns and an optional fake external engine across launch/response loss, restart, pause and head changes; verify independent budgets, single writer/publisher and explicit refusal of unsupported protocols or incomplete feedback.
- [x] 12.3 Run `openspec validate add-continuous-pr-feedback --strict`, `pnpm check`, `pnpm test`, and `pnpm test:e2e`; verify all required checks pass and all fixtures use temporary repositories, fake forge/external processes and no live model or shared runtime mutations.
