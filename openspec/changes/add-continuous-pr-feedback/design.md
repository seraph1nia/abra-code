# Design

## Context

See `proposal.md` for motivation and the seven capability deltas for behavioral contracts. This design is required because feedback, public mutations, policy resolution and external branch custody cross existing lifecycle modules.

Observed implementation:

- `.opencode/plugins/crew/index.ts` owns a central scheduler-leader lock and starts the scoped Effect monitor only at the central location. The existing TUI plugin consumes read-only visibility RPCs and native invalidations.
- `src/git/delivery.ts` already creates/rediscovers an owned PR, preserves user-authored description text, binds merges to the delivered head and proves preservation. `src/git/readiness.ts` distinguishes required/advisory checks and missing requirements.
- `src/git/findings.ts` consumes failed check summaries and current-commit, nonempty changes-requested review bodies. `tests/unit/forge-findings.test.ts` explicitly excludes older and comment-only reviews; that behavior must change deliberately.
- `src/workflow/attention.ts` suppresses ordinary attention during delivery/approval waits. Existing attention admission already retains native prompt identities, finite diagnostic turns and capacity limits.
- `Corrections` and `Finalization` retain finite rounds, revision OpenSpec changes after archival, current-content verification/Review and exact-head merge approval. These remain the only coding correction and final delivery routes.
- Project policy is resolved in onboarding and snapshotted by `src/workflow/execution.ts`. Native plugin storage has no public transaction/CAS API; existing controller locks and record revisions protect relationships. The SQLite work graph owns issue/request identity and workflow selection.

FirstMate informed the separate quality/merge axes, quiet waits and single branch custodian: [project modes](https://github.com/kunchenguid/firstmate/blob/67abd40a6b7b0c39fb509527afd3784534c5bd9f/bin/fm-project-mode.sh) and [validation supervision](https://github.com/kunchenguid/firstmate/blob/67abd40a6b7b0c39fb509527afd3784534c5bd9f/.agents/skills/validation-supervision/SKILL.md). Its shell watcher is not a required dependency.

## Goals / Non-Goals

**Goals:**

- Complete GitHub delivery follow-through using one controller, durable identities and bounded reasoning.
- Include drafts, reviewers, replies/resolution, CI reruns and an optional no-mistakes engine in the same reviewable implementation plan.
- Retain independent policy axes and explain what each active execution is authorized to do.

**Non-Goals:**

- Other forges or external review-upload systems: the user explicitly selected GitHub only.
- Another OpenCrew daemon, parallel work graph, worker publication path, automatic model substitution or protection bypass. The optional no-mistakes daemon remains an external runtime with its own resource ownership.

## Decisions

### 1. Extend the existing plugin pair with focused services

Keep the server and TUI entrypoints. Introduce focused TypeScript services for GitHub feedback observation, feedback reconciliation/disposition, outward PR actions and external validation, with versioned contracts at their boundaries. Wire them through `applicationLayer` and the controller. Keep `Advancement` responsible for ordering gates rather than expanding it into another forge implementation.

The central monitor schedules due observations. Controller issue-operation ownership serializes feedback transitions with correction, publication and merge; short record updates merge newer progress/decisions. Services invoked inside an owned operation do not reacquire the same lock. Native attention continues to use its existing admission lock and rechecks record generation before dispatch. No observer/UI call starts observation side effects.

Separate feature plugins with independent stores were considered; they would duplicate leadership and make approval/correction races harder to prove. Shell watchers were also considered; native scoped Effects already cover service lifetime, restart and event fallback.

### 2. Persist semantic observations and immutable finding revisions

Add optional versioned feedback state to the existing execution aggregate, with a bounded history resource through `Records` if older handled revisions must be paged separately. Retain:

| Record           | Required identity/evidence                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Observation      | Repository, PR, target, delivered/provisional head, time, source completeness, semantic digest, next check and retry state                              |
| Finding revision | Source kind/ID, body or run-attempt digest, author, source URL, original commit/path/line when available, thread state, assessed head and applicability |
| Disposition      | Finding revision, assessed head, actor, reason, scope classification and correction/decision/evidence references                                        |
| Diagnostic batch | Sorted finding revisions, execution generation, assessed head, incident/prompt identity and admission/handling state                                    |
| Outward action   | Kind, target identity, payload digest, snapshotted authority, prepared request identity, uncertain/result evidence                                      |

Source identity is separate from assessment: a thread authored on H1 can be assessed against H2 without claiming it was authored on H2. Edited content creates a new revision. Approval/dismissal supersedes review verdicts where authoritative but does not erase independent comments or unresolved threads. Controller-owned replies are recognized by authenticated author plus retained action marker/receipt and never feed a reply loop.

Use initial limits of 256 active findings, 64 findings per diagnostic/correction batch, 8 KiB finding text and 32 KiB total failing-job excerpts per observation. Retain bounded summaries; truncation of substantive feedback, incomplete pagination or active-set overflow makes the observation unconfirmed and exposes an inspection decision. Handled history may be paged, but unresolved items cannot be evicted to create apparent clearance. Validate all new records and wire shapes with existing schema conventions.

An optional field on a legacy execution means unobserved, not clear. Unknown feedback versions remain preserved and unavailable for affected mutations.

### 3. Share check policy and observe every published feedback source

Extend the existing forge boundary with typed REST/GraphQL reads for PR identity, review verdicts, thread/comment connections and ordinary issue comments. Reuse canonical current-attempt check/status normalization from readiness so observation and merge agree about policy-blocking versus advisory failures. GitHub Actions run/job/log evidence is supplemental: unavailable logs do not erase a known failing check. Nested GraphQL comments and outer threads both need explicit pagination/completeness checks.

Read the PR identity before and after multi-page observation; discard a mixed-head result. Applicable rules and required-check discovery continue to fail closed. A missing/cancelled check is not automatically a code defect; a newer successful attempt supersedes the prior failure. A substantive new comment enters classification even without a changes-requested verdict. An old unresolved thread remains assessable; no general current-commit filter applies to discussions.

Reuse the 30-second initial cadence and existing capped exponential backoff up to five minutes; honor a longer authoritative rate-limit reset. Unchanged semantic results, transport failures and ordinary pending checks cost no model turns. Observe delivered `awaiting_merge` executions and deliveries blocked specifically by CI/review, including before human approval. Identity-recovery blocks, explicit pauses and active writers suppress automatic actions. Draft feedback can be retained when its provisional head is stable, with diagnosis deferred while writing/validation is active.

Polling is chosen over mandatory webhooks because it fits the existing local service and recovery path. Webhooks are unnecessary for this change.

### 4. Separate observation, diagnosis, repair and merge clearance

Persist a new feedback batch before asking `AttentionService` to admit a native prompt. Add a feedback incident kind that bypasses only ordinary merge/CI-wait suppression; keep pause, attention capacity, execution generation and diagnostic budget checks. Use the original native message ID on uncertain admission. Further revisions arriving during diagnosis form a later batch; do not change the already-admitted batch.

Extend `crew_work_findings` to project retained feedback and add a narrow central feedback-disposition action accepting generation, assessed head, batch/finding revision IDs, disposition and reason. Permit that action in the diagnostic guard alongside existing `crew_work_correct`; it cannot approve a plan/merge, post content or enable policy. Persist exhausted/zero-diagnostic-budget feedback as user-needed without admitting a model turn. Diagnostic budget remains execution-wide across heads, separate from repair and rerun budgets.

Only accepted, revalidated in-scope revisions enter `Corrections.prepare` through the owned correction operation. Batch related findings. Reserve/consume one round with the retained launch intent, then reconcile that same intent on uncertain native admission. Preserve old archive/approval history, invalidate current verification/Review/delivery evidence, and require a new matching merge approval after the head changes. Repeated attempts to repair the same finding require inspection. Full-spec post-archive corrections still create revision planning; quick mode does not waive independent Review.

Immediately before merge, take a fresh complete observation under the same issue operation and check the feedback/action barrier: no unclassified substantive finding, accepted unaddressed finding, pending diagnostic/correction, required public action, in-flight rerun, external custody or scope decision. Keep same-head authorization while merely waiting. Recheck identity and retain the existing GitHub head-match merge flag. This blocks local races; GitHub can still receive a comment after the final read. Required-review/conversation branch rules remain the server-side protection for that residual race.

### 5. Resolve quality profiles once and keep authority axes separate

Add optional `quality_profile` to registration and task intake. Preserve explicit task preference in the SQLite issue/request contract with an additive nullable column; omit absent preferences from canonical legacy request identity. Include an explicitly requested profile in normalized retry comparison. Recheck workflow compatibility at intake and admission so a queued issue cannot silently change workflow after project settings change.

| Profile  | Coding workflow compatibility                | CI default   | Plan approval default |
| -------- | -------------------------------------------- | ------------ | --------------------- |
| strict   | Explicit full-openspec                       | all-reported | Required              |
| standard | Explicit full-openspec or lightweight-fix    | required     | Required              |
| quick    | Explicit lightweight-fix with accepted scope | required     | Standing authority    |

No profile selects a workflow. Repository coding profiles are ignored for research; explicit task coding profiles on research are rejected. Retain the shipped full-openspec default and legacy CI/approval values when no profile is selected.

Persist named profile, resolver version and explicit CI/plan override provenance. Resolve task profile before repository profile; apply explicit project overrides after profile defaults. An explicit registration profile selection replaces covered profile defaults, then applies overrides supplied in that request; profile-omitting registrations retain existing values/provenance. An explicitly supplied covered field is a custom override even if its value matches today's preset. Existing pre-profile projects remain legacy/custom rather than acquiring guessed provenance. Snapshots store actual effective values, so later preset revisions cannot weaken active work.

Add independent, snapshotted project settings with these proposed public shapes:

| Setting       | Values/default                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| `publication` | `ready` (existing behavior), `draft-until-verified`, `manual-ready`                                           |
| `reviewers`   | Explicit users/teams; `request: manual` default or `on-ready`; `rerequest_after_correction: false` default    |
| `discussion`  | `replies: manual` default or `verified`; `resolve_threads: manual` default or `addressed`                     |
| `ci_retry`    | `max_reruns: 0` default, range 0-5; explicit workflow allowlist and retained transient-failure classification |
| `validation`  | `engine: native` default or `no-mistakes`; external `max_runs` range 1-6, default 1 when selected             |

Verification, independent Review, merge authority, delivery type, no-check authorization and diagnostic/repair budgets remain independent. Do not infer risk from a directory name. Coding-only settings do not implicitly run during research or OpenSpec setup. Existing conservative setup delivery stays unchanged.

### 6. Model outward GitHub actions as a recoverable outbox

Use controller-owned prepared/running/uncertain/confirmed action records. Bind payloads to execution generation and current head plus thread/run/request identity. Revalidate before executing; if it changes, supersede the prepared action. Use the configured forge adapter and argument arrays; workers receive no new direct publication authority. Manual actions require an explicit controller request with the concrete target/payload; automated actions require their matching snapshotted policy. Public action authority is unrelated to merge authority.

- **Drafts:** introduce a provisional-publication receipt separate from `delivered_commit`. After an idle Apply implementation commit, opted-in draft publication pushes only that owned branch and creates/rediscovers the PR with pending gates clearly described. Native/external validation, independent Review and archival still precede final delivery. `draft-until-verified` marks the final verified head ready; `manual-ready` creates a user-owned wait. Externally changed draft state never fabricates missing gate receipts. Keep the same PR across all rounds.
- **Reviewers:** offer CODEOWNERS/recent-authorship suggestions as evidence, but send only explicitly selected users/teams. Check eligibility and existing pending/submitted state. Key receipts to the request lifecycle, not every poll; a submitted review can settle an uncertain prior request. Re-request after correction needs its separate setting or manual action.
- **Replies/resolution:** generate a bounded prepared response from the published corrective commit and actual receipts. Post inline replies to their original discussion and ordinary summaries to the PR discussion as appropriate, with an opaque action marker for reconciliation. Do not include private intent, raw logs or unpublished implementation details. Default automated wording is evidence-based, avoiding unsupported claims. Before resolving a thread, refresh all comment revisions, `isResolved` and `viewerCanResolve`; all substantive thread findings must be addressed. Record reply and resolution separately. Never dismiss another review verdict.
- **CI reruns:** after an authorized transient/infrastructure classification and workflow allowlist match, prefer the failed-jobs endpoint for a completed exact-head Actions run. Reserve the independent rerun budget before sending; record original run/attempt and observe the incremented attempt. Reconcile unknown responses before any retry. No rerun for missing contexts, code defects, non-Actions statuses or active attempts. Do not enable debug logging or bypass fork-workflow approval.

GitHub has no general exactly-once mutation key. Reconcile marked replies, current draft/thread state, requested/submitted reviews and Actions attempt identity. If a user removes/edits a marker or the effect cannot be established, retain an uncertain action and request inspection instead of assuming either success or safe replay. This deliberate wait is preferable to duplicate notifications or public replies.

### 7. Integrate no-mistakes as a subordinate validation engine

The installed executable inspected during planning is `no-mistakes v1.84.0 (4822244)`. Its help exposes bounded AXI waits, `--launch-nonce` with `--validation-generation`, `--base-branch`, `--skip`, run/status/respond and guarded sync. Treat that as the initial tested compatibility contract; version/feature-probe and decode consumed output rather than assuming all newer builds are compatible. Add a focused process/protocol adapter and a pinned maintained TOON decoder such as the [official TypeScript SDK](https://github.com/toon-format/toon); map its decoded data into strict local schemas, including quoted commas, multiline descriptions, errors and unknown outcome handling. Do not parse findings with comma splitting or depend on the external SQLite database.

Add a `validating_external` phase/substate between idle Apply and native verification, backed by an exclusive validation-custody operation and versioned run receipt. Under selected policy:

Count running/fixing or admission-uncertain external work against active-worker capacity and retain the execution/worktree claim throughout. Release active capacity at an external decision wait only after supported runtime evidence confirms no external agent is executing; branch custody remains exclusive. Do not treat a returned drive command as proof that external compute stopped.

1. Require an initialized engine and healthy supported daemon. Setup is an explicit central operation; never install, initialize hooks/remotes or restart a shared daemon merely because validation was selected.
2. Commit the stable implementation under controller authority. Persist submitted head, accepted intent digest, launch nonce, generation and finite run budget before `axi run`. Supply the retained accepted intent, recorded target branch and `--skip=rebase,push,pr,ci`; use `--no-publish-intent` and bounded waits. These exclusions retain the pinned base, controller publication and native CI ownership. No-mistakes remains responsible for its own validation steps and internal fixes.
3. Persist the launch receipt/run ID before following returned gates. Only one controller drive call is active. Ordinary wait expiry reattaches to the same run. Never blindly resend `respond`: reconcile the exact run/step/gate first. Do not use `--yes`. Mechanical in-scope fixes require finite trusted engine fix limits; scope/protected-path/test exceptions require explicit durable decisions. Capture effective external fix limits at preflight; if they cannot be established as finite, do not admit automatic fixes.
4. While custody is external, prohibit native Apply, publication, cleanup and competing fixes. External-owned private worktrees belong to that runtime; record their evidence without adding/removing them through native OpenCode inventory.
5. Adopt only supported terminal outcomes and the engine's offered `branch_sync` action after a fresh check. Preserve all pipeline fix commits. Expected integration-owned skipped stages are recorded explicitly; unexpected skips, overrides, missing objects or conflicting refs require recovery/decision. Do not improvise reset/rebase/stash or recover with content loss.
6. Run configured native verification and independent Review on the adopted content, then archive and publish normally. Every later correction needing external validation consumes the next allowed run; exhausted external budget becomes a decision rather than a silent native fallback.

Pause suppresses future automatic controller responses and shows actual external liveness. It does not claim a background pipeline stopped. An explicit cancellation/scope invalidation uses supported abort followed by confirmed custody recovery before another writer or cleanup. No force removal or shared-daemon restart is a recovery path.

Delegating external push/PR/CI stages was considered; it would publish before OpenCrew's native Review/archival and create two delivery owners. Running the external validation stages and retaining controller publication preserves the requested engine integration and the existing lifecycle contract.

### 8. Extend native tools and visibility without mutation through reads

Expose feedback dispositions, draft/ready actions, reviewer requests, prepared replies/resolution, CI reruns and external setup/gate decisions as narrow validated central controller routes. Require expected generation/head and action revision as appropriate. Diagnostic prompts may classify and request a policy-bounded correction/rerun; the controller rechecks their authority. Public writing and external gate decisions use their specific authorization routes, never observer RPCs or a generic diagnostic approval.

Extend existing read models with lazy feedback/action/external-validation detail and effective policy provenance. Show freshness, original/assessed head, finding sources, round/rerun/run budgets, draft state, reviewer state, uncertain outward actions and custody/answer owner. Use host theme, native keymaps/forms, focus rules and after-commit invalidations. Historical detail remains available after native worktree retirement. A recheck action is explicit; merely opening a panel performs no lifecycle work.

## Risks / Trade-offs

- **Larger scope:** drafts and an external engine add lifecycle states. Mitigation: build contracts and observation first, then bounded corrections, outward actions and external custody in dependency order; do not drop the expanded features from acceptance.
- **GitHub race after final read:** comments do not have a merge-atomic version token. Mitigation: serialize local operations, refresh immediately before guarded merge and honor server protections; document the remaining remote race.
- **Public mutations with uncertain outcomes:** not every API provides an idempotency key. Mitigation: prepare once, reconcile observed effects, and retain ambiguity instead of blind retries.
- **Changed or stale reviewer intent:** new heads do not imply feedback is obsolete. Mitigation: retain original context, reassess applicability and invalidate unsent replies/resolution on changed revisions.
- **Cost escalation:** repeated CI/model/pipeline attempts can compound. Mitigation: separate finite diagnostic, repair, rerun and external-run/fix limits; none reset with polling or a new head.
- **External runtime capabilities:** TOON output, custody and gate behavior may vary by version. Mitigation: feature probes, a tested decoder fixture suite, explicit unsupported states and no fallback that bypasses the configured engine.
- **Read permissions:** inaccessible discussions prevent clearance. Mitigation: show required permission/source diagnostics; supplemental log failures remain distinct from incomplete required feedback.
- **Legacy compatibility:** absent new fields must not imply new authority. Mitigation: additive migrations, legacy request-hash fixtures and retained effective policy snapshots.

## Migration Plan

1. Add validated optional feedback/action/validation records, profile/automation settings and additive SQLite profile preference without changing legacy request identity or policy defaults. Recognized old records remain native/manual; unknown new records are preserved.
2. Enable deterministic feedback observation and pre-merge clearance for eligible owned GitHub executions. Initially absent observations remain unconfirmed until fetched; no automatic repair/public actions are newly authorized.
3. Connect feedback diagnosis/correction using existing budgets; ship profile resolution and visibility. Register the separately opt-in publication, reviewer, discussion, rerun and external-engine settings.
4. Complete each opt-in path and its failure/restart fixtures. Update `docs/configuration.md`, `docs/operations.md`, `docs/recovery.md`, `docs/architecture.md`, `docs/supported-apis.md` and project examples before enabling it on a real project.
5. Validate with `openspec validate add-continuous-pr-feedback --strict`, `pnpm check`, `pnpm test`, and `pnpm test:e2e`. Tests use temporary repositories, fake GitHub/process adapters and the existing native fixture provider; no user remotes, public comments, shared no-mistakes runs or live model calls are used by CI.

Rollback requires quiescing owned operations and external custody first. Disabling new authority affects future admissions; it does not reinterpret an active snapshot. Keep durable action/run evidence and SQLite additions. An older binary that cannot decode an active new record must leave it unavailable for mutation; never downgrade by stripping custody, action, profile or authorization fields.

## API Evidence

- Existing native contracts and version pin: `docs/supported-apis.md`, installed `@opencode/plugin`/client declarations and existing native tests.
- GitHub [review requests](https://docs.github.com/en/rest/pulls/review-requests), [review-comment replies](https://docs.github.com/en/rest/pulls/comments#create-a-reply-for-a-review-comment), [thread/ready GraphQL contracts](https://docs.github.com/en/graphql/reference/pulls), [Actions reruns](https://docs.github.com/en/rest/actions/workflow-runs#re-run-failed-jobs-from-a-workflow-run), and [`gh pr ready`](https://cli.github.com/manual/gh_pr_ready). These document remote behavior; local adapter fixtures must still verify consumed fields and unknown outcomes.
- Local read-only CLI probes performed for no-mistakes v1.84.0: `--version`, root/AXI help, and run/status/respond/sync/init/doctor help. No validation run, setup, daemon mutation or GitHub write was performed during planning. Execution/protocol evidence must be captured in isolated fixtures before the adapter is considered supported.
