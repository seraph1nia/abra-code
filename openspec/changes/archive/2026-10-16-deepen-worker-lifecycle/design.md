# Design

## Context

See `proposal.md` for motivation and scope. The relevant implementation is split across:

- `src/workflow/sessions.ts`: admission, model resolution, session creation intents, prompt IDs, native interruption and idle checks.
- `src/workflow/advancement.ts`: worker outcome interpretation in `checkpoint`, session-directory validation and retained-prompt resubmission in `reconcileOne`, plus duplicated stop completion in `pause` and reconciliation.
- `src/workflow/capacity.ts`: coordinated budget checks and durable reservations, shared with readiness and other execution admission.
- `src/workflow/operations.ts` and `src/storage/store.ts`: execution ownership, control generations, validated record commits and preservation of concurrent observations.

`Runtime.session` includes queued native inbox items in busy state. `createSession` and queued prompt admission accept caller-generated IDs; cancellation of an admitted native prompt is separate from interrupting the controller Effect. These contracts are documented in `docs/supported-apis.md` and already exercised by the native fixture.

The existing `execution-coordination`, `native-supervision` and `work-policies` specs remain authoritative. This change has no spec-level behavior changes and declares `skip_specs: true`.

## Goals / Non-Goals

**Goals:**

- Give the worker lifecycle module ownership of both native admission and the interpretation needed to recover that admission.
- Hide raw native busy/outcome handling, prompt resubmission and worker-capacity release from workflow stage code.
- Preserve clear differences between a new authorized turn, recovery of an existing admission and observation of completion.
- Keep lifecycle behavior testable through the existing controller interface with live and fixture runtime adapters.

**Non-Goals:**

- No generic workflow engine, phase graph configuration, new background loop or per-role implementation hierarchy.
- No replacement of `Capacity`, `Operations`, `Coordination` or versioned record validation.
- No policy-contract redesign, general evidence-invalidation abstraction, persisted schema change or new automatic retry/resume behavior.
- No changes to supervisor attention delivery, report submission, delivery/retirement gates, or the existing steering command.

## Decisions

### 1. Deepen WorkerSessions at the existing native worker seam

Keep `WorkerSessions` as the implementation owner. Give it a small set of operations for admitting an authorized turn, reconciling retained admission, requiring a successful completed turn, confirming native stop, and requiring quiescence. Existing names can be retained where their meaning still fits; any new result types belong next to this module, not in the public tool or storage contracts.

Use one internal observation path to interpret recorded role/session identities and native outcomes. Preserve the existing route-specific directory checks and idle checks when moving them. Both explicit completion checks and background recovery use that observation logic, but only the recovery operation may resubmit a retained prompt. Controller stage code should consume domain dispositions rather than native session snapshots.

The reconciliation result distinguishes waiting/ongoing work, successful completion with its completed role, native failure/interruption with retained diagnostics, and absence of a retained turn. Unexplained or contradictory evidence remains a typed `CrewError`; it must not be converted into success or permission to replace a worker. Capacity denial remains an explicit retained wait through the existing `Capacity.reserve` behavior.

The completed role must survive observation until the controller checks role-specific evidence, particularly a missing independent Review report. Native failure diagnostics retain session, model and timestamp details as today. Moving the current `stoppedWorker` interpretation into the module should remove the caller's need to construct that diagnostic from native state.

**Alternative considered:** another coordinator forwarding calls to `WorkerSessions` while `Advancement` keeps interpreting native outcomes. This leaves the same ordering constraints at the caller and produces a shallow module. A single large workflow reducer would also mix native admission knowledge with unrelated planning, delivery and cleanup rules.

### 2. Keep authorization and role selection with the controller

`Advancement` continues to decide which role may run, validate accepted plans or verified content, handle declared obligations, choose the next phase and update the issue claim/status. In particular:

- Apply admission after capacity waiting must still revalidate the accepted plan.
- Review admission after capacity waiting must still require a matching verification fingerprint, without rerunning successful checks.
- A successful native worker outcome must still pass the existing policy-specific checkpoint gates.
- A cleared decision may cause the controller to request a new turn under the existing rules; the worker module must not infer that a question answer approves a plan or resumes paused work.
- Background reconciliation preserves blocked, failed, interrupted and recovery-required executions until their existing explicit control route permits progress.

Keep the existing precedence in `reconcileOne`: pending control/stop handling, stopped execution handling, claim and identity validation, obligations/approval/delivery paths, role-specific admission gates, then worker reconciliation or stage work as applicable. Do not broaden recoverable phases or infer new roles while extracting native mechanics.

Diagnostics and attention may still read `Runtime` through their current read-only interfaces. The ownership improvement concerns mutations and interpretation of worker turns in lifecycle progression, not a prohibition on all runtime reads elsewhere.

**Alternative considered:** allowing `WorkerSessions` to choose phases or verify plans itself. That would couple native mechanics to all three workflow policies and obscure controller authority.

### 3. Separate a new turn from recovery of retained admission

A new authorized turn may reuse the role's existing session while minting a new prompt ID. It retains current model selection, worker start time and progress-reset behavior. This is the path used for normal handoffs and explicit authorized retries.

Recovery must inspect and reuse `session_intent.id` when session creation has an uncertain outcome. Once `prompt_id` has been persisted for an uncertain admission, recovery reuses that same ID and session; it does not call the new-turn path and mint another prompt. Preserve the existing native idempotency contract without claiming exactly-once execution of arbitrary external effects.

Persist reservation/session/prompt intent before external submission. Keep unknown admission conservative for compute accounting. Release active capacity only using the same confirmed native outcome or stop evidence as today; retain the issue claim, worktree and history. Continue using `Capacity` internally for coordinated reservations and its existing read-only calculation for readiness.

The recovery operation cannot manufacture a prompt when required retained identity is missing; retain the existing ambiguity error and recovery route. Session intent recovery and capacity retry remain distinct cases even if they eventually use shared internal admission helpers.

**Alternative considered:** always retrying `launch` for recovery. That can transform observation of an already admitted prompt into an additional model turn and reset its identity or progress age.

### 4. Share stop completion while preserving ownership ordering

The controller retains the stop request and generation advance, interruption of its owned Effect, and acquisition of exclusive execution ownership. Native interruption and waits run outside the short shared coordination lock.

Within that ownership, the worker module cancels the retained owned prompt as supported by `Runtime.interrupt`, handles recorded session intents and role sessions, and confirms quiescence before clearing worker activity and active capacity fields. A failed or inconclusive native read leaves the stop pending and the reservation conservative.

Use one controller completion helper from foreground pause and restart reconciliation to persist `stop_status: confirmed` and the stopped controller-operation checkpoint after the worker module confirms native stop. The helper also commits the returned worker-field changes. The worker module does not acquire an execution lock itself or decide the status of unrelated controller operations.

All writes continue through `Records` and its existing generation/operation checks. A stale result cannot erase a newer pause, diagnostic, decision, progress update or other retained observation. Keep slow native calls outside `Coordination.with`, and avoid nested acquisition of the same execution lock.

**Alternative considered:** moving operation ownership into `WorkerSessions`. That would create conflicting ownership for checks, delivery and native work and risk deadlock during pause.

### 5. Preserve behavior at the controller interface

Use existing controller tests as the primary test surface, retaining meaningful coverage rather than adding tests that mirror new private helpers. Existing protection includes lost session creation responses (`coordination.test.ts`), uncertain prompt reservations and Review capacity waits (`capacity.test.ts`), native interruption/resume and missing completion evidence (`lifecycle.test.ts`), policy-specific completion (`policies.test.ts`) and mixed retained history after restart (`combined-restart.test.ts`).

Before moving each path, add focused characterization coverage only for gaps: retained prompt resubmission versus a deliberately new turn, an inconclusive stop retaining its reservation, and completed Review role context surviving observation. Use fixture barriers and the Effect test clock instead of timing-sensitive sleeps. Assert observable controller results and native submission identities/counts; do not mock the new worker module itself.

Keep the live native test as evidence for queued-prompt cancellation, model inheritance, role guards and restart identity. All tests use temporary repositories and local remotes. Run `pnpm check`, `pnpm test` and `pnpm test:e2e` after implementation.

**Alternative considered:** replacing controller scenarios with private-helper tests. That could miss ordering failures between approval, ownership, native admission and record commits.

## Risks / Trade-offs

- **A successful turn loses its completed role before Review gates run** → Return role context explicitly and keep the missing-report scenario at the controller interface.
- **Recovery mints a fresh prompt or resets progress age** → Keep new-turn and retained-admission paths distinct and assert exact prompt/session identity across restart.
- **Extracted stop logic releases capacity before quiescence** → Preserve pending-stop records and conservative reservations on uncertain native outcomes; test both foreground and restart paths.
- **Moving code bypasses plan or verification checks during a capacity retry** → Keep role-specific admission gates in the controller and preserve their ordering and matching fingerprints.
- **A new record copy overwrites independent observations** → Use existing coordinated `Records` commits and stale-operation checks; retain concurrent Review/progress scenarios.
- **The refactor adds a second lifecycle interpretation instead of replacing the first** → Remove duplicated native outcome, resubmission and stop-completion branches from `Advancement` as they move; review ownership and call ordering rather than targeting a line-count quota.
- **Legacy data has incomplete identity** → Preserve existing decode/recovery behavior. Any newly discovered behavior fix or expanded recovery path needs separate scope rather than being bundled into this refactor.

## Migration Plan

1. Characterize uncovered behavior at the controller interface, then move observation/completion, retained admission recovery and stop confirmation in separately reviewable steps.
2. Preserve schema version 1, field names, policy snapshots, stored IDs, public tools and native adapter contracts. No startup rewrite or database migration is required.
3. Update architecture/recovery documentation to name the worker lifecycle owner and explain admission recovery versus an authorized new turn.
4. Run all repository checks against disposable fixtures and inspect the diff for duplicated or bypassed gates. Preserve existing uncommitted OpenSpec archival separately from this change.
5. Deploy through the existing quiescent service lifecycle. A rollback uses the same stored record format and existing recovery procedure; stop writers before changing binaries and reconcile any in-flight native work rather than resetting records.
