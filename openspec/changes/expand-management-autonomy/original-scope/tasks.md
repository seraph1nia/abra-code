# Tasks

## 1. P0.1 — Message semantics and native reliability audit

- [x] 1.1 Refresh the scoped audit against the implementation-time revision, reproduce the planning baseline's report-snapshot worker failure if still present, and retain exact commands/results; verify messaging, native-message-admission, attention, obligations, supervision, scheduler and lead tests run without weakening existing assertions.
- [x] 1.2 Document the disposition/transport/response transition matrix in the messaging runbook, including owners, stable identities, predecessor/successor rules, restart and authorization; verify every transition maps to current contracts and an existing or added behavioral test.
- [x] 1.3 Add missing regressions for lost admission response, session failure immediately after admission, adjacent failed/succeeded idle events, out-of-order progress/completion, duplicate/missed events and compaction/history lookup; fix only reproduced gaps and verify uncertain absence never permits a replacement native ID.
- [x] 1.4 Exercise queued restart, interrupted-before-consumption and interrupted-after-consumption, cancel/consume races, acknowledgement-commit-before-notification and scope/lead revocation; verify old/new authority, exact prompt counts and historical accepted-reply readability with unit and isolated native cases.
- [x] 1.5 Audit all worker/lead prompt entry points against retained intent, exact payload, session/role/generation/location and captured models; verify native forged/direct/metadata-only prompts cause zero unauthorized provider work and document the pinned duplicate-ID hook limitation.

## 2. P0.2 — One bounded missing-response recovery

- [x] 2.1 Add backward-compatible optional one-attempt recovery metadata to the original request contract with separate immutable-intent/monotonic-recovery validation; verify legacy decoding, conflicting reminder identity refusal, irreversible budget reservation and preserved reply evidence across generations.
- [x] 2.2 Implement deterministic missing-response classification from exact consumed-input evidence and a relevant later successful turn; verify normal answer/ack, queued, busy, failed, interrupted, unavailable, superseded and committed-response-before-notification cases, including ambiguous event ordering.
- [x] 2.3 Reserve the one response-only reminder through existing execution/lead operations, captured diagnostic budgets and appropriate capacity; verify manual/zero-budget behavior, same request identity, no substantive task replay, and pause/revoke/scope-change races at fresh admission checks.
- [x] 2.4 Extend existing prompt guards/preflight to recognize the exact retained reminder while preserving original reply correlation; verify allowed admission plus foreign session/generation/content/attachment refusals and no use of metadata as authority.
- [x] 2.5 Reconcile reminder admission/response loss with its original native ID and merge fresh reply commits; verify concurrent ticks, early replies and controller/native restart yield at most one automatic reminder, no stale overwrite and no replacement ID after uncertain absence.
- [x] 2.6 Integrate one stable actionable communication escalation with existing Attention incidents; verify missing acknowledgement versus answer, failed/interrupted/unavailable/stale reasons, exhausted budgets, late authorized reply and continued checkpoint blocking until explicit response/disposition.
- [x] 2.7 Apply the same finite response contract to lead requests within existing management capacity/diagnostic accounting; verify revocation and stop block recovery and repeated lead scans cannot generate a wakeup chain.
- [x] 2.8 Update messaging/recovery/lead runbooks with original-request inspection and authorized clearing actions; run the isolated omitted-response native journey and retain exact instruction counts, one reminder, response/escalation and cleanup evidence.

## 3. P0.3 — Measured reconciliation performance

- [x] 3.1 Turn the planning probe into a reproducible deterministic benchmark for 1/10/25/100/200 messages and all seven specified distributions; verify repeatable counts and retain pre-change source revision, warmup/sample policy, raw results and a fixture-versus-native limitation statement.
- [x] 3.2 Instrument the appropriate existing test seams for actual session/inbox/context/exact/history API calls, storage I/O, reconciliation mean/max, memory, coordination-lock occupancy and scheduler delay; verify counters against known native requests and explicitly mark unavailable measurements.
- [x] 3.3 Introduce a one-pass active-candidate/prompt-ID index only where baseline evidence justifies it; verify answered/ack-resolved history needs zero ordinary transport inspection while answer-required acknowledgements, uncertain/pending/no-response queued transport and cancellation obligations remain active.
- [x] 3.4 Reuse session/inbox/context observations within a tick and refresh after mutation/ownership change; verify exact-history fallback and independent native assignment-state observation still prevent false idle/capacity release and stale authorization.
- [x] 3.5 Repeat equivalent before/after workloads and restart/cancellation tests; verify fixed active work adds no native I/O with growing resolved history, no new quadratic classification, and document actual timing/storage/lock/scheduler results without presenting mock latency as native performance.

## 4. P0.4 — Isolated operational verification and P0 gate

- [x] 4.1 Reuse or narrowly extract native harness installation/provider/forge/teardown seams for an opt-in bounded multi-cycle command; verify seed/cycle/concurrency/deadline/fault options and default CI exclusion without adding production services or dependencies.
- [ ] 4.2 Implement repeated intake/scheduling/parallel execution/forwarding/question/reply/Review/failure-retry/report/completion/cleanup cycles; verify output correctness, fair global/repository admission, unique ownership and no unexpected residual child resource.
- [ ] 4.3 Add message-heavy/failure-heavy/idle workloads, omitted replies and duplicate/reordered/lost native events; verify stable identities, bounded recovery/turn counts, durable waits and measured idle CPU/RSS rather than liveness alone.
- [ ] 4.4 Inject isolated restarts before admission, after uncertainty, during worker execution/response, lead notification, report publication and delivery/cleanup; verify no duplicate instruction/artifact/notification effect, preserved accepted outcomes and retained failed-run evidence.
- [ ] 4.5 Emit versioned external JSON/bounded logs with the operational-verification metrics and cleanup inventory; verify missing token usage stays unknown, telemetry contains no raw prompts/secrets/provider bodies, and failing postconditions produce a failed run.
- [x] 4.6 Document and dry-run the isolated soak recipe plus a separate explicitly authorized real-provider recipe; verify normal CI needs no paid credentials and real-provider execution remains not run without separate operator authorization.
- [ ] 4.7 Publish the P0 evidence checkpoint after messaging, finite recovery, benchmark and multi-cycle fault/cleanup tests pass along with `pnpm check`, `pnpm test` and `pnpm test:e2e`; verify no P2 grant-enabled production/native behavior has been enabled before this checkpoint.

## 5. P1.1 — Native fleet and project-lead overview

- [ ] 5.1 Extend existing read-only projections with fleet/per-repository counts, explicit native-queued versus ready-capacity waiting and aggregate coverage; verify mutually exclusive task totals and preserved secondary blockers across filters, unknown observations and ticket pagination.
- [ ] 5.2 Derive completed-today from authoritative event/completion timestamps with an explicit host-local day boundary; verify midnight/time-zone boundary and older closed pages cannot change today's aggregate or fabricate recency.
- [ ] 5.3 Add compact Work-home summary and attention navigation for human/supervisor decisions, unanswered requests, failures/stalls/recovery, delivery approval and lead proposals; verify actionable navigation reaches records outside the visible ticket page.
- [ ] 5.4 Add lead list/detail projections with scope, state, session availability, requests/proposals, latest meaningful outcome and assigned work links; verify disabled/retired/unavailable leads display accurately without a worker composer or added model turn.
- [ ] 5.5 Update Work navigation guidance and native TUI journey; verify host theme/keymaps/focus, disconnect freshness, invalid-record isolation, read-only RPC behavior and current approval-form boundaries.

## 6. P1.2 — Communication and decision inspection

- [ ] 6.1 Reuse the existing paginated message query in lazy native issue-detail communication views; verify sender/recipient/kind/time/status/request/reply/evidence display, expandable bounded bodies and full-history navigation without recurring hot-path history scans.
- [ ] 6.2 Present original response requirement, reminder zero/one-of-one, exact admission status, last verified native observation and escalation action; verify admission is never labeled read/acknowledged and an admitted unanswered reminder never appears resolved.
- [ ] 6.3 Link the actual existing worker Decision with issue/role/owner/progress impact and authorized next action; verify no duplicated question record and that human questions still use Abra/native forms.
- [ ] 6.4 Add or complete native navigation to worker inspection, research/generated HTML/PR evidence and Abra; verify retired/missing artifacts state availability and observer reads never prompt, answer, approve or advance work.
- [ ] 6.5 Update communication/recovery UX documentation and focused native assertions; verify bounded pagination, stale/offline observations and actions preserve current authenticated controller routes.

## 7. P1.3 — Quiet outcome-focused supervision

- [ ] 7.1 Add pure silent/digest/immediate event classification near existing Attention ownership; verify routine polls/progress/unchanged CI/known blockers cause zero new model turns and decisions/failures/unsafe ownership remain immediately visible.
- [ ] 7.2 Coalesce related outcomes into a bounded digest using retained existing incident IDs and one anchor prompt/membership reservation; verify three routine completions can share one supervisor prompt without inventing a notification store or free diagnostic budget.
- [ ] 7.3 Reconcile digest partial commits, admission receipt loss, late incidents and source dispositions; verify restart cannot duplicate a digest or mark an unhandled question resolved and new outcomes remain deliverable.
- [ ] 7.4 Verify manual, attended automatic and unattended behavior with actual prompt/turn counts, source budgets, exhausted capacity and return-to-attended transitions; retain human decisions without replaying historical routine events or widening authority.
- [ ] 7.5 Update supervision/posture runbooks and run the native low-noise scenario; verify important outcomes survive coalescing and each escalation identifies its original request and clearing action.

## 8. P1.4 — Accurate onboarding and configuration

- [ ] 8.1 Update README's conversational examples for one supervisor, parallel intake, fair automatic scheduling/postures, messages/findings, leads, per-task models, native isolation/OpenSpec, reporter and human gates; verify every advertised behavior is implemented and backed by a mapped recipe.
- [ ] 8.2 Document the minimal first-use sequence from native authentication/models through registration/readiness/posture/intake/Work/decisions/reports/delivery; verify optional lead/browser/provider/report setup is not presented as mandatory for ordinary work.
- [ ] 8.3 Document model profile/project/task precedence, captured active selections, scheduling, diagnostic defaults and project-lead/approval configuration; validate examples against the generated schema and current commands, without adding the illustrative YAML from the request blindly.
- [ ] 8.4 Add concise troubleshooting links for missing reply, interruption, admission uncertainty, unavailable lead/model, scheduler waits, human approval, report build and retirement; verify each points to the authoritative runbook and preserves uncertain identities.

## 9. P2.1 — Bounded delegated task authority (requires P0 gate)

- [ ] 9.1 Add versioned controller-owned grants and immutable grant/lead-registration binding on existing SQLite batches, with indexed derived total usage; verify fresh/upgrade migration, legacy no-grant behavior, unsupported-version rejection and no second task/usage database.
- [ ] 9.2 Add Abra-only grant issue/revoke/status control with repository/task-kind/workflow limits, finite total/active budgets, required expiry, scheduling permission and preserved human requirements; verify lead self-grant/escalation, stale revision and malformed/expired/disabled authority fail closed.
- [ ] 9.3 Extend existing WorkIntake/batch transaction for delegated research/minor-correction admission and scoped dependencies; verify allowed tasks, unauthorized repository/kind/workflow/dependency refusal and all-or-nothing task/provenance/budget commits.
- [ ] 9.4 Add real SQLite concurrency and crash-window tests for competing last-budget batches and commit-before-lead-receipt; verify one mapping/debit, conflicting identity refusal and historical receipt inspection after revocation without renewed admission authority.
- [ ] 9.5 Enforce granted active-task limits at atomic SQLite claims and route scheduling through the central controller/scheduler; verify queued versus claimed/paused/approval-waiting semantics, concurrent claims, global/repository/role capacity, auto-scheduling policy and fairness to unrelated work.
- [ ] 9.6 Prove delegated creation grants no plan/merge/delivery/cleanup/settings/credentials or unmanaged-session authority; verify native role/tool refusals, independent Review and unchanged human forms on admitted lead-created tasks.
- [ ] 9.7 Add grant status/usage/provenance to existing native lead/task views and document controller-based delegation examples/defaults; verify generated configuration stays compatible and no-grant installations remain proposal-only.

## 10. P2.2 — Management revocation lifecycle and recovery

- [ ] 10.1 Implement and document revoke-first cross-store ordering for disable/scope/model/session revision under existing coordination; verify crashes between SQLite revocation, plugin registration save and native stop cannot revive stale lead authority.
- [ ] 10.2 Test revocation/expiry while idle, reasoning, proposal pending, batch committed, message queued, task running and approval waiting; verify future mutations/automatic grant claims stop while admitted tasks, human decisions and historical provenance remain intact.
- [ ] 10.3 Extend lead fault journeys for lost registration/create responses, interruption, unavailable model, accepted reply before notice, notification/service restart, scope-history revisions and parent Abra restart; verify stable identities and no repeated work or lost accepted reply.
- [ ] 10.4 Verify management capacity/diagnostic accounting includes lead turns and reminders with several active leads; prove no mutual wakeup loop, recursive lead registration, budget reset or stale principal masquerading as Abra.
- [ ] 10.5 Run the isolated delegated-lead native scenario and update lifecycle/recovery recipes; retain correct grant enforcement, original task ownership, approval survival and cleanup evidence across restart.

## 11. P2.3 — Evidence-led simplification and maintenance

- [ ] 11.1 Complete the stateful-module ownership ledger for Leads, Messages, Attention, Runtime, Advancement and VisualReports; verify every persisted transition/native effect has a named lock, caller validation, retry rule and crash outcome, then remove only demonstrated duplicate ownership/logic.
- [ ] 11.2 Audit lock ordering and external calls using targeted message/lead races, stale snapshots and a long report build alongside scheduling; verify no native/build wait holds global coordination, no deadlock and no stranded unbounded reservation.
- [ ] 11.3 Measure pressure on messages, incidents, lead requests/proposals/retired sessions, session references, reports, scheduler and diagnostic retention; verify unresolved records are never evicted, caps fail visibly, and any necessary resolved-history pagination preserves replay/receipt identities with measured storage cost.
- [ ] 11.4 Extract only genuinely shared pure transition/correlation/grant/classification/history helpers and remove redundant native reads; verify changed paths through behavior tests and record why responsibility/failure handling improved rather than relying on LOC.
- [ ] 11.5 Publish before/after production LOC, files, persistent fields/relations, native reads, processes, dependencies and modified-path coverage with remaining concerns; verify counts use a stated consistent method and update affected architecture/runbook documents.

## 12. P2.4 — Production-readiness and Firstmate evaluation

- [ ] 12.1 Write a reproducible protocol for all six parallel/research/missing-reply/interruption/delegation/report scenarios against pinned AbraCode/Firstmate revisions; verify equivalent goals, model/workflow/approval differences, repetition policy and intentional non-goals are explicit.
- [ ] 12.2 Exercise the complete backend-maintenance scenario over repeated isolated cycles with grant-scoped intake, parallel findings, deliberate missing response/recovery/escalation, retained human gate, restart and portable Vite/Solid report; verify actual outputs, intervention/turn/latency/resource metrics and no leftover worktree/process/prompt/build.
- [ ] 12.3 Record deterministic results and real-provider/Firstmate results only when separately authorized/configured and actually run; verify unrun or incomparable scenarios are labeled, no invented token/cost numbers appear and a single success is not called parity.
- [ ] 12.4 Deliver the readiness assessment covering implemented/deferred P0–P2 items, architecture, reproduced failures, performance, operational/UX results, complexity, relevant Firstmate gaps and verified limitations; verify every claimed result links to fresh evidence or is explicitly historical/unmeasured.

## 13. Integrated acceptance and independent review

- [ ] 13.1 Obtain independent implementation review of authority/identity/duplicate work/locks/crash windows/recovery budgets/token efficiency/cleanup/UI accuracy/unnecessary code through the assigned Review workflow; verify material findings are resolved with focused regression evidence before completion.
- [ ] 13.2 Run `pnpm format:check`, `pnpm config:schema`, `pnpm licenses:check`, `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, `pnpm report:validate` and `pnpm report:build`, selecting documented compatible Chromium; verify actual exits, inspect generated-schema drift and report failures/unavailable checks without automatic tool installation.
- [ ] 13.3 Run `openspec validate harden-operational-maturity --strict` and verify each spec scenario maps to exercised acceptance or an explicit authorized optional limitation, all task receipts match current content, and the final implementation handoff distinguishes new evidence from repository-recorded history.
