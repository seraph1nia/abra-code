# Design

## Context

See `proposal.md` for motivation, base observations and preservation limits. Source inspection in the assigned repair worktree confirms these seams:

- `workflow/advancement.ts:245-276` validates planning, compares names against synchronization tree / planning commit / instruction-refresh commit / original base, then stages the change. The newline/prefix test does not model a retained dirty replan baseline.
- `advancement.ts:533-559` checks idle, removes current checkpoint evidence and launches Explore without capturing source content. `Operations.owned` prepares a new operation for each invocation; its ID alone cannot identify a retry-stable replan.
- `git/repository.ts:115-144` copies the real index into private scratch and constructs a candidate tree. This supplies the existing Git-defined content seam; a merged deliverable tree alone loses intermediate staged content.
- `workflow/sessions.ts:207-221` retains completed Apply attribution as generation/head/full fingerprint/session/prompt. `idle` and `validateLocations` are distinct checks; idle is not location or provenance proof.
- `authorization.ts:16-21,27-43` selects approval by checkpoint identity. A new planning attempt must produce a fresh identity even when artifact bytes are identical, without rewriting previous receipts.
- `synchronization.ts:69-80` requires an existing publication. `FinishingTargetSchema` adoption requires a published commit; external adoption requires its own external run. Neither is valid pre-delivery recovery.
- `storage/store.ts` provides generation/operation/revision-fenced owned updates, legacy-original retention and additive evidence preservation. Native storage has no cross-key transaction/CAS; do not assume one.

## Goals / Non-Goals

**Goals:** Make a controlled planning attempt one durable, attributable source boundary, with a small controller-owned admission/recovery interface and independently testable Git capture/compare behavior.

**Non-goals:** No agents-package port, new UI, general arbitrary-tree import, new workflow engine, policy/capacity changes, post-publication adoption replacement, automatic parent recovery, service mutation, or source commit/stash/reset to satisfy a guard.

## Decisions

### 1. Define distinct evidence, not another meaning of “base”

- **Source baseline:** reconstructable immutable content observed before one controlled Explore attempt. It is not `base_commit`, an approved plan, or an Apply permission.
- **Attribution:** existing controller-retained evidence tying exact content to an authorized completed Apply assignment or a trusted existing planning boundary. Idle state, issue prose and requesting replan do not provide attribution.
- **Historical recovery:** verification of independently retained complete pre-Explore content and its original binding. A digest alone cannot supply those bytes.
- **Prospective adoption:** native human authorization to use an offered current snapshot as a new planning baseline from now on. It explicitly does not attest what existed before the violation.
- **Control intent:** stable Supervisor request identity plus immutable normalized input; separate from replaceable operation IDs and subsequent worker prompt IDs.

Keep these definitions in the recovery documentation during Apply. Do not rename original bases or retrofit current captures into historical attribution.

### 2. Keep ownership behind the existing controller interface

Normal caller example:

`abra_work_control({issue_id, action:"replan", request_id, text})`

Under execution ownership, validate project/branch/directory identity, native session locations, exact issue claim/repository/policy, current generation, no pause/pending stop, no external custody, eligible pre-archive phase and confirmed native quiescence. Include queued/admission-uncertain work; a merely idle-looking native session is insufficient. Refusal must not clear plan/check/Review evidence, resume a claim or admit a prompt.

Before a dirty tree can be captured, its full fingerprint and HEAD must match previously retained current-generation completed-Apply attribution with the exact authorized assignment/context. The receipt must predate this replan intent. New successful Apply completion observations may continue to be retained by the existing completion owner, but replan must not manufacture attribution merely because the current native session reports success. Clean source may use the existing trusted initial/planning/correction boundary only after proving no outside-change delta. Unexplained content or mismatching attribution requires explicit recovery/adoption.

Use a narrowly scoped Effect service/helper, composed in the existing application, to own baseline preparation, comparison and recovery. Advancement and ExecutionRecovery delegate to it; they must not each encode precedence or receipt-consumption rules. Reuse Git, Records, WorkerSessions, Obligations and Authorizations rather than passing low-level ordering knowledge into tool callers.

Alternative rejected: capturing any dirty idle tree in `control(replan)` silently launders unexplained content. Alternative rejected: use finishing synchronization with a fabricated publication; this changes its authority and budgets.

### 3. Capture Git-defined source views without modifying the real index

Use the existing private-index Git seam for a bounded reconstructable planning baseline:

- HEAD and canonical repository/common-dir, branch and retained directory identity.
- Separate index tree before `add --all` and candidate tree after it, using only the private index. Unmerged entries and unavailable Git objects fail closed.
- Full existing fingerprint for binding staged/working/untracked state. Record real index bytes before/after in regression assertions, not as a new persisted filesystem snapshot.

Use Git trees and controller-owned retaining refs, following the existing `refs/abracode/bases` retention pattern. Retain the candidate and needed index tree's reachable objects under an attempt-specific namespace. Never change HEAD/branch or create a source commit. Journal intended ref identity before pinning; conflicting or missing objects/refs block admission. Interrupted private scratch cleanup removes only owned scratch; retained baseline objects remain reachable across GC/restart.

Cover tracked, separately staged, unstaged and nonignored untracked source paths through existing Git facilities. Do not add exclusions to bless dirty content. Keep existing ignored installation/cache/generated-residue semantics unchanged. This repair does not add an ignored-file inventory, raw-content manifest, general flag/submodule policy or full filesystem snapshot subsystem. Existing unsupported/unmerged/special-content failures remain failures, not empty content.

Use NUL-delimited Git output, literal pathspecs and exact component containment under `openspec/changes/<assigned-change>/`. Compare candidate and index views independently, including Git-defined modes/links, deletions and both move endpoints; do not depend on newline splitting or string-prefix siblings. Allowed artifacts remain regular files with realpath-contained ancestors; retain existing native path/link guards. HEAD must remain the admitted HEAD, so source commits cannot disappear behind an apparently matching final tree.

“Exact” here means the current Git-defined source content plus the existing full fingerprint, not a new raw filesystem attestation. Git clean-filter normalization, ignored/cache content and assume-unchanged filesystem states retain the existing contract and limitations. Do not claim comprehensive detection of those states or relax native role guards because a candidate tree matches.

Check the existing fingerprint/HEAD and ownership before and after capture and immediately before baseline persistence/admission. If a concurrent external writer changes observed content, refuse; exclusive controller ownership is not a filesystem transaction.

Alternative rejected: only `git diff <tree>` misses index-only changes. Alternative rejected: only an existing full fingerprint detects drift but cannot reconstruct a historical source snapshot.

### 4. Persist one attempt before invalidation or worker admission

Add optional versioned planning evidence to execution contracts, with an append-only attempt history. An attempt binds issue/repository/execution, canonical worktree identity/common-dir/branch, change/schema binding, control generation, stable request/input digest, origin operation, prior checkpoint identities, capture time, candidate/index trees and full fingerprint, attribution provenance and lifecycle stage. Retain exact prior approval receipts and existing violations; use IDs/references to existing retained evidence rather than rewriting it.

Stages distinguish prepared intent, captured baseline, admission prepared/admitted, completed planning, and violation/recovery stop. Persist the baseline and pin confirmation before clearing current plan/check/Review evidence, changing phase/claim or submitting Explore. Persist prompt/context binding before native admission through the existing WorkerSessions owner. A prepared intent without a valid baseline cannot launch. A crash after capture but before invalidation continues the same intent; after admission it observes the same prompt before any replay.

The baseline's origin generation and content are immutable. A confirmed pause may advance control generation; an explicit supported resume records a continuation binding to the same baseline after ownership and delta revalidation. It never changes the old generation or recaptures source. A pending old-generation adoption offer is stale and needs a new form under current authority.

Repeated requests, capacity waits, retry/resume, uncertain responses and restart reuse the attempt and trees. Conflicting reuse fails. A new request ID is not permission to supersede an unresolved violation or admission; explicit guarded recovery is required. Preserve initial Explore's existing commit-based boundary when no controlled attempt exists. Synchronization/correction retain their own bases, archives, budgets and publication/coding semantics; reject conflicting active baseline owners rather than weakening precedence.

### 5. Validate the delta and make fresh plan authority unambiguous

At the planning checkpoint, compare the Git-defined source views with the retained baseline before staging artifacts or publishing a plan fingerprint. Only the assigned change's valid regular planning artifacts may differ. Recheck before accepting plan authorization and immediately before Apply admission, so an observable source edit while a form is open cannot slip through. Legitimate pre-existing staged/unstaged/untracked Apply content remains untouched.

On violation, retain the original baseline and exact violation evidence with attempt/session/prompt/generation and observed content identities. Keep resources and historical receipts; retries must still compare against the same baseline. Do not downgrade `EXPLORE_SOURCE_EDIT`, erase its history or treat a successful formatter as proof that no source mutation occurred.

Distinguish an observed delta against a valid retained baseline from a historical controller allegation produced without that baseline. Preserve both records honestly; retaining an old error must not convert its accusation into proven worker conduct. The positive parent-style fixture is formatting-only planning over retained Apply WIP. A separate negative fixture deliberately mutates an outside source file and must remain rejected.

For a controlled attempt, domain-separate checkpoint identity with attempt/baseline identity plus the existing production plan fingerprint. Thus unchanged artifact bytes cannot reuse a prior receipt. Honor captured approval policy: this repair and the preserved parent require a fresh native human plan form; already permitted automatic planning elsewhere receives no fabricated human actor or new authority. Existing initial and legacy plan identities remain readable and keep their original meaning. Never alter the global historical `Git.planFingerprint` algorithm to make receipts match. Existing Authorizations continues to own persist-before-form and receipt collection; workers remain forbidden.

The baseline capture/adoption operations do not alter real index bytes, files or HEAD. Existing checkpoint staging may still stage only assigned planning artifacts after successful validation; it must not alter any outside-change index entry. Fresh plan approval permits only the existing accepted Apply contract. Baseline adoption alone never launches Apply.

### 6. Add explicit pre-delivery recovery, not a retry shortcut

Proposed caller:

`abra_work_control({issue_id, action:"recover_planning", request_id, text})`

Extend the existing closed Supervisor control contract/ports, not arbitrary tree/path parameters. Diagnostic turns and workers cannot initiate this repair operation. Restrict it to full-spec, pre-archive/pre-publication stranded planning, with no provisional/final publication, active synchronization or external run custody. Require the same claim/location/generation/quiescence checks as normal admission. Paused work still needs its explicit supported resume; the recovery operation must not silently clear a pause.

1. Retain a recovery intent and the existing violation/error/checkpoint history before inspection. Inspect only an already complete retained baseline with verifiable original execution/worktree/generation/admission binding; do not build a reconstruction/import engine. Current documents, formatter candidates, hashes and operator summaries are evidence references, not automatic historical provenance.
2. If that complete original baseline and binding exist, verify them and compare the current planning delta. Only an in-change delta permits historical recovery. Any actual source violation remains blocked; no historical tree is inferred by reversing current edits or guessing formatter output.
3. Otherwise capture and pin an exact **offered current** snapshot, preserving current files/index/HEAD. Open a typed `planning_baseline_adoption` target through existing durable Obligations decision/native disposition machinery. Extend that target union without making `published` optional for existing finishing targets.
4. Bind the target to request/attempt, issue/repository/execution, change/schema, worktree directory identity/common-dir/branch, current generation, HEAD, candidate/index trees and full fingerprint, prior plan/approval references and preserved violation identity. Present full target identity in the native form detail, with authorize/defer/reject semantics and explicit “new baseline, not historical reconstruction; no implementation/publication/merge authority” wording.
5. Existing `abra_work_decision` collection retains form/session/target before native creation and checks the exact answered target. Reuse existing form lifecycle/routing, bounded retry and worker self-authorization rejection. A generic question answer, model prose, plan receipt, finishing adoption or external-run receipt cannot authorize this target.
6. Collection records only the answer. Reinvoke the same explicit recovery control to revalidate current exact offer and consume the matching native receipt once. Missing/stale/rejected/deferred authorization, content drift, identity drift or generation change leaves recovery stopped. An accepted prior target must never authorize a refreshed offer.
7. Persist a prospective baseline attempt and its consumed authorization before any controlled Explore admission. Retain the old failed attempt and violation unchanged. Explore remains planning-only; afterward require strict schema/task validation and fresh plan approval, all captured checks and independent Review. No “already implemented” shortcut bypasses these gates.

Unpersisted form answers lost on restart require reauthorization on the retained target/form identity, as with existing native forms. Repeated consumption reconciles the same admitted attempt/prompt rather than creating another one.

For the parent, preserve original approval fingerprint `abeebb83f557f0c1c1fce06d56abe8ad45323fdea7bffc806f851d14bd179a8a`. The operator-reported current production plan fingerprint is `267234d193ad5f50e15b55e2dff88721a241132350f0b65831c4237a2c05fced`. The corrected operator account states that parent Explore changed ONLY assigned `design.md`: four table-formatting hunks and the trailing comma in a TypeScript documentation example are all inside that artifact, not an outside source-file edit. The operator verified its byte equality with the retained formatter candidate. Legitimate source WIP pre-existed from approved Apply and triggered old-base `EXPLORE_SOURCE_EDIT` misattribution. Preserve that historical allegation/error and all receipts unchanged, without claiming it proves a real source violation.

No complete retained exact old baseline with original binding is currently established. Neither candidate equality nor retained pre-Explore full-content fingerprint `989d6741b6ae108ed99fcb7f02b97fece24c9ce78cfdacfdd7daae423dbe828b` reconstructs it. If historical evidence is insufficient, only later supported exact-current-tree native HUMAN adoption as a NEW baseline can establish a prospective boundary under actual applicable authority. This repair does not adopt or modify the parent. Keep the separate negative fixture with an actual outside-source mutation rejected and its proven delta/violation retained.

### 7. Keep busy refusal nonmutating and the renderer prerequisite minimal

At `Advancement.advance`, propagate the exact `WRITER_BUSY` refusal without invoking failure reflection. Do not weaken native idle/completion-pending/queue guards, suppress unrelated errors, retry advancement in UI, or clear/resubmit the active assignment. Assert unchanged phase/resume phase, claim, generation, baseline/history, session/prompt/context and checkpoint evidence, with no extra prompts/sessions. Owned-operation bookkeeping may report the refused observation but must not imply a checkpoint ran.

Parent `docs/verification/agents-acceptance.md:25-34,94-95` records this seam's earlier RED/GREEN; reproduce it on this repair branch, not by importing the parent package.

For the proven build prerequisite, change only `apps/report/scripts/renderer-manifest.ts` metadata exclusion to inspect exact `.abracode` segments relative to the canonical installation root. Keep absolute/inside/realpath and outside-target symlink refusal. Regression: a real disposable installation nested under `.abracode/worktrees` prepares successfully, includes required inputs and `.abracode-other`, excludes its own metadata, and rejects outside-target symlinks. Parent index `:63-84` supplies prior evidence, not this branch's pass. Inspector detail-query changes remain excluded.

## Risks / Trade-offs

- [Candidate trees collapse staging] → Retain separate index/candidate trees where needed and test staged-then-unstaged cancellation, Git-defined executable modes and symlinks.
- [Git-defined observation is not raw filesystem attestation] → State existing filter/ignored/cache/flag limitations honestly; retain native path/role guards and do not add a parallel inventory subsystem.
- [Unknown pre-existing work is attributed during replan] → Require pre-existing matching attribution; otherwise human prospective adoption, never a success-only or idle-only inference.
- [Native storage is not transactional across keys/refs/forms/prompts] → Journal intent, persist exact binding first, recheck fences and reconcile exact postconditions at every interruption boundary.
- [Baseline objects can be pruned] → Controller-owned pins and backup verification; missing objects stop recovery. Do not delete retained execution resources or evidence as test cleanup.
- [New fields are ignored by old code] → Compatibility means readable history, not safe old writers. Forbid live downgrade with active new-format attempts; use tested compatible recovery or a safe pre-write backup.
- [Native fixture scripts human answers] → This proves form/receipt enforcement, not model judgment or authorization for the real parent. Real forms remain human-only.
- [New prerequisite failures appear] → Retain the exact failure and seek scoped disposition; do not enlarge timeouts, disable checks or import optional UI/agents work.

## Migration Plan

### Implement and prove only in owned/disposable environments

Use additive optional versioned fields and explicit validators; recognized legacy records retain original plan/base/policy/IDs and receive no invented baseline. Missing baseline for a known controlled replan fails closed; initial Explore retains its current trusted fallback. Preserve additive unknown records, historical approvals, failures and legacy originals. Unsupported versions remain inspectable/unavailable for mutation.

Test old-record reads, new-record round trips, immutable history and pause/restart continuation using actual Records/SQL and private Git. Test prior-reader read-only behavior against fixtures. Do not claim old runtime writes are safe merely because decoding succeeds. No database schema change or new dependency is intended; any required one is a reported prerequisite requiring explicit disposition.

Run all captured commands exactly, not just overlapping suites: `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, `pnpm config:schema`, `pnpm licenses:check`, plus `pnpm test:all`, focused regressions and the disposable native journey. Schema generation must be inspected for unintended changes. Retain command/exit/build identity and external proof; no fixture pushes to user remotes.

Extend the existing `native-fixture.ts` / extended native harness with a bounded replan/recovery journey and update `docs/verification/features/full-spec.md`. Prepare a frozen isolated installation with local bare remotes, loopback provider, private state/ports and provisioned Chromium. Health must confirm actual native `server.info`, central activation and worker plugin capability. Drive dirty completed-Apply replan, restart/response-loss recovery, outside-source rejection, missing historical baseline, current-tree adoption rejection/staleness and accepted prospective adoption followed by a distinct fresh plan form/checks/independent Review. Include an unrelated paused companion and verify it stays paused.

Retain logs, source/index/HEAD comparisons, original/history/new target/form identities, check/Review receipts and JSON `result: pass`, `cleanup_complete: true` under a fresh external evidence directory. Stop only fixture children/browsers, remove only owned fixture temporary state, and prove evidence survives teardown. Update the recipe with the actual tested selector/invocation; a proposed selector or old parent pass is not usable proof.

### Operator activation and later parent recovery

These are documented operator stages, not worker actions or implementation task authority:

1. Identify the exact running installation: canonical `ABRACODE_HOME`, selected configuration path, `.abracode/state/opencode/service.json`, native PID/version/`server.info`, pinned executable, active central plugin import/source revision or artifact digest, central Abra session and native config/data/state roots. Use existing discovery/doctor/ownership checks (`opencode/bootstrap.ts`, `stop.ts`); do not infer running source from this worktree's HEAD or start a service to inspect one. Unknown identity is a blocker owned by the operator.
2. Obtain actual applicable user authorization for the exact independently reviewed/tested activation candidate and maintenance window. Quiesce admissions/workers/operations using supported controls without rewriting saved scheduling settings or automatically adjusting capacity. Preserve the unrelated paused issue and all claims/resources/captured policy. A pending stop, uncertain admission or external custody blocks activation.
3. Under quiescence retain a consistent complete native record export (`abra_work_list({include_records:true})`), including unsupported/legacy/context records, native session/worktree inventory, report/evidence files and Git baseline objects/refs. Take SQLite's supported online backup, not a main-file-only copy omitting WAL. Record hashes/identities and test restoration in a disposable instance with no live access.
4. Verify prerequisites at the actual installation: Node 26.4+, pnpm 12.21.0, pinned OpenCode/OpenSpec, frozen dependencies, Git/flock and browser prerequisites for acceptance. Source edits do not update a running controller. No dependency/workspace change is proposed; if the installation differs or requires installation/building, the operator must explicitly authorize those prerequisites, not copy in parent work.
5. Only the authorized operator activates the exact candidate through supported owned lifecycle commands after backup and quiescence. Confirm the same retained session/worktree/record identities and new implementation identity before admitting work. Inspect pending forms and replay uncertainty; do not manually edit records or auto-resume the parent.
6. Later obtain actual applicable parent recovery authority. Inspect its independent historical evidence through supported reads; if insufficient, use the implemented exact-current-tree native human adoption flow, then fresh plan approval/checks/independent Review. This planning change and its human plan approval authorize none of those real-parent actions.
7. Rollback requires quiescence and a tested compatible reader/writer. Restore the pre-upgrade snapshot only if no later work/effects would be lost; otherwise retain the compatible recovery runtime and reconcile forward. Never start old writers against active new-format attempts, remove new baseline history, reset receipts, or discard parent/unrelated work to make rollback work.
