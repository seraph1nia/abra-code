# Design

## Context

See `proposal.md` for motivation. This is a follow-up to `improve-delivery-outcome-reporting`, whose typed cleanup blockers, independent outcome projection and receipt-only merge approval are implementation prerequisites. Its remaining validation must complete before this change is applied. The two changes must archive in that order; this change adds requirements without replacing the predecessor's modified requirement blocks.

Relevant observed boundaries:

- `Finalization.finishOperation` already requires local HEAD to equal `delivered_commit` and rejects tracked/nonignored untracked dirt. `GitHubDelivery.merge` validates PR identity/head/target and uses `--match-head-commit`. Missing synchronization is therefore a progression problem, not an absent expected-head guard.
- `Git.dirty` and `Git.fingerprint` exclude ignored content. `removeGenerated` uses captured exact directories; `inspectCleanup` inventories remaining names. Ignored output can pass the delivery gate and still block retirement. Its name-based blocker fingerprint is a deduplication key, not proof of content ownership or disposal authorization.
- `CodingChecks.verify` binds verification to a content fingerprint and launches independent Review. Archival then produces `archived_tree`, and publication creates a commit. A verification fingerprint is not a commit SHA; archive transformations must be accounted for explicitly rather than comparing unlike hashes.
- `Corrections.prepare` supports check/review/forge sources, consumes a snapshotted repair allowance and preserves prior archives in revision planning. It does not define ordinary local republication. Reusing it unmodified would either strand existing edits when repairs default to zero or incorrectly grant coding authority.
- `Advancement.approve` can create a merge form for a recorded publication without cleanup preflight. `Finalization.cleanup` persists residue but does not open a durable user question. `Attention.scan` can reuse an unrelated unresolved incident; cleanup attention is diagnostic-budgeted, unlike `decision_pending`. Attention capacity defaults to one, and admitted incidents occupy it until disposition.
- `Obligations` already retains user questions and form identities and collects answered forms in reconciliation. Generic question answers are strings, so they cannot safely become executable disposal instructions. Native runtime already supports boolean approval forms with stable identity and metadata.
- Workspaces enforce native inventory, directory identity, non-force retirement and closure after confirmed absence. These remain the destructive-operation boundary. Current native/Git integration evidence is in `docs/supported-apis.md`; no new remote endpoint is necessary.

The screenshot alone does not prove that deliverable edits were omitted or identify its retained files. This change covers the reproducible lifecycle gaps without modifying that historical execution or inferring that every ignored file belongs in Git.

## Goals / Non-Goals

**Goals:** Put synchronization and cleanup readiness ahead of merge; preserve one owned PR across amendments; make current finishing obligations independently deliverable; continue automatically after valid answers; reuse existing operation ownership and finalization checkpoints.

**Non-Goals:** A new scheduler or daemon; arbitrary directory archiving; deletion of individual unknown files; automatic expansion of project cleanup defaults; force push or force retirement; bypassing plan, exact-head approval, Review, external custody or repair budgets; repair of already merged work by writing into its merged PR. Research has no publication synchronization; branch delivery uses exact remote-ref preservation rather than PR merge.

## Decisions

### 1. Give finishing one coordinator and evidence vocabulary

Add a focused finishing-readiness module used by `Advancement` and `Finalization`; keep verification, publication, forms and retirement behind their existing owners. It returns a typed next action: synchronize existing edits, wait for an obligation, await approval/forge, finalize, or unsafe recovery. It must not duplicate lifecycle state in a second persisted phase machine. Keep the existing top-level phases; optional retained finishing evidence explains synchronization/preflight and ties each admitted step to existing operation identity.

The normal progression is:

```text
owned work quiescent
  --> assess local publication drift
  --> revalidate / review / archive / publish if needed
  --> inspect cleanup readiness
  --> collect exact-head merge approval when required
  --> refresh forge gates and recheck local readiness
  --> guarded merge
  --> verify preservation
  --> dispose authorized generated directories
  --> native retirement confirmed
  --> graph closure confirmed
```

Shared coordination sections reserve identities or commit validated records only. Execution ownership covers slow inspection, checks, native submissions, network calls and filesystem mutations. Fresh generation and operation identity checks precede commits, using `synchronizeExecution` to preserve newer observations. Pauses, queued writers, unresolved termination and external branch custody block dependent work. A status read never invokes the coordinator.

Keeping only better prompts was rejected: the existing guards can correctly refuse an action and still leave no eligible next step. A new end-to-end job queue would duplicate existing reconciliation ownership.

### 2. Separate synchronization of existing edits from new implementation

Retain a versioned synchronization attempt with its original publication head, observed input fingerprint/local HEAD, accepted planning/scope identity, attribution/adoption evidence, target PR, generation, native admission identities, stage and expected publication. Detect both dirty work and local-ahead commits. A normal fast-forward publication must still start from the exact retained remote head; independent remote changes are an ownership decision, not an automatic merge/rebase/force push.

Permit at most two automatically admitted synchronization attempts per execution. Persist the counter and attempt identity before checks or Review admission; unchanged polling and recovery reuse the attempt. A third revision requires an explicit native user decision bound to that content revision; it can authorize one additional attempt and never resets consumed history. This is a finite implementation default, not a new repository configuration surface. Optional diagnostic budget is neither consumed nor consulted for required progression.

Automatic eligibility requires existing changes attributable to retained authorized work plus independent assessment within accepted scope. Where provenance is unknown, require a native adoption decision bound to the exact content fingerprint before processing it; a filename or worker's prose is insufficient provenance. A user adoption answer authorizes assessment of those edits, not acceptance of scope changes or failed checks. Unknown ignored files remain residue until exact inclusion is authorized. Retain an exact include-path set when a user chooses delivery inclusion; safely stage only those ignored paths and pass them through all content gates. Never use broad force staging.

Existing edits go through current verification and independent Review, including full-spec completeness/correctness/coherence. Reuse the revision-planning/archive mechanism after archival and preserve configured plan approval and immutable prior archives. Factor its evidence retention from admission of a new Apply turn. If revalidation reveals missing work, a new implementation turn still needs the existing repair allowance or explicit authorization; synchronization does not silently admit Apply. Scope changes follow existing revised planning authorization.

Record a publication binding from current verification/Review receipts and expected archived tree to the resulting commit. This accounts for pre-commit fingerprints and the controller's archive transformation. New commits invalidate old merge approval, CI/action assessments and cleanup preflight. Pending forms for old commits remain historical and cannot authorize the new one. Republish to the same open PR, preserve user-authored PR text and wait for its current checks/reviews.

Treating any dirt as a repair was rejected because `repair_rounds: 0` must not prohibit delivering already authorized work. Blindly committing everything was rejected because attribution, ignored local data and scope still matter.

### 3. Preflight cleanup without disposing anything

Refactor the shared retirement inspection into read-only inventory/safety planning and post-preservation execution. Run preflight before first presenting a new merge form and before controller merge regardless of whether merge approval is configured. It validates current worktree/native identity, deliverable cleanliness, authorized directory safety and all remaining residue. Reuse existing bounds and checks for tracked descendants, nested repositories, unsafe paths and links. A configured directory is eligible generated residue, not an unexpected file; it is left in place until preservation.

Retain a versioned preflight observation bound to execution generation, worktree identity, current publication/content binding, cleanup authorization revision, observed residue and observation time. Bound samples to existing limits of 64 paths and 16 KiB. Truncated or unavailable evidence cannot authorize omitted paths or pass readiness. Exact selected directories may be independently inspected and authorized, but the complete preflight must subsequently succeed before merge.

An observation is invalidated by local/remote content changes, a new relevant obligation, cleanup authorization revision, identity replacement or fresh residue. Immediately before submitting merge, refresh authoritative remote readiness and repeat local HEAD/status, identity, quiescence and cleanup inspection after network observations. Preserve `--match-head-commit` for the remote race. No application lock can exclude arbitrary outside filesystem writers; the post-merge retirement recheck protects any late residue and presents a current exception rather than deleting it.

Deleting generated output during preflight was rejected because tests or other checks may still need it and existing retirement requires preservation first. A previously green status projection is an observation, never reusable mutation authority.

### 4. Use typed native dispositions for generated-directory exceptions

Keep generic `Decision` history for the question, owner and routing. Add a bounded typed finishing target that describes the relevant content/residue, available actions and selected exact paths. The existing `abra_work_decision` collection route can collect that target without breaking generic decisions; any optional fields must have schema-owned validation. Free-text answers cannot execute paths, commands or deletion. A small native finishing form adapter uses supported form primitives and stable metadata; inspect the pinned form schema before choosing field rendering. Boolean approval of a retained exact directory set is sufficient; no dependency on an unverified multi-select API is required.

For a safe generated directory absent from the snapshot, offer explicit authorization for its exact execution-specific generated-directory policy. Store its selected path, native form receipt, generation, owned directory identities, observation evidence and policy revision separately from `effective_policy.generated_paths`. Apply the original exclusions in `GeneratedPathsSchema`. Unknown regular files receive include-in-delivery, preserve-and-reinspect or defer guidance; this change introduces no arbitrary regular-file deletion or artifact archive service. Preservation is a user's explicit move and is verified by fresh absence inspection, not inferred from their answer.

The generated-directory form explicitly grants disposal of generated contents under those exact directories for this execution after preservation. It is directory-policy authorization, not a claim that the name-based blocker digest fingerprints every file. Regeneration inside the same directory is covered only under that explicit policy and still needs a fresh safety scan. Replaced directories, new tracked descendants, nested repositories, escaping links or control paths invalidate eligibility. New sibling paths are never covered. Removal continues through the existing retained retirement journal and identity rechecks.

Applying an answer changes readiness or an authorization receipt and schedules no independent background task; ordinary reconciliation sees the eligible next checkpoint. Deferral is retained and quiet until explicit reconsideration or materially changed evidence. Neither collecting the disposal receipt nor changing project defaults replaces exact-head merge approval.

### 5. Route mandatory questions without optional diagnostic admission

When readiness or cleanup discovers a blocker, persist the user-owned decision and its native form target at the point of detection, using a stable key over generation and the actual target evidence. Bind it to the retained central Abra session. Deterministically present/collect its native form on reconciliation without first requiring an optional diagnostic prompt or a call from the model to start collection. Missing session or submission failure retains an explicit undelivered state and reuses the form identity on bounded retry.

Maintain a separate bounded routing path for already formulated mandatory obligations. Native form delivery does not consume a model-turn slot. If explanatory reasoning is needed, queue one durable `decision_pending` admission in the retained session and dispatch when its native turn is available; optional diagnostics cannot reject it because their budget is spent. Do not create concurrent foreground model turns to bypass capacity. Revalidate stalled optional admissions against native completion evidence, releasing their attention slot when the incident is obsolete. Genuinely active admissions keep their identity; their mere presence must not prevent deterministic form delivery or visibility of a required question.

This is narrower than removing budgets: optional stall diagnosis and new repair stay finite. Plain notification text alone was rejected because delivery, acknowledgement and authority would be lost across restart.

### 6. Supersede incidents by evidence, not by broad phase cleanup

Revalidate incident applicability before deduplication and admission and when committed work advances. A worker stall is bound to its session/prompt/generation and last meaningful progress. Fresh meaningful activity disproves that particular silence observation; successful turn completion or moving beyond that owned worker supersedes it with a retained reason. An operation stall requires matching operation outcome or supersession evidence. Changing a label alone is insufficient.

Do not let the non-decision fallback in `Attention.scan` reuse an unrelated exhausted incident for cleanup or a new revision. Match current incident identity and applicability. Preserve open questions, current ownership failures and unresolved potentially submitted operations. Supersede matched cleanup incidents only after fresh inspection proves resolution/replacement. Slot release must commit alongside incident disposition and preserve an already submitted prompt's historical identity. No native prompt is aborted just to clear its label.

### 7. Reconcile already merged PRs and automatic closure separately

Inspect the owned PR state before choosing synchronization. When it is already merged, do not enter the same-PR republication path. If the delivered head and preservation evidence match and local content is unchanged, continue existing cleanup and closure automatically. If late unpublished edits exist, retain them with an explicit follow-on decision; do not claim the merged PR contains them or dispose of them. Changed/unknown merged identity remains recovery.

Keep the predecessor's short approval collection boundary: saving a merge receipt returns independently; reconciliation performs readiness, merge and cleanup. Keep native retirement `force:false`, identity checks and closure only after native inventory and filesystem absence are confirmed. Respect existing cleanup backoff for unresolved residue and bypass it when a new applicable answer is collected. Close using the original claim, reread graph status and retain terminal notification/invalidation delivery identity so restart or notification failure cannot replay merge or removal. A failed completion notice cannot undo closure; retained outcome remains available.

Branch delivery shares cleanup disposition and automatic retirement after exact remote preservation. Research shares mandatory disposition, report preservation and retirement only. Setup continues through its separate record path but must use the same local/remote and cleanup-readiness guard before any controller-owned setup merge; it must not accidentally launch implementation synchronization against a setup or research record.

### 8. Extend the existing read model rather than inventing a second status

Extend the shared delivery outcome with optional synchronization and preflight observations plus current finishing question/routing references. Expose consumed/available synchronization allowance, content and publication identities, observation age and concrete next action. Existing stage fields remain compatible. The work surface prioritizes current obligations and independently verified stages; historical exhausted incidents belong in diagnostics once superseded. Current post-merge residue still shows delivery verified, cleanup blocked, closure open.

Update tool contracts and native renderers together, including JSON/structured-output equivalence and offline snapshots. Emit native invalidation only after committed changes. Observer operations remain read-only and cannot collect a form or invoke finishing.

## Risks / Trade-offs

- [Generated-directory authorization could be misunderstood as file approval] -> State its exact execution-specific directory-policy scope in the form; validate directory identity and structural safety again before disposal; never expand to siblings or project defaults.
- [Revalidation and independent Review add work for late edits] -> Admit only changed content, reuse retained attempt identity across restart, and stop after the two automatic attempts unless a user authorizes one more.
- [Outside writers change files between checks] -> Quiesce all managed writers, repeat local checks after remote reads, retain expected-head guarding, and rescan before disposal. Never promise exclusion of arbitrary external processes.
- [Mandatory question routing bypasses an unrelated active attention slot] -> Deliver native forms deterministically without a model turn; queue explanatory prompts and preserve native session serialization.
- [New readiness checks conflict with concurrent planning changes] -> Apply and archive `improve-delivery-outcome-reporting` first, preserve this additive delta set, and verify current main specs and the integrated Review requirements before implementation.
- [Legacy records are mistaken for current safe work] -> Missing preflight/publication bindings mean unobserved, not ready; derive fresh evidence only through owned reconciliation. Never auto-resume legacy unsafe recovery from error text.
- [Changing runtime schema breaks older writers] -> Keep additions optional for reading, retain versioned receipts, and prohibit rollback to a writer that drops newer authorization or operation evidence.

## Migration Plan

1. Complete and validate the predecessor, then re-read the main specs and native form/API evidence. Use temporary fixtures to preserve predecessor behavior while adding current readiness.
2. Add optional schema-owned finishing receipts and compatible observer fields. Legacy terminal records remain historical; missing new fields must not reopen or mutate completed executions. In-flight safe records acquire fresh preflight under ownership; unsafe records retain explicit recovery requirements.
3. Integrate synchronization admission, native disposition, preflight and attention applicability behind existing controller routes. New generic form answers grant no disposal rights. Existing snapshot policy stays unchanged unless a matching native execution-specific receipt authorizes an exception.
4. Validate all unit/integration/native scenarios and required project checks without user remotes. For service upgrade, quiesce writers and preserve records/SQLite backups before starting the new writer; reconcile uncertain effects on restart.
5. If reverting, stop writers and preserve all new receipts and external effects. Use a compatible reader/writer or restore data only after reconciling later pushes, merges and removals; never reset operation history or discard an accepted path authorization to make an older binary run.
