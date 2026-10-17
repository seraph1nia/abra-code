# Design

## Context

See `proposal.md` for motivation. The relevant behavior is already split across controller-owned checkpoints:

- `Advancement.approve` takes the execution lock, collects a native form through `collectApproval`, then calls `Finalization.finish` inline for merge approval. Saving a receipt does not prevent a later finalization exception from failing the approval tool.
- `Operations.owned` uses a nonblocking execution lock. Explicit approval/finish propagates `LOCKED`; reconciliation already treats execution contention as a reason to observe the latest record. A lock does not prove a separate server exists.
- `Finalization.finishOperation` verifies preservation and enters `cleaning` before retirement. `Workspaces.retire` removes only authorized generated directories, then throws generic `DIRTY_WORKTREE` or `IGNORED_WORK` errors. The explicit finish path retains a message; the reconciliation catch currently escalates most such errors to `recovery_required`.
- `tool-contracts.ts` exposes execution records or pending-form results. The observer exposes phase and error text but has no common projection of approval, preservation, retirement and closure. The existing `safe-retirement` scenario already requires naming ignored files; the current generic ignored-file error does not meet it.

The screenshot does not establish which operation held the lock or which failing call performed a partial effect. Tests must reproduce the possible interleavings rather than encode that hypothesis as historical fact. Existing worktree residue is diagnostic evidence, not a proposed deletion list.

## Goals / Non-Goals

**Goals:** Keep durable checkpoint success visible across later failures; make normal same-execution contention understandable; retain ordinary cleanup blockers consistently across explicit calls, polling and restart; provide actionable bounded diagnostics through existing tools and native views.

**Non-Goals:** A new job queue, lock stealing, arbitrary ignored-file deletion, execution-policy widening, retrospective repair of the screenshot's issue, changes to merge/approval gates, or a broad rewrite of plan approval and worker admission.

## Decisions

### 1. Collect merge approval independently; let existing reconciliation advance

For `kind: merge`, keep native form collection and receipt persistence under execution ownership, then return without invoking finalization. Pending forms retain their existing `approval_required` and `form_id` fields. Accepted forms return the persisted receipt's outcome plus the current delivery projection. The periodic reconciler already collects forms, checks exact delivered identity, and advances authorized work; no extra Supervisor turn or delivery queue is needed. A later explicit finish remains available and uses the same gates.

Before rejecting an advanced phase, recognize an existing accepted receipt for the execution's retained delivered commit in `cleaning` or `completed`; return it idempotently without touching the retired worktree or creating a form. This exception cannot approve changed content or bypass rejection, pause or stale-checkpoint rules. Plan approval keeps its current admission behavior. A collection never implies that another action was queued.

Keeping inline merge and merely decorating its failure was considered. It would preserve coupling between slow delivery and an already successful human checkpoint, so the short collection boundary is preferable.

### 2. Project stages from evidence through one shared read model

Introduce a small schema-owned delivery-outcome projection used by the model-facing tools and native read model. It contains execution/generation identity, delivered commit when known, `observed_at`, evidence timestamps where available, and independent stage results:

| Stage    | Evidence and presentation                                                                                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approval | Matching accepted/pending/rejected receipt, configured approval exemption, or unavailable evidence; receipt existence alone is not acceptance.                                            |
| Delivery | Verified coding preservation or research report receipt, a retained delivery wait, or unconfirmed/unavailable; an observed merged PR without preservation proof is not verified delivery. |
| Cleanup  | Native retirement confirmation, retained file blocker, owned cleanup operation, or not started/unavailable.                                                                               |
| Closure  | Actual work-graph issue status; never infer closure from merge, retirement or an old progress message.                                                                                    |

Read-only projection creates no receipt, form, Git inspection or lifecycle mutation. Current snapshot time is distinct from evidence age. Preserve applicable branch/research terminology. If required reads fail, label that evidence unavailable rather than guessing. Offline views retain their existing stale-snapshot behavior.

Add an optional typed `outcome` field to the existing successful execution-result and pending-form output shapes; add the same projection to status and native detail. The field is output data, not a second persisted execution state machine. Retain legacy top-level execution fields, approval/form fields, tool names and inputs. Only the new busy variant has no executed-action result; it includes `requested_action`, `performed: false`, `operation_in_progress`, observation time, available operation identity, optional current outcome and the next action. Existing consumers must handle that declared union branch. The native `{ok:true,result:...}` envelope remains intact.

### 3. Classify only actual execution-lock contention

Keep low-level exclusive ownership and global coordination unchanged. At the ownership-acquisition boundary, distinguish an unavailable execution lock from lock-helper startup/IO errors or failures within the operation body. Only the former can become the successful busy variant for explicit approval and finish. Do not broadly catch any downstream `LOCKED` error.

On contention, perform a bounded read of the latest committed execution/issue data outside ownership. If that read is unavailable, return busy with unavailable details. Do not write a wait record, new intent or inferred owner into an execution owned by someone else. Include recorded action/operation identity as an observation, not proof that it is still active. The clearing action is to observe status and recollect approval only if its receipt is still missing; busy does not mean the losing request was accepted or queued. Background reconciliation keeps its existing bounded skip behavior. No retry loop holds shared coordination or monopolizes unrelated tickets.

### 4. Retain ordinary cleanup blockers as typed data

Have retirement return a typed ordinary-file-blocker result after valid preservation/ownership checks; preserve errors for unsafe paths, replacement directories, inspection failures and uncertain native removal. Translate benign residue to one shared finalization result for explicit finish and reconciliation. Keep phase `cleaning`, delivery/report receipts, worktree ownership and issue claim. Do not route that result through the generic reconciliation failure catch.

Add an optional `cleanup_blocker` contract to retained execution records: category (`ignored` or `untracked`), sampled worktree-relative paths and their file/directory kind, completeness/truncation, observation time, generation, preservation identity, blocker fingerprint, attempts and next inspection time. The owned worktree and captured generated paths come from the execution rather than copying mutable repository defaults. Tracked content drift remains a delivery-integrity failure; pre-preservation errors are not eligible for this classification.

Use NUL-delimited Git path observations with bounded runner output and explicit file/directory samples. Bound retained/displayed samples to 64 entries and 16 KiB total; omit oversized items with explicit truncation rather than silently changing filenames. An output-limit or failed inspection is not evidence of zero blockers. If directory aggregation is used, label it as a directory sample rather than an exhaustive list of files. Never read contents or walk a path's symlink target to diagnose residue. Encode filenames as data; do not interpolate them into executable removal commands. The disposition action names the worktree, asks for inspection and preservation or explicit removal of known disposable residue, then directs the operator to finish. It grants no deletion permission.

Reinspection uses the existing delivery-wait timing pattern: 30 seconds initially, bounded exponential backoff to five minutes for an unchanged blocker. Explicit finish bypasses the observation delay and revalidates immediately. Manual pause suppresses automatic work. Stable blocker identity excludes timestamps and attempt counters; reuse one attention incident for the same generation, preservation identity and blocker fingerprint. Supersede that incident when fresh owned inspection proves the blocker resolved. New paths can update evidence; no new automatic repair or deletion authority follows.

Changing `generated_paths` in registration does not widen this execution. No per-path approval/removal API is added. These choices preserve the existing narrow-retirement contract.

### 5. Keep native failures and committed success distinct

Expected contention and ordinary post-preservation residue are successful classified observations, not successful completion. Refused approval, stale fingerprints, ownership conflicts, uncertain merge effects, native removal failures and defects retain their native error/interrupt semantics. Native error guidance points to current status and names the failed stage where safely known. The shared status projection retains earlier committed approval/delivery evidence independently of the error. Never manufacture a preservation receipt from a successful command exit or an error message.

Update tool descriptions, native labels and the orchestration/recovery guidance so Abra reports, for example, “Approval recorded; delivery will continue automatically” or “Delivery verified; cleanup blocked by retained files; issue open.” During a contended unconfirmed merge, the response says “Delivery operation in progress; final result not confirmed as of this observation.” Generic conversation text does not become lifecycle authority.

## Risks / Trade-offs

- [Approval collection returns before delivery advances] → Preserve existing periodic reconciliation and expose observation/next-action fields; test accepted receipts through pending CI and service restart.
- [A broad error conversion hides a real failure] → Classify contention at acquisition and file residue only after verified preservation; retain negative tests for IO, unsafe identity, stale content and ambiguous merge.
- [Path evidence becomes stale or truncates important files] → Label its age/completeness, retain read-only inspection guidance, and always inspect again under ownership before retirement.
- [Unchanged file residue causes repeated reasoning turns or expensive scans] → Back off deterministic reinspection and deduplicate attention using stable evidence.
- [Additive output fields or union variants are omitted by encoders/consumers] → Extend schema families and projections together, test native structured output and JSON content, and update callers that assume approval implies completed finalization.

## Migration Plan

1. Extend retained decoding with optional cleanup evidence and add the shared outcome projection. Older records remain readable; absent fields mean unavailable diagnostics, never a fabricated empty inventory. Validate malformed additions without rewriting originals.
2. Change merge approval/finish handling and reconciliation together, then update tool schemas, native presentation and guidance. Existing forms, exact-content receipts, generations and worktrees retain identity.
3. Do not auto-resume legacy `recovery_required` executions merely because their error mentions ignored files. They require existing explicit recovery inspection; only newly classified or explicitly reconciled safe cleanup receives a file blocker.
4. Verify on temporary fixtures and the native server before deployment. Quiesce writers and retain the normal records/SQLite backup before upgrading a live service. Rollback must preserve new diagnostic records and later external effects; do not run an older writer that would drop new evidence or reset receipts.
