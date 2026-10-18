# Tasks

Implementation order: 1 (M0) → 2–3 (M1) → 4–5 (M2) → 6 (M3) → 7 (M4) → 8 (M5). Groups 9–10 (M6) are independent of groups 4–8 after report/record ownership is established; group 11 integrates all milestones. Keep all tasks unchecked until their stated evidence exists. No implementation/native checks were run in the propose workflow.

## 1. M0 — Prove and repair native steering authorization

- [x] 1.1 Reconcile the existing `complete-work-reliably` obligations/attention/finishing changes with this design without resetting unrelated edits; verify a recorded baseline identifies current implemented behavior, conflicting contracts and the focused native regression entry point.
- [x] 1.2 Inspect the pinned 2.0.28 host prompt/inbox implementation and installed declarations for hook timing, duplicate IDs, queue/steer consumption and cancellation; verify `docs/supported-apis.md` records exact source/version and distinguishes observed guarantees from pending native assertions.
- [x] 1.3 Add a disposable real-server held-worker scenario calling actual `abra_work_control steer`; verify the pre-fix result records the real refusal/success, initial assignment ID, target session and provider-visible marker count rather than assuming the suspected guard defect.
- [x] 1.4 Add the minimal schema-owned retained steering intent, exact rendered payload and stable native ID before submission; preserve assignment capture and legacy reads; verify unit persistence/rebinding tests and interruption after intent-write recover the same identity.
- [x] 1.5 Route legacy steering through one prompt-intent authorization lookup, deriving omitted retry identity from trusted native tool-call context; verify valid assignment/steer pass while direct foreground/queue/steer, forged metadata, changed text/attachments and wrong session/generation fail before provider work.
- [x] 1.6 Integrate steering admission uncertainty, queued cancellation and completion/capacity ownership with current sessions; verify lost-response replay produces one instruction, pause/supersession cannot activate stale work, and session/worktree/model/role permissions remain unchanged on the real server.
- [x] 1.7 Document the verified steering behavior and recovery limits in supported APIs/operations and the verification feature map; review the diff for authorization bypasses, duplicate intent stores and callback lock races; verify `pnpm check`, `pnpm test`, `pnpm test:e2e` pass with retained native evidence before beginning group 2.

## 2. M1 — Add correlated messaging and explicit worker replies

- [x] 2.1 Extend the M0 intent contract into the shared bounded request/reply schema in `workflow/message-contracts.ts`, reusing existing records instead of a second steering ledger; verify schema tests cover required/optional response, malformed evidence, payload limits, immutable IDs and legacy records.
- [x] 2.2 Implement the cohesive message coordinator for trusted sender resolution, active recipient role/session/location, request/correlation binding and persist-before-native admission; verify controller tests reject missing, historical, paused, completed, wrong-location and conflicting recipient selections without creating sessions.
- [x] 2.3 Register strict `abra_work_message` input/output and controller dispatch using native queue/steer; verify unit/runtime tests and native tool structured-output equality show an existing worker receives the requested message with its retained ID and no additional session.
- [x] 2.4 Implement worker-only acknowledge/answer actions on `abra_worker_reply`, with current sender/generation validation and fresh coordinated reply writes; verify acknowledgement is distinct from answer/admission, identical reply retries are harmless and conflicting/wrong-sender/stale replies are rejected.
- [x] 2.5 Add keyed worker finding submission and Abra-mediated forwarding with source evidence references; verify a real Research finding reaches current Apply, Apply acknowledges it, and hostile approval/scope claims do not change scope, tool policy or human checkpoints.
- [x] 2.6 Link existing worker questions and decision-answer delivery to message intents without parallel obligations; verify question/progress/wait regression tests retain one decision identity and required message replies stay unresolved when a worker merely completes its turn.
- [x] 2.7 Add bounded `abra_work_messages` pages and outstanding totals through Queries/tool schemas, using current role/diagnostic guards; verify inspection returns correlated replies, rejects worker management calls and performs no prompt, form or lifecycle mutation.
- [x] 2.8 Document queue/steer/reply/forwarding examples and permission boundaries in operations/recovery; review the shared coordinator for duplicated validation, authority broadening and giant-file growth; verify focused tests plus `pnpm check`, `pnpm test`, `pnpm test:e2e` pass for this feature slice.

## 3. M1 — Complete communication recovery and checkpoint integration

- [x] 3.1 Reconcile uncertain native admission from retained prompt identity using inbox and context, preserving unavailable/ambiguous observations; verify fault-injection tests for response loss and failed success writes never mint a replacement ID or duplicate provider-visible instructions.
- [x] 3.2 Make additional idle-worker messages reserve existing capacity and busy-worker messages reuse it; verify unit/integration tests cover global/repository/role limits, queued idle-looking sessions and uncertain reservations without exceeding worker capacity.
- [x] 3.3 Gate `WorkerSessions.observe` and lifecycle advancement on applicable queued work, actual quiescence and required response disposition; verify assignment completion cannot release capacity early or attribute a later message's outcome to the assignment, and unrelated tasks continue.
- [x] 3.4 Extend pause, cancellation and generation supersession to all owned queued prompts while preserving consumed-message history; verify cancel/consume races retain uncertainty, stopped confirmation precedes another writer and inactive generations cannot reply or receive new work.
- [x] 3.5 Add real-server restart/interruption cases for queued request, acknowledged/answered reply, failed worker and unresolved required response; verify retained session/worktree/IDs survive service restart and Abra retrieves the same answer/outstanding obligation.
- [x] 3.6 Route answer/blocker notices through existing durable attention and bounded read-only native detail; verify repeated observations coalesce, failed notice admission reuses identity and exhausted optional diagnostics do not erase mandatory questions.
- [x] 3.7 Update communication recovery recipes and retained native evidence; review crash windows, cancellation and concurrent reply commits; verify `pnpm check`, `pnpm test`, `pnpm test:e2e` and the M1 exit scenario pass before scheduling/lead features depend on the protocol.

## 4. M2 — Add atomic batch work intake

- [x] 4.1 Extend WorkInput-based batch schemas with explicit batch request ID, 1–32 keyed tasks and tagged local/existing dependencies; verify strict tests reject duplicates, invalid bounds/references and policy/scope violations without weakening single-item intake.
- [x] 4.2 Add the transactional SQLite batch receipt migration and stable per-item request identities; verify current schema-4 and supported historical (including schema-3) fixtures upgrade without changing old request identity, a future version is rejected, and migration failure rolls back.
- [x] 4.3 Implement complete-graph validation and synchronous transactional issue/dependency/event insertion in WorkGraph; verify forward references succeed while cycles, self-dependencies, missing issues and injected mid-transaction errors leave zero partial batch records.
- [x] 4.4 Implement WorkIntake policy/registration validation and `abra_work_create_batch` registration, signalling existing reconciliation after commit; verify the native tool returns local-key mappings, structured-output equivalence and no dispatch/approval authority from intake alone.
- [x] 4.5 Add retry/restart and concurrent-caller tests; verify identical reordered input returns the same issues, changed membership/goal/dependency rejects rebinding, and single-item requests cannot adopt conflicting batch-owned identities.
- [x] 4.6 Update orchestration guidance with practical workflow recommendations and a three-task example using existing descriptions/scopes; review normalization/SQL ownership and verify documented input plus `pnpm check`, `pnpm test`, `pnpm test:e2e` succeed.

## 5. M2 — Extend fair automatic admission and task diagnostics

- [x] 5.1 Extend the existing scheduler with highest-priority selection and persisted equal-priority repository rotation; verify deterministic scheduler tests demonstrate fairness across continuously eligible repositories without altering dependency/claim authority.
- [x] 5.2 Preserve catch-and-continue admission and fresh readiness/reservation checks across scheduler restart and concurrent starts; verify failed tasks do not block independent work, uncertain claims retain ownership and paused work does not restart automatically.
- [x] 5.3 Extend readiness and native summaries with accurate dependency, active/retained/role capacity and missing-authority reasons; verify unit/read-model tests distinguish each blocker and display native queued work as queued rather than idle.
- [x] 5.4 Add a real-server batch journey with three tasks and worker capacity two, plus a dependent task and restart; verify two tasks start, the third starts on slot release, dependency closure gates its task and no session/worktree/claim is duplicated.
- [x] 5.5 Document auto-scheduling/fairness/upgrade defaults and the exact acceptance journey; review cursor crash behavior and reservation reuse, then verify `pnpm check`, `pnpm test`, `pnpm test:e2e` pass with retained M2 evidence.

## 6. M3 — Compose bounded autonomous supervision

- [x] 6.1 Add optional supervision posture normalization and effective-settings presentation using existing scheduling/budget settings; verify omitted mode preserves legacy behavior, explicit conflicts fail and manual/attended/unattended never grant repair budget, scope, pause-resume or approval authority.
- [x] 6.2 Extend event coalescing and periodic reconciliation for message/native outcomes without a new watcher; verify event-burst, dropped-stream and restart tests preserve obligations and progress without model turns on routine unchanged observations.
- [x] 6.3 Extend AttentionService to route deduplicated meaningful blockers/results and retain explicit notification provenance; verify uncertain notice admission/restart reuses IDs, forms remain available with exhausted optional diagnostic budget and admitted notices do not count as handled decisions.
- [x] 6.4 Permit evidence-backed routine supervisor-owned decision resolution through the existing finite diagnostic path; verify human-owned approvals, out-of-scope questions, spent budgets and generic diagnostic steering remain refused while an authorized routine answer is retained once.
- [x] 6.5 Implement mutually exclusive primary supervision classifications and concise aggregate counts in existing status/read-model/RPC; verify every requested class, conflicting-blocker precedence, observation time, stale/unknown activity and independent delivery/cleanup/closure evidence.
- [x] 6.6 Add real-server attended/unattended interruption/provider/review/decision scenarios; verify meaningful blockers produce one actionable notice, paused work stays paused and unrelated/dependent tasks progress only as authorized across restart.
- [x] 6.7 Update configuration schema/example, operations and verification recipes with posture/notification behavior; review for a second state machine or authority inherited by automated turns; verify `pnpm config:schema`, `pnpm check`, `pnpm test`, `pnpm test:e2e` and inspect generated schema diffs.

## 7. M4 — Add captured task model selection and profiles

- [x] 7.1 Add narrow complete-model/profile selectors and role-bound declarative profiles to config and task input contracts, preserving batch request identity; verify strict schema/normalization tests reject unknown/mismatched profiles, incomplete models and same-level conflicts.
- [x] 7.2 Persist optional task dispatch data with a transactional graph migration and compatible original-request decoding; verify legacy tasks/batch retries retain identity and conflicting new selectors cannot rebind earlier work.
- [x] 7.3 Implement explicit task → task profile → repository selector/profile → role override → default resolution and provenance; verify table-driven tests cover each level, complete variant semantics and unchanged legacy resolution.
- [x] 7.4 Capture resolved per-role choices before provisioning and reuse them across phases/restart; verify config edits do not alter active snapshots and missing native models/variants produce specific blockers without fallback.
- [x] 7.5 Extend the real native inventory/retry fixture with task and profile selections; verify the actual assigned worker uses the captured model and role permissions remain unchanged after restart and explicit supported recovery.
- [x] 7.6 Update configuration schema/example, task tool examples and model provenance views; review for duplicate model routers or permission-bearing profiles; verify `pnpm config:schema`, `pnpm check`, `pnpm test`, `pnpm test:e2e` and inspect schema changes.

## 8. M5 — Add optional persistent scoped project leads

- [x] 8.1 Add a narrow management-principal/lead registration contract with exact repositories, retained session intent, parent Abra, revision, complete model and enabled state; verify schema/record tests distinguish leads from worker roles and reject conflicting/stale session ownership.
- [x] 8.2 Register a static hidden lead profile through existing generated native config assets and inventory preflight, not dynamic registry addition; verify a real-server lead session is created once under its retained ID with read-only native permissions.
- [x] 8.3 Resolve lead principals in tool authorization with endpoint/action allowlists and repository predicates on every query/mutation, including native read/glob/grep containment or omission; verify out-of-scope project/installation-state reads, control, code writes, raw session delegation, self-approval, delivery, cleanup, closure and recursive lead creation are rejected.
- [x] 8.4 Implement bounded task proposals and authorized supervisor-owned question/finding routes for leads; verify proposals reach Abra's intake path without self-admission and human approvals/forms always remain bound to Abra and their exact targets.
- [x] 8.5 Reuse the message coordinator for lead registration revisions, notices, acknowledgements and replies, preserving source authority across record boundaries; verify fault tests recover partial routing and do not duplicate source obligations or create another transport.
- [x] 8.6 Reuse existing attention capacity/finite budgets for one active turn per lead; implement disable/revision cancellation and stop reconciliation; verify queued/uncertain lead work retains capacity and disabled/stale leads cannot admit or answer new management work.
- [x] 8.7 Add native lead restart, scope, blocker/completion delivery and single-supervisor regression journeys; verify stable session/location identity, no unauthorized data access, no permissions escalation and unchanged human plan/merge gates.
- [x] 8.8 Document registration, model choice, disable/re-enable, recovery and same-user trust limits; review principal authorization and correlation for bypasses, then verify `pnpm check`, `pnpm test`, `pnpm test:e2e` and retained M5 evidence.

## 9. M6 — Extend manual report authoring and safe snapshot views

- [x] 9.1 Extract only report primitives exercised by architecture/research and verification/review examples, preserving manual `report.tsx`; verify existing type/build/browser tests and both examples work without additional UI dependencies.
- [x] 9.2 Add accessible section navigation, search/disclosures, code/diff and snapshot timeline/status views with existing Solid/CSS; verify keyboard traversal, filter/evidence behavior and no page-wide overflow at 375 pixels.
- [x] 9.3 Add bounded validated snapshot data, provenance/time labels, safe text/JSON embedding and URL validation; verify malformed/missing evidence stays unavailable and hostile markup, script delimiters, code/diffs and unsafe URLs remain inert in offline/sandbox browser tests.
- [x] 9.4 Preserve and exercise multiple build-time Mermaid diagram types and clear invalid-source failures; verify `pnpm report:check`, `pnpm report:validate`, `pnpm report:build`, no runtime Mermaid/CDN requests and retained applicable license notices.
- [x] 9.5 Add local feedback Markdown/JSON display/export with selectable-text fallback; verify network/storage-disabled sandbox tests produce usable review input without session/controller mutations or approval claims.
- [x] 9.6 Document manual/data-driven authoring, source trust, snapshot semantics and native/browser handoff in reporter README/testing; review components for unused abstraction and verify `pnpm check`, `pnpm test`, `pnpm test:e2e` preserve existing reporter behavior.

## 10. M6 — Isolate and retain concurrent controller-owned report builds

- [x] 10.1 Extend the existing Reports owner and optional artifact receipts with stable build request/revision, captured input and output digest/path; verify existing Markdown report acceptance/legacy reads remain unchanged and terminal research rendering does not reopen workflow execution.
- [x] 10.2 Add an explicit authorized report-generation action and keyed research-render request accepting validated snapshots and trusted templates only; verify existing report reads remain read-only, diagnostic read eligibility does not grant generation, and Research cannot edit central TSX, run arbitrary builds/import repository executable code or gain management/shell/write permissions.
- [x] 10.3 Parameterize trusted Vite/license/diagram inputs for isolated source, cache and output workspaces with finite build concurrency/deadlines; verify simultaneous builds produce independent outputs and never modify shared template files or caches.
- [x] 10.4 Implement staged validation, immutable revision publication and receipt reconciliation under existing report locks; verify injected invalid/interrupted builds, occupied revision conflicts and crashes before/after atomic publication preserve previous artifacts and recover the same digest without overwriting unrelated files.
- [x] 10.5 Add moved/offline/sandbox browser assertions for retained generated HTML, including assets/notices, interactions and feedback; verify the artifact survives worker retirement and inspect the actual pinned OpenCode HTML file-link preview, recording any client/environment limitation honestly.
- [x] 10.6 Document build/retry/retention/owned-scratch cleanup and native handoff recipes; review filesystem containment/symlink/atomicity and scope boundaries, then verify `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm report:validate`, `pnpm report:build` with retained M6 evidence.

## 11. Final integration acceptance

- [x] 11.1 Exercise the authentication/refactor, database-research and flaky-test scenario using the disposable native provider/forge, including profiles, two-slot dispatch, findings/acknowledgement, meaningful decisions, portable architecture report and service restart; verify stable tasks/sessions/worktrees, unresolved requests, approval ownership and independently evidenced delivery remain correct after fixture cleanup.
- [x] 11.2 Run `pnpm format:check`, `pnpm config:schema`, `pnpm licenses:check`, `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, `pnpm report:validate`, `pnpm report:build` and strict OpenSpec validation; verify actual exit/results, inspect generated schema changes and retain command logs with passed/failed/not-run distinctions rather than assumed successes.
- [x] 11.3 Review the integrated changes against all eight capability deltas and design ownership/complexity decisions; verify no duplicate transport/scheduler/state machine, alternate harness, Lavish dependency, unbounded supervisor tree, weakened checkpoint or unsafe cleanup remains, and publish an evidence-backed milestone/limitations record without claiming untested model judgment or real-provider performance.
