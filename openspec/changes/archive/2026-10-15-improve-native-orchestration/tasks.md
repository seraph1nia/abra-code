# Tasks

## 1. Fix routine waiting before broader refactoring

- [x] 1.1 Convert the isolated pending-CI reproduction into tracked lifecycle/forge regression coverage, including standing authorization, answered human approval and pending-required-review variants; verify the tests demonstrate the current stranded recovery state without contacting a real forge.
- [x] 1.2 Introduce classified completed/waiting/retryable/verification/recovery results at the delivery-to-workflow seam and keep pending CI/review in their current phase with retained authorization; verify pending-to-green and review-required-to-approved transitions resume through ordinary reconciliation.
- [x] 1.3 Schedule due observations with bounded backoff and preserve manual pauses and unsafe head/identity conflicts; verify clock-driven tests cover restart while waiting, unchanged repeated polls, transport recovery and changed-head refusal.
- [x] 1.4 Update operations/recovery documentation to distinguish ordinary waiting from recovery and explain existing already-stranded records; verify the examples agree with status/readiness results and do not automatically resume ambiguous old work.

## 2. Validate external inputs with Effect Schema

- [x] 2.1 Add consumed identifier, policy, command, receipt and failure-category schemas with inferred types, preserving programming defects separately; verify schema tests reject invalid safety-relevant values and `pnpm typecheck` passes.
- [x] 2.2 Replace generic parse-and-cast CLI JSON with a schema-accepting decoder and migrate OpenSpec status, instructions, task progress, validation, schema discovery and archive responses; verify malformed JSON, wrong shapes, documented nulls and additive upstream-field fixtures.
- [x] 2.3 Schema-decode GitHub identity/readiness responses at the forge adapter and preserve bounded source/field diagnostics; verify invalid heads/targets/counts fail before mutation and valid extension fields remain compatible.
- [x] 2.4 Decode configuration YAML, onboarding/local/managed-clone package manifests and setup data instead of treating parsed values as typed objects; verify malformed config/manifests cannot register guessed checks or alter retained execution policy.
- [x] 2.5 Derive tool argument descriptions/validation and custom observer contracts from their owning schemas, remove `any` argument handlers and reuse native decoded contracts at the OpenCode seam; verify tool rejection occurs before side effects and native timestamp/RPC JSON compatibility tests pass.
- [x] 2.6 Document external schema ownership and diagnostic behavior in supported-apis/configuration and record the pinned Effect conversion APIs; verify documented contracts match installed declarations and all migrated external JSON call sites require a decoder.

## 3. Version durable records and preserve legacy evidence

- [x] 3.1 Define versioned Project, Setup and Execution schemas with policy snapshots, phase-required payloads, operation intent and explicit control generation/revision; verify constructors reject impossible receipt/phase combinations while legitimate provisioning intents remain representable.
- [x] 3.2 Replace generic native record casts with validated per-record reads/scans that expose unavailable entries individually; verify one unsupported record cannot hide valid work or completed history.
- [x] 3.3 Implement guarded unversioned-to-v1 normalization with retained originals, stable native IDs and unchanged approval/claim/delivery evidence; verify fixtures cover active, pending-form, interrupted, setup and completed executions.
- [x] 3.4 Preserve unknown-future and incomplete legacy records without guessed receipts or destructive rewrites; verify read-only diagnostics and mutation refusal remain visible after restart.
- [x] 3.5 Extend doctor/readiness with migration diagnostics and add coordinated export/backup guidance for plugin records and SQLite; verify dry-run inspection does not rewrite originals and backup examples handle WAL consistency.
- [x] 3.6 Document compatible upgrade/rollback rules and replace affected persistence notes in architecture/recovery; verify old code is never presented as safe to run against unsupported new records.

## 4. Adopt scoped Effect process execution

- [x] 4.1 Reimplement Runner with the pinned Effect ChildProcess/ChildProcessSpawner and Node layer behind its existing seam, explicitly configuring process groups and TERM/KILL escalation; verify existing uncooperative-child and surviving-descendant interruption tests pass.
- [x] 4.2 Add structured command/deadline options while accepting legacy argument arrays, retaining the ordinary-command default and a separate configurable verification deadline; verify long-check, configured-timeout, invalid-deadline and legacy-config fixtures.
- [x] 4.3 Preserve per-stream output limits, bounded streamed diagnostics, allowed semantic exit results, environment overrides and raw/trimmed output; verify output overflow, stderr/exit context, whitespace and pending-check exit-code cases.
- [x] 4.4 Replace thin filesystem wrappers with Effect platform operations where they remove custom plumbing and narrowly retain mutation-completion protection; verify cancellation cannot release writer ownership before filesystem mutations complete and raw diff/document tests remain unchanged.
- [x] 4.5 Update supported-apis, operations and testing for process options and verified cancellation behavior; verify the process contract runs in Node and the pinned native host without adding an alternate runtime dependency.

## 5. Deepen workflow coordination and shorten lock scope

- [x] 5.1 Extract cohesive execution-operation, advancement, authorization and query internals behind the controller facade, keeping the tested Runtime/Runner/Delivery/Records/WorkGraph seams; verify existing lifecycle tests still cross the public workflow interface.
- [x] 5.2 Remove controller dependency reach-through from ProjectSetup, management tools, worker assignment lookup and visibility projection by injecting narrow owned operations/queries; verify setup and observer tests no longer require mutation access through public controller fields.
- [x] 5.3 Persist operation identity, control generation, input evidence, expected postconditions and reservations before slow submission; verify interruption/crash tests retain an explainable intent before native worktree/session/prompt or delivery actions.
- [x] 5.4 Run checks, network operations, provisioning and retirement under execution-specific ownership outside global coordination, with bounded cross-ticket concurrency; verify a held long check does not delay another ticket's approval/pause/retry and competing processes cannot acquire duplicate ownership.
- [x] 5.5 Compare operation/generation/fingerprint on result commit and merge current observation fields rather than overwriting stale records; verify pause/replan/policy-revision races reject stale successes without losing recent progress/decisions.
- [x] 5.6 Implement stop-request versus stop-confirmed control and postcondition-based restart reconciliation for uncertain effects; verify replacement writers wait for process/native-worker quiescence and exact pushed refs/PRs/native IDs are rediscovered without duplicates.
- [x] 5.7 Update architecture/recovery with lock ordering, operation ownership and failure classification; verify no documented control path waits for an execution lock, external call or stop while holding shared coordination.

## 6. Separate active capacity from retained execution capacity

- [x] 6.1 Add schema-backed global/repository max_executions and normalize old max_workers-only settings to the prior retained ceiling; verify configuration migration and doctor output show the effective limits without silently expanding resources.
- [x] 6.2 Atomically reserve global, repository and role compute capacity, retaining uncertain prompt-admission reservations; verify independent-process admission tests never exceed effective active limits.
- [x] 6.3 Release active capacity on confirmed idle/wait/stop while retaining issue claims and incomplete-resource reservations; verify idle approved/blocked PRs permit other work when retained capacity is available.
- [x] 6.4 Project distinct active, role and retained blockers through readiness/status schemas and basic native presentation; verify tests identify the actual consuming executions and do not imply released claims.
- [x] 6.5 Update configuration examples, architecture and scheduling operations for the new semantics; verify legacy defaults and deliberately increased retained-capacity examples against normalized configuration fixtures.

## 7. Improve GitHub readiness and delivery evidence

- [x] 7.1 Add decoded observations for draft/mergeability/review and current-head check attempts, including documented pending exit semantics; verify fake forge tests distinguish pending, failure, skipped, cancelled, advisory and transport states without parsing arbitrary error prose.
- [x] 7.2 Add snapshotted all-reported/required and explicit no-check policies with authoritative applicable required-context discovery including app identity; verify missing/unreported/unreadable requirements remain unconfirmed and advisory failures are nonblocking only under explicit required-only policy.
- [x] 7.3 Add configured merge/squash/rebase submission with expected-head protection and retained method intent; verify exact argv/request contracts, changed-head refusal, unsupported-method/merge-queue handling and no protection bypass.
- [x] 7.4 Record exact source PR/head/target and authoritative resulting commit, then verify the result against a freshly fetched target; verify local bare-remotes plus fake forge cases cover merge, squash, rebase, deleted source refs, lost response and target history rewrite.
- [x] 7.5 Generate useful PR titles and controller-owned intent/evidence summaries while preserving user text and exact PR rediscovery; verify retry creates no duplicate and summary-update tests preserve content outside owned markers.
- [x] 7.6 Update supported-apis, configuration and delivery recovery with verified check/merge semantics and preservation receipts; verify documentation distinguishes a premerge test commit from a retained merged result.

## 8. Make generated-path retirement explicit

- [x] 8.1 Add an empty-by-default exact relative generated-directory policy and retain it in execution snapshots; verify unsafe roots, parent/absolute/glob/control paths and later unapproved policy broadening are rejected.
- [x] 8.2 Validate exact owned paths, tracked descendants, symlink traversal and nested repositories immediately before deletion; verify disposable-repository tests preserve every unexpected, tracked or escaping path.
- [x] 8.3 Integrate narrowly authorized generated-directory removal after preservation and writer quiescence, followed by complete status checks and non-force native retirement; verify configured dependency leftovers can retire while an unapproved ignored note remains a blocker.
- [x] 8.4 Persist cleanup progress and reconcile interrupted disposal/native removal without acting on replacement resources; verify crash-after-removal closes only the original claimed issue and retains session/delivery history.
- [x] 8.5 Update configuration/operations/recovery with explicit path authorization and refusal diagnostics; verify default cleanup behavior stays conservative and examples never authorize blanket ignored-file deletion.

## 9. Add durable decisions and declared waits

- [x] 9.1 Add versioned keyed decision/wait data to execution contracts, including answer owner, generation, clearing condition, expiry and history; verify duplicate submissions and unrelated status updates cannot lose an open question.
- [x] 9.2 Add assignment-checked worker question/progress/wait tools and Supervisor inspect/answer/disposition tools; verify inactive/wrong-role callers cannot mutate decisions or use an answer to authorize plan/merge/delivery.
- [x] 9.3 Route user-owned answers through native forms with stable identity and reconstitution after restart, retaining separate plan/merge receipts; verify rejected/stale answers cannot clear a new-generation obligation.
- [x] 9.4 Recheck declared waits and clear them only on matching evidence/answer, surfacing expired waits with their actual owner; verify controlled-clock tests distinguish dependency, user, command and invalid/expired waits.
- [x] 9.5 Add decision/wait projection to existing status/detail contracts and update worker instructions, orchestration/execution skills and recovery docs; verify questions stay visible after progress messages and native restart.

## 10. Add progress-aware native supervisory attention

- [x] 10.1 Retain meaningful native worker/operation progress separately from busy and poll timestamps using verified pinned events and explicit reports; verify repeated busy observations do not reset progress age while actual activity does.
- [x] 10.2 Implement clock-driven role/operation watchdog policy respecting command deadlines and declared waits; verify one suspected-stall incident is surfaced without automatic interruption and healthy long checks are not killed.
- [x] 10.3 Persist incident generation, Supervisor session/prompt identity, admission state, handling disposition and finite budgets before native submission; verify duplicate events and crash-after-admission reuse the original message identity.
- [x] 10.4 Add bounded native attention dispatch, missing/unavailable Supervisor recovery and explicit handled/user-needed disposition; verify admitted-but-unhandled incidents remain visible, no replacement Supervisor is invented and synthetic informational notices never create loops.
- [x] 10.5 Enforce diagnostic-turn/repair policy, pause suppression, configured model selection and exhausted-budget behavior in controller commands; verify attention cannot restart paused work, widen authority or repeatedly retry provider failures.
- [x] 10.6 Update supported-apis, Supervisor instructions, operations and testing with verified native attention admission and progress evidence; verify a real native fixture exercises one incident turn and restart deduplication without noisy routine polling.

## 11. Implement research-only work and retained reports

- [x] 11.1 Extend normalized intake/SQL creation/request identity with effective workflow and scoped report contract, retaining full-openspec as default; verify changed-policy retries reject rebinding and existing requests/claims migrate compatibly.
- [x] 11.2 Add policy-aware readiness/provisioning and scope approval so research requires neither OpenSpec setup nor coding verification; verify full-spec prerequisites are unchanged and research approval honors the registered plan policy.
- [x] 11.3 Add native Research assignment, prompts and read-only guards across session lookup, models, worker events and role capacity; verify real native write/patch/shell/management attempts are denied while authorized reads work.
- [x] 11.4 Add schema-validated assigned report submission and bounded atomic publication with base/worker/hash receipt outside the disposable worktree; verify uncertain publication reconciles idempotently and absent/tampered/mismatched reports prevent completion.
- [x] 11.5 Add outcome-specific research retirement against the unchanged source base and report receipt without a push or PR; verify cleanup removes only the native research worktree and the report/session history survives restart.
- [x] 11.6 Add explicit research-to-implementation intake with new issue/request identity, dependency and report reference; verify a recommendation alone launches no work and authorized follow-on preserves the original report unchanged.
- [x] 11.7 Add bounded report reads and policy-aware basic Plan/detail output, document the Research role and workflow in existing skills/operations; verify a native research vertical slice starts without OpenSpec and remains readable after retirement/restart.

## 12. Implement lightweight fixes with retained evidence gates

- [x] 12.1 Add schema-validated short goal/acceptance/constraint scope and explicit lightweight policy selection; verify incomplete scope creates clarification rather than launching Apply and default intake remains full-spec.
- [x] 12.2 Implement scope fingerprint/approval/revision without an OpenSpec artifact directory; verify approval-required/standing-policy cases and changed-scope receipt invalidation through native forms.
- [x] 12.3 Execute Apply/checks/independent Review/delivery through shared operation ownership with policy-appropriate completion checks; verify a no-OpenSpec repository can deliver a lightweight fix and unfinished/stale verification cannot pass.
- [x] 12.4 Extend replan/retry/readiness, prompts and basic Plan presentation for lightweight state; verify native restart preserves the scope, claims and review evidence without inventing OpenSpec task counts.
- [x] 12.5 Document lightweight selection, scope approvals and retained delivery gates in configuration/operations/workflow skills; verify a native fixture completes the full lightweight path with the same exact-head merge authorization rules.

## 13. Add bounded check and review correction rounds

- [x] 13.1 Add immutable round identity/history, finding dedupe and finite repair budget snapshotted per execution, with repair disabled by default; verify repeated findings/restarts cannot reset the budget.
- [x] 13.2 Route in-scope prearchive check/Review failures through authorized Apply retries while retaining approved planning content; verify changed scope becomes a durable decision and successful correction reruns checks and independent Review.
- [x] 13.3 Decode actionable head-bound forge findings and admit only explicitly enabled in-scope rounds; verify unrelated comments, ambiguous instructions, stale review heads and exhausted budgets cannot launch repairs.
- [x] 13.4 For full-spec postarchive corrections create a revision OpenSpec planning cycle in the same issue worktree and retain prior archives/round bases; verify strict validation, configured plan approval, real tasks and new archive before another push.
- [x] 13.5 Invalidate old verification/review/merge authorization on every changed delivered head while retaining PR identity, and require fresh matching approval before merge; verify both lightweight and full-spec correction cases reject stale forms/receipts.
- [x] 13.6 Update recovery, acceptance documentation, prompts and observer round summaries; verify native fixtures exercise a bounded successful correction and an exhausted-budget escalation without changing existing default autonomy.

## 14. Finish native operator visibility and navigation

- [x] 14.1 Complete shared observer schemas/read-model projection for policy, operations, waits, decisions, attention, rounds and capacity; verify per-record failures remain visible alongside valid active and completed tickets.
- [x] 14.2 Present actionable reasons/owners/next actions in work home/sidebar/Overview while preserving separate workflow and worker state; verify classification tests keep routine CI waits out of recovery failures.
- [x] 14.3 Complete policy-aware Plan/report/history views and retained report links without fictional task progress, keeping ticket-wide/historical diff identity; verify retired research and corrected coding tickets remain inspectable after restart.
- [x] 14.4 Preserve read-only mutation separation, bounded lazy reads, keyboard/focus/back state, narrow layouts, theme switching and offline freshness; verify real native renderer tests cover each new state and observer requests cannot answer forms.
- [x] 14.5 Update README/operations and acceptance coverage with concrete policy/wait/report examples; verify every documented user action maps to an actual controller tool or native navigation action.

## 15. Cross-capability acceptance and delivery readiness

- [x] 15.1 Run `pnpm check`, `pnpm test` and `pnpm test:e2e` against the completed implementation; verify all required repository gates pass with only temporary repositories, local model endpoints and fake forge mutations.
- [x] 15.2 Run `pnpm build` and the configured native renderer integration checks, and verify the built plugin/TUI keep host Effect/OpenCode packages external and expose the new read contracts correctly.
- [x] 15.3 Run combined upgrade/restart/race acceptance spanning migrated full-spec work, a pending delivery, durable decisions, retained research and a corrected lightweight head; verify no duplicate session/prompt/PR, stale receipt acceptance, lost report or unsafe cleanup occurs.
- [x] 15.4 Validate the complete change with `pnpm exec openspec validate improve-native-orchestration --strict` and reconcile the finding-coverage table with actual delivered tests/docs; verify every task is supported by evidence before marking implementation complete.
