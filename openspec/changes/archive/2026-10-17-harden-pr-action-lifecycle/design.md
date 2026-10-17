# Design

## Context

See `proposal.md` for motivation and scope. The review baseline is `5089c89`; its four reproductions use the existing temporary-repository and recording-forge seams. The ignored `.lavish/thermo-review/reproduce.ts` is useful evidence on this machine, but implementation and acceptance must not depend on that untracked file.

Observed ownership and failure points:

| Finding                             | Current implementation                                                                                               | Design response                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| F1: missing actions permit merge    | `PRActions.automatic` creates actions during polling; `GitHubDelivery.merge` only checks unfinished retained actions | One policy-derived action plan consumed by scheduling and controller merge clearance |
| F2: duplicate reruns                | `PRActions.prepare` hashes a finding/revision even though the adapter reruns a whole workflow attempt                | Kind-specific semantic targets and one reservation per run attempt                   |
| F3: advisory checks become blocking | `GitHubReadiness` retains app-aware policy, but feedback joins a second `pr checks` summary by name                  | A canonical typed check observation shared by both consumers                         |
| F4: unsent actions become uncertain | The outbox marks running before the adapter's identity/permission reads                                              | Read-only preparation, durable submission admission and classified reconciliation    |
| F5: coordinator expansion           | `Advancement` is 1,178 lines; the terminal sidebar fixture is 1,107                                                  | Move whole feature operations to their owners and split feature fixtures             |

`Operations.owned` provides the per-issue operation lock; short `Records` updates use shared coordination and generation checks. The plugin monitor owns periodic reconciliation. Keep those boundaries and native OpenCode 2.0.28 contracts. `docs/supported-apis.md` already describes the GitHub check, Actions, review and discussion endpoints used by these adapters.

That API document currently describes permission failure as an uncertain/unavailable action without distinguishing submission stages. This change deliberately refines that behavior: a failed read before admission proves the write is unsubmitted; a legacy uncertain record or failure after admission does not. Update that description alongside the implementation rather than preserving the blanket uncertainty classification.

The completed `add-continuous-pr-feedback` change has not been archived, and its `pr-feedback` and `pr-automation` capabilities are not yet canonical specs. This follow-up adds requirements to existing `delivery-evidence` and `typed-contracts` without copying or replacing the predecessor's pending requirement blocks. Prefer synchronizing/archiving the predecessor first when finalizing specs; preserve both sets of additive requirements regardless of synchronization order. This planning workflow does not perform either lifecycle action.

## Goals / Non-Goals

**Goals:**

- Make every merge entry point enforce the same action obligations, independent of poll order.
- Align local action identity with the exact remote effect and retain conservative uncertainty across interruption/restart.
- Eliminate duplicate check-policy reconstruction and feature-specific orchestration in the general lifecycle dispatcher.
- Keep existing durable authority, history and observer behavior compatible while making the new contracts explicit.

**Non-Goals:**

- No new forge, queue service, daemon, generic workflow framework, policy default or automatic authorization.
- No change to quality-profile resolution, correction scope, external engine protocol, required review, branch protection or preservation rules.
- No blanket retry of writes, refund of historical budgets, or retroactive claim that a legacy uncertain operation was never sent.
- No unrelated decomposition of every large file. The native e2e fixture is already oversized; extract shared scenario setup instead of appending another large inline fixture.

## Decisions

### 1. Derive action obligations once in the controller

Add a pure, typed action-planning module under `src/workflow/`. Given the execution's snapshotted automation policy, exact delivered PR/head, a complete fresh feedback/check observation, draft/reviewer state and retained receipts, it returns required semantic targets, satisfied targets, ready-to-admit targets and concrete blockers. This is a finite model for the existing five action kinds, not a configurable rules engine.

The planner covers automatic ready transitions, configured on-ready reviewer requests, verified evidence replies, separately enabled thread resolution and eligible transient CI reruns. It preserves correction re-request policy. Manual defaults create no new automatic obligations; an explicitly prepared manual action still follows its retained approval and reconciliation gates. A missing required action is a blocker even when no outbox record exists. A rejected action cannot silently satisfy an enabled policy obligation.

Resolve depends on a confirmed reply when reply policy requires one. A target that becomes stale before submission is superseded with a reason and the fresh plan is evaluated; a potentially submitted action remains subject to source reconciliation. Findings still awaiting classification, incomplete sources and existing scope/attention/custody blockers continue to block independently.

Periodic scheduling uses the plan to admit due actions. Finalization takes a fresh complete observation and evaluates the same plan under the existing issue operation before attempting merge, including explicit `finish`, merge approval completion and normal reconciliation. Missing actions are durably prepared or exposed as a classified wait; the caller does not depend on a later monitor tick to discover that work exists. Only the action service sends policy-authorized writes. The GitHub merge adapter retains exact identity checks and `--match-head-commit`; controller policy logic moves out of that adapter rather than being duplicated there.

Alternative rejected: call `automatic` from additional merge branches. That leaves policy completeness implicit in the order and success of side effects rather than providing one checkable clearance result.

### 2. Give each action a semantic target and keep authority separate

Define action targets as a discriminated union in the action contract. Common envelope evidence includes execution, repository/PR, generation, authorization and timestamps; the target contains only fields needed by that action kind:

| Kind      | Semantic target                                                                       |
| --------- | ------------------------------------------------------------------------------------- |
| Ready     | Repository, PR and delivered head                                                     |
| Reviewers | Repository, PR, delivered head and sorted user/team sets for the request lifecycle    |
| Reply     | Repository, PR, corrective head, exact discussion/source revision and body digest     |
| Resolve   | Repository, PR, corrective head, thread and assessed substantive revision set         |
| Rerun     | Repository, PR, delivered head, workflow run ID, source attempt and workflow identity |

Action IDs for new records derive from execution identity and the canonical target, not irrelevant reviewer fields, individual job findings or a fresh control generation. Authorization still must match the current generation before a new send. Reconciliation after a pause/restart can locate the same semantic action without granting fresh write authority. Preserve existing manual body restrictions, safe reviewer selection and own-reply recognition.

Group eligible transient findings by rerun target; retain their contributing finding/revision IDs as bounded evidence. One target reserves one rerun budget slot and can have at most one admitted submission. Re-reading an unchanged run attempt, observing another failed job, or retrying a preflight does not allocate another slot. Observe a later attempt before deciding completion or admitting another authorized retry. Do not silently refund or collapse historical budget usage during migration.

Alternative rejected: append run IDs to the current general payload hash. That still allows finding/reviewer fields to fragment an identical workflow mutation and leaves impossible target combinations in the contract.

### 3. Separate preparation from submission and observation

Replace the adapter's `send: boolean` mode with explicit preparation, submission and reconciliation operations. Preparation is read-only: observe existing postconditions, validate exact PR/source identity and authority, and read permissions. It returns an already-confirmed receipt, a bounded definitely-unsubmitted blocker/retry result, or a typed bound write request. Reuse canonical reviewer eligibility logic instead of maintaining separate permission checks in suggestions and action dispatch.

The controller rechecks generation/pause and persists send admission immediately before handing the request to the mutating adapter call. No network call runs under the global commit lock. Once send admission is durable, crash/interruption is conservatively potentially submitted, including a crash in the small interval before the actual command starts. Reads performed before this point can fail without creating submission uncertainty.

| Stage/result                             | Retained meaning                                                         | Recovery                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Prepared / preflight unavailable         | Definitely unsubmitted; retain authority, reservation and bounded reason | Retry read-only preparation with backoff; send only after current validation succeeds              |
| Prepared / rejected or stale             | Definitely unsubmitted; explain denial or obsolete source                | Require corrected inputs/authority or supersede the stale target; never spin on a permanent denial |
| Submission admitted / result unavailable | Potentially submitted                                                    | Observe the exact target; no automatic resend                                                      |
| Accepted / awaiting postcondition        | Submitted, still awaiting readiness or a subsequent run attempt          | Continue bounded observation                                                                       |
| Confirmed                                | Authoritative postcondition/receipt retained                             | Reuse without another send                                                                         |

Only a positively classified response proving no remote effect can restore an admitted action to definitely unsubmitted. Generic process failures, deadlines, malformed output and lost responses after admission remain uncertain. Classification is typed evidence, not error-message matching. Retain existing approved forms through a retry of the unchanged target; changed payload or authority requires new authorization. Save each result together with its submission-stage evidence in one coordinated action update.

The existing status projections can retain familiar prepared/running/uncertain/confirmed labels, with explicit stage/reason data to distinguish retryable preflight work. Required unsent work still blocks merge; it is simply recoverable without external intervention. This change addresses PR actions; it does not generalize the mechanism into a new engine for the external validation protocol.

Alternative rejected: retry every `uncertain` action or special-case permission error codes. The former can duplicate writes; the latter cannot prove whether a mutation was submitted.

### 4. Expose canonical check observations instead of rebuilding them

Extract the existing authoritative check/status normalization and requirement matching into a focused typed observation returned to readiness and feedback. Preserve source kind, stable source ID, delivered head, name/context, application binding where supplied, latest-attempt selection, normalized state, blocking classification and source link. Keep check runs and commit statuses distinct. Missing application evidence cannot satisfy an app-bound requirement by name alone.

Use complete paginated check-run/status reads for the canonical observation in all policy modes. Extend consumed REST fields for source links and revision evidence only as needed, with fixtures and `docs/supported-apis.md` updates. `pr checks` may remain a display-only diagnostic if useful, but it cannot supply or override policy identity. Feedback must not perform a second summary read and join on names. Preserve missing-context, no-check and source-completeness handling.

Attach optional Actions run/job/log details to the selected source observation. Verify run/head/attempt identity as today; unavailable details do not erase a check failure or turn an advisory failure into a blocking one. Finding revisions derive from canonical source/attempt/state rather than display-name timestamps from a separate summary. Existing retained findings/dispositions remain history; a new canonical revision requires reassessment unless exact provenance proves continuity.

Alternative rejected: use names plus timestamps or workflow labels to improve the join. Neither identifies a check application or reliably distinguishes superseded attempts.

### 5. Move complete feature operations to their owning services

Create one cohesive PR feedback coordinator under `src/workflow/` for the owned feedback/disposition/action/correction entry points, due observations, action reconciliation and known delivery-block recovery. It shares `FeedbackService`, `PRActions`, `Corrections`, `Operations` and `Records`; do not instantiate competing locks, stores or copies of policy state. The application composition wires it into controller routes and finalization. `Advancement` keeps lifecycle ordering and delegates to the feature boundary instead of exposing feature-specific implementations and proxy chains.

Move the existing external admission/capacity/custody handoff into the service that owns external validation. That service receives the necessary capacity and issue-intent collaborators; it returns the updated execution, and `Advancement` decides whether to enter native verification. Avoid a callback cycle into the dispatcher. Preserve exclusive custody, admission accounting, cancellation and error-release behavior exactly.

Acceptance for decomposition: `src/workflow/advancement.ts` and `tests/tui/sidebar.ts` are below 1,000 lines, no newly introduced or previously smaller touched module crosses that threshold, and no replacement umbrella module receives the same collection of unrelated responsibilities. Split the terminal feedback/external scenario setup into focused fixture modules, retaining the real renderer harness and native coverage. Remove duplicated decision/reconciliation code where the shared model makes it unnecessary; line counts alone do not establish success.

Alternative rejected: extract arbitrary functions into generic helpers or add another pass-through facade. That changes file sizes without removing the concepts and responsibilities the reviewer must understand.

## Risks / Trade-offs

- [Canonical reads add API work compared with a summary-only fast path] → Share one observation within an operation, retain current cadence/backoff and bounded pagination, and avoid duplicate readiness/feedback reads. Do not weaken completeness to save requests.
- [Preparation cannot be atomic with a GitHub mutation] → Bind the prepared request to exact identity, recheck local generation before admission, retain guarded native head checks and server protection, and fail closed on changed remote evidence. A comment can still arrive after the last observation.
- [Legacy uncertainty contains insufficient send provenance] → Preserve it as potentially submitted; never infer safe retry from a stored error string. Some legacy actions still require manual source inspection.
- [Typed targets or canonical source IDs accidentally reset deduplication] → Preserve old IDs/forms/markers, match retained semantic targets conservatively, retain budget usage, and test mixed old/new records with restart and pause.
- [Moving feature operations changes lock order or error handling] → Retain one issue operation per public mutation, reuse short commit coordination, and verify concurrency, stale generations and external capacity with existing fixtures.
- [Required-action planning accidentally enables manual defaults or fabricates clearance] → Test disabled automation, rejected policy obligations, stale revisions and absent outbox entries separately; defaults and authority stay snapshotted.

## Migration Plan

1. Add tracked regression cases for F1–F4 using existing fake forge/controller fixtures before replacing their mechanisms; record the F5 size and ownership baseline.
2. Introduce the canonical check and per-kind action contracts plus explicit compatible decoding. Newly admitted actions use a new action-record version; supported version-1 actions normalize at the boundary while retaining original IDs, form bindings, prepared payloads, source receipts and original serialized evidence. Unknown versions or incomplete identities remain preserved and unavailable for sends.
3. Treat version-1 prepared actions as unsubmitted only when their retained lifecycle proves that state. Treat running/uncertain records as potentially submitted. Preserve confirmed receipts and match old reply markers using their original IDs. Do not rewrite immutable finding history or reduce existing reservation counts.
4. Wire the shared planner, staged dispatch and canonical observations through controller routes, finalization, observers and tools. Decompose the controller/fixture responsibilities as part of this wiring, not as a later cleanup.
5. Run the scenario matrix, full required checks and strict change validation. Update supported API evidence for any newly consumed GitHub fields. Keep `add-continuous-pr-feedback` and this change separate until their normal completion/archive workflows.

Rollback is fail-closed: use an implementation that understands the new action version for executions that have written it. An older runtime must report unsupported records and preserve them rather than attempt a lossy downgrade or replay. No deployment or data migration is performed during proposal creation.
