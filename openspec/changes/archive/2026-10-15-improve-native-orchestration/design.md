# Design

## Context

See `proposal.md` for the requested outcome. This plan builds on the inspected OpenCrew source at `4b00bfc` and the Firstmate comparison in this conversation; it does not add Firstmate executables or its state conventions.

The current controller is the authoritative lifecycle implementation, but its public dependency fields let setup, tools and visibility reach into the implementation. `reconcile()` holds the global controller lock across every execution and can run verification, fetches, delivery and cleanup before releasing it. The existing isolated probe at `.lavish/firstmate-comparison/reproduce-ci-wait.ts` demonstrates pending CI becoming `recovery_required` and remaining there after CI succeeds. The probe is supporting evidence, not a tracked runtime dependency.

`NativeStore` casts stored JSON, `json<T>` parses and casts CLI output, configuration is parsed into a partial interface, and tool JSON descriptions are separate from `any` handlers. WorkGraph's `IssueSchema` and the observer's `Schema.toStandardSchemaV1` demonstrate the preferred existing pattern. The native Effect client already decodes its published contracts; it should not acquire a redundant copy of OpenCode's schemas.

Only full-openspec currently executes. Provisioning unconditionally requires OpenSpec and verification, work creation hardcodes the full policy, guards enumerate three roles, and Plan assumes OpenSpec documents. These are coordinated changes, not a single policy flag. The project has no canonical specs yet; the seven added delta capabilities establish retained invariants as well as new behavior.

### Finding coverage and sequencing

| Finding or improvement                          | First implementation destination                     | Acceptance evidence                                                                                |
| ----------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| CI/review wait becomes recovery                 | Typed delivery observation and reconciliation result | `tests/unit/delivery-wait.test.ts`; clock-driven pending/approved restart                          |
| Global lock covers slow operations              | Workflow operation ownership                         | `tests/unit/coordination.test.ts`; `tests/integration/capacity.test.ts`                            |
| Runtime casts and phase-optional state          | Contract schemas and record migrations               | `tests/unit/contracts.test.ts`, `records.test.ts`; SQLite upgrade fixtures                         |
| Large controller and setup reach-through        | Workflow facade and focused internal modules         | `tests/unit/lifecycle.test.ts`, `coordination.test.ts`; facade/query seams                         |
| Custom subprocess plumbing and blanket deadline | Scoped Effect process adapter                        | `tests/integration/process.test.ts`; native pause/resume E2E                                       |
| Capacity counts every incomplete execution      | Independent active and retained reservations         | `tests/unit/capacity.test.ts`; independent-process global/repo/role ceilings                       |
| Busy is sufficient liveness                     | Native progress observations and declared waits      | `tests/unit/attention.test.ts`, `obligations.test.ts`; owned check deadlines                       |
| Notices do not initiate judgment                | Durable attention admission and disposition          | `tests/unit/attention.test.ts`; native incident/disposition/restart fixture                        |
| General questions are ephemeral                 | Keyed decisions and native user forms                | `tests/unit/obligations.test.ts`; native forms and read-only projection                            |
| Full-spec-only execution                        | Three fixed policy paths                             | `tests/unit/policies.test.ts`, `combined-restart.test.ts`; native no-OpenSpec/report/handoff paths |
| Narrow delivery and generic PR content          | Delivery observation/preservation and summaries      | `tests/unit/forge-readiness.test.ts`, `forge-findings.test.ts`, `preservation.test.ts`             |
| Ignored output strands cleanup                  | Explicit retained cleanup policy                     | `tests/unit/retirement.test.ts`; replacement/lost-removal postconditions                           |

The delivered foundation fixes and their regression coverage precede the additional policy and repair paths; `tests/unit/corrections.test.ts`, `combined-restart.test.ts` and `tests/e2e/native.test.ts` cover finite repair, immutable archives, fresh authorization and restart relationships. `tests/tui/sidebar.ts` covers native report/decision/wait/attention/round views and offline/narrow navigation. Configuration, API evidence, architecture, operations, recovery and testing docs describe the delivered contracts. Additive record fields needed by later capabilities can be defined early, but unavailable behavior must remain explicitly rejected until its vertical slice is complete.

## Goals / Non-Goals

**Goals:**

- Give each consequential external operation a small typed interface with retained identity, a verifiable result and recoverable ownership.
- Let independent tickets make progress concurrently without weakening claims, authorization or single-writer execution.
- Use Effect Schema where data enters from outside a trusted typed call graph, and keep pure transformations simple.
- Translate Firstmate's operational lessons into the pinned native runtime and the existing three state authorities.
- Make every accepted policy executable, inspectable and restart-safe before exposing it as available.

**Non-Goals:**

- No alternate backlog/session/worktree owner, distributed scheduler, multiple harnesses, terminal probing, social relay, quota toolchain or generic workflow plugin framework.
- No automatic change to project merge authority, model quality, existing execution policy, no-check merging or disposable-path authorization.
- No replacement of Node SQLite solely for framework uniformity, and no rewrite of pure domain logic or Solid rendering into effects.
- No OS sandbox claim. Retain the documented trusted personal automation model and existing native role enforcement.

## Decisions

### 1. Keep a small workflow interface and deepen its implementation

Keep `Controller` as a compatibility facade while extracting cohesive workflow internals for execution operations, phase advancement, authorization and queries. The facade exposes commands and read-only query methods; it does not publish its adapters. Do not introduce a service/interface per helper.

Keep the real seams already exercised through fakes: WorkGraph, Records, Runtime, Runner and Delivery. Provide the live implementations once through `applicationLayer` and the host scope. Setup receives the shared workspace, record, coordination, approval and delivery operations it actually needs instead of an entire controller. Observer projection reads typed queries/records without mutation access. Worker guards query typed assignment identity instead of enumerating public controller dependencies.

Alternative considered: split the existing class mechanically across many small forwarding classes. Rejected because it preserves caller knowledge and spreads invariants. The extraction must reduce reach-through and keep lifecycle tests exercising the same external commands.

### 2. Make consumed schemas the source of internal and wire types

Define schemas near the module that owns their meaning. Put shared identifiers, model references, policy snapshots, receipts and execution shapes in a small domain-contract module; OpenSpec wire schemas live with its adapter, forge schemas with Delivery, and configuration schemas with config loading. Infer TypeScript types from schemas. Use the pinned `Schema.decodeUnknownEffect` and JSON decoding facilities; a replacement for `json<T>` accepts a schema and returns its decoded type, never a caller-selected cast.

Consume the minimum upstream fields needed for correctness. Accept unrelated additive CLI/API fields, but validate IDs, non-empty SHAs/refs, finite counts, enum values, prerequisites and receipt relationships. Normalize documented null/absent fields once at the adapter. Preserve raw command output when whitespace is meaningful. Build tool inputs from the same schema contract and convert to the host's supported schema representation; the installed observer already uses `Schema.toStandardSchemaV1`.

Apply the audit to configuration YAML, onboarding package manifests, managed-clone manifests, setup YAML/CLI responses, OpenSpec status/instructions/validation/archive, GitHub responses, plugin-owned record reads and custom RPC/tool inputs. Do not duplicate validation around already decoded `@opencode/client/effect` results; use upstream schemas for native values and encode them at custom wire seams. Keep JSON-safe output normalization for native RPC.

Map schema failures to bounded structured diagnostics containing source, command/record key, field path and operation identity. Do not log entire command environments, auth headers or unbounded payloads. Replace repeated result-unwrapping scaffolding and broad error assertions with direct Effect composition and named domain operations where this improves readability; programming defects remain defects.

Alternative considered: tighten TypeScript interfaces while retaining generic casts. Rejected because persisted and external data are unknown at runtime.

### 3. Version evidence without manufacturing recovery facts

Use a versioned envelope for plugin-owned Project, Setup and Execution data. An execution has a stable identity, monotonically advancing control generation, a record revision, immutable effective-policy snapshot, and a discriminated policy/phase payload. Phase constructors require their actual prerequisites; do not represent every possible phase with one bag of optional fields. An orthogonal typed wait preserves the current phase while describing its condition, owner, observation and next check.

Embed the currently authoritative operation intent, unresolved decisions, attention delivery state and current round identity in the execution envelope. This avoids requiring an atomic transaction across independent native storage keys. Historical evidence can use immutable keyed records, referenced only after validation. Keep SQLite issue/claim state and plugin execution state separate and reconcile them through durable intents as today; native storage has no public compare-and-swap or multi-key transaction.

Recognize existing unversioned records as legacy input, validate them and normalize to version 1 under the short coordination lock. Retain an original copy before an on-disk migration write. Preserve all known IDs, policy flags, fingerprints, pending forms and delivery evidence. Migrate completed history as well as active work. Missing old evidence is never inferred from a phase name; retain a diagnostic requiring recovery. Keep per-record scan outcomes so one unreadable record does not hide all valid work or historical reports. Unknown future versions remain read-only and visible. Do not silently remove unknown evidence when rewriting known fields.

New execution records snapshot command/verification configuration, delivery method/check policy, cleanup paths, scope approvals, and supervisory/repair budgets. Later configuration edits cannot broaden an active execution's authority; changes require an explicit retained revision with receipt invalidation where relevant.

Alternative considered: move all execution state into SQLite. Rejected for this change because it introduces another migration and discards useful native plugin ownership without solving external-side-effect atomicity.

### 4. Use durable operation intents and two lock scopes

Preserve kernel-backed scheduler leadership and cross-process coordination. Use a short coordination lock for claims, slot reservations, control-generation changes and native record commits. Use an execution-specific lock for one owned slow operation. Never wait for an execution lock, network call, subprocess, worker stop or filesystem disposal while holding the coordination lock.

Operation protocol:

1. Acquire the execution lock outside global coordination. Read/recheck ownership and phase under the short coordination lock; persist an operation ID, control generation, input fingerprint, planned action, any native IDs, reservation and expected postcondition in the execution record.
2. Release coordination and execute the adapter operation in a child scope while retaining execution ownership. Different executions run with bounded concurrency. In-memory queues coalesce triggers; the record is the restart authority.
3. Reacquire coordination briefly, re-read the execution and compare operation ID, control generation, relevant policy/scope and content evidence. Persist the classified result only if still current. Merge independent observation fields rather than overwriting them from an old object.
4. Release the operation scope and execution lock after completion/confirmed termination. Where external submission outlives the local scope, retain its native identity and uncertain intent for postcondition reconciliation.

Control generation changes only when control intent, scope or lifecycle ownership changes; routine progress observations do not invalidate otherwise valid work. Pause first persists a stop request/generation change under coordination, then signals the owned scope or native session outside that lock. The public result distinguishes stop requested from stop confirmed. A replacement writer is blocked until termination is confirmed.

On restart, no elapsed lease alone proves that a same-user external process stopped. Inspect native session activity, process/lock ownership and operation-specific evidence. Reuse persisted native session/prompt IDs, rediscover exact pushed refs/PRs, and inspect active/archive paths before repeating mutations. Checks can rerun only after writer quiescence and matching input evidence; uncertain destructive actions require postcondition inspection, not generic retry.

Alternative considered: run `Effect.all` inside the existing global lock or replace flock with a Semaphore. Rejected: neither makes unrelated commands responsive across processes.

### 5. Represent waiting as a result and schedule observations

Use a small tagged operation-result union: completed, waiting, retryable external failure, verification failure and recovery required. Keep `CrewError` compatibility for public failures while internally carrying typed categories and operation context. A waiting result includes reason, owner/dependency, observed evidence, next-check timestamp and attempt count; it does not mark the issue blocked or discard valid authorization.

Pending CI, pending required review, forms and capacity are deterministic waits. A completed failed check is verification feedback. Head/target drift, uncertain ownership and malformed safety evidence are recovery conditions. Transport errors use bounded backoff and remain visible; exhausted observation retries create attention without claiming the work itself failed. A manual pause suppresses automatic continuation.

Retain the current 30-second fallback as the recovery backstop, using schedules/backoff for due work. Add source events as accelerators, not completion proof. Periodic observations do not create model turns. Tests use controlled clocks and fake forge transitions, including the demonstrated pending-CI-to-green case.

### 6. Separate active worker and retained execution budgets

Keep `max_workers` as the active native-turn limit globally and per repository, plus existing Explore/Review limits and a research role limit. Add `max_executions` globally/per repository for retained incomplete resources. Include pending admission/uncertain active reservations until native state proves release. Reserve transitions under the coordination lock; do not count only the current list of running fibers.

A worker becoming verifiably idle releases compute capacity; issue claim and retained-resource capacity remain. A pending approval or stopped execution has no active model slot. Every phase launch checks global, repository and applicable role budgets. Capacity waits preserve the intended next phase instead of becoming failed executions.

For configurations without `max_executions`, use the corresponding old `max_workers` value as the effective retained cap. This preserves the previous maximum number of retained worktrees until explicitly changed, while making the new semantics clear in doctor/readiness/configuration output. Operators can then raise retained capacity independently. Existing active executions adopt conservative reservations during migration.

### 7. Replace custom process plumbing through the existing Runner seam

Implement Runner with the installed `effect/process/ChildProcess`, ChildProcessSpawner and Node platform layer. The installed 4.0.1 Node source supports scoped process groups and configurable escalation; use explicit options and retain tests as the authority for the needed behavior. Configure TERM-to-KILL grace rather than accepting defaults that never escalate. Preserve argument-array invocation, inherited/overridden environment semantics, independent output budgets, trim/raw output, exit status, redacted error context and termination-before-ownership-release.

Extend the command contract with deadline and bounded progress/output options. Keep 120 seconds for ordinary commands unless configured; give repository verification its own explicit deadline (initial default 15 minutes, configurable per check). Continue accepting existing argument-array verification entries and normalize them to the structured command form. Streaming retains only bounded diagnostic tails and periodic progress metadata; receipt success still requires the final exit and matching content fingerprint.

Prefer Effect FileSystem/Path for thin filesystem access where it removes custom code. Preserve native overload behavior where useful and narrowly protect non-cancellable mutation completion; do not blanket-mask long reads or the whole lifecycle. Keep scoped SQLite acquisition and synchronous SQL-only transactions. Instrument named workflow operations with issue, execution, generation, role and operation IDs using existing Effect tracing.

Alternative considered: rewrite OS locks and SQLite to eliminate all Node/CLI calls. Rejected because those implementations already own necessary platform behavior.

### 8. Persist decisions, declared waits and actionable attention

Add worker tools for a keyed question and a structured progress/wait report, and Supervisor tools to inspect/answer/dispose decisions. Validate caller assignment, active generation and answer owner in the controller. Use native forms for user-owned answers and the existing exact-fingerprint forms for plan/merge authorization. A general answer never substitutes for an approval receipt. Stable keys make repeated worker submissions idempotent; preserve answer and delivery history.

A declared wait records kind, owner/dependency, condition, start, last observation, bounded expiry and clearing action. System-known forms/checks use the same read model. Progress records last meaningful native text/tool/operation advancement, separate from busy/last-polled timestamps. Consume verified pinned native progress events already used by visibility, explicit worker progress and owned command progress. Ordinary polling and repeated identical busy state cannot reset progress. Check thresholds by role/operation class; an owned command within its deadline or an unexpired declared wait accounts for silence. A stall is an inspection incident, not permission to kill or replace an agent.

Persist an attention record keyed by execution, incident kind and incident generation before submitting anything. Store the Supervisor session, stable prompt ID, delivery state, handling disposition and finite budget. Admit via native queued prompt; on uncertain admission reuse that ID. Recover after a missing Supervisor location without creating another Supervisor or losing the obligation. An admitted prompt remains unresolved until an authorized tool action or explicit user-needed/handled disposition is recorded. Do not repeatedly admit new prompts merely because the first turn has not handled it.

Enable diagnostic judgment turns by a documented per-execution supervision policy, initially one turn per incident; automatic code-repair rounds default to zero. A paused execution receives no restart/repair action. Active Supervisor turns consume an explicit bounded attention concurrency budget and never create competing primary sessions. The Supervisor uses structured allowed commands for diagnosis, decision resolution and in-scope retry; it cannot change merge/plan authority, delete resources or switch to an unconfigured model. Over-budget, provider-error and undeliverable attention remains visible to the user. Synthetic informational notices stay separate and never feed the attention loop.

Alternative considered: copy a shell watcher or keep all attention in Queue/PubSub. Rejected because native events already provide activity and memory-only delivery loses obligations on restart.

### 9. Implement three explicit policy paths

Extend work intake, SQL creation/request normalization, configuration, worker assignment, prompts, guards, readiness and visibility together. Validate effective policy before hashing request identity and snapshot it when claiming. Use a small exhaustive policy dispatch inside the workflow, not a dynamically registered engine. Unsupported partial paths stay rejected until their implementation and tests are complete.

| Policy          | Planning authority                                 | Worker path                        | Completion evidence                                                     |
| --------------- | -------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| full-openspec   | Existing repository-local OpenSpec artifacts/tasks | Explore, Apply, independent Review | Existing validation, checks, review, archive, delivery and retirement   |
| research-only   | Recorded question/scope/acceptance contract        | Read-only Research                 | Valid retained report, successful native outcome, native retirement     |
| lightweight-fix | Short versioned scope contract                     | Apply, independent Review          | Scope approval when configured, checks, review, delivery and retirement |

For research and lightweight, capture goal/question, acceptance criteria and constraints in the issue request and a plugin-owned scope record. Incomplete contracts become durable clarification decisions before worker launch. Apply the registered plan-approval policy to the scope fingerprint; both policies therefore honor existing human authority without fabricating an OpenSpec package. No OpenSpec setup is required for these policies; lightweight still requires verification. Full-spec keeps its current setup prerequisites. Source branching/worktree identity stays native and starts from the recorded fetched base.

Research adds a read-only role with no edit, patch, shell, delivery or management tools. The worker submits a structured report through an assigned report tool; the controller owns persistence. The payload includes conclusions, evidence references with base/path/line or URL identity, limitations and acceptance results. Retain it under `.opencrew/reports/<issue>/<report-id>.md` with a versioned receipt containing its hash and identities. Write a bounded private temporary file, flush and atomically publish, verify content, then commit the reference. Restart reconciles publication intent/hash before completion. An absent/tampered report prevents closure; native success alone is insufficient. Retain the report outside the disposable worktree and read it through a bounded observer method.

Research retirement verifies the untouched worktree at the research base and retained report rather than a nonexistent code-delivery commit. Do not push a scratch branch or create a PR. A completed report remains immutable. User-authorized handoff creates a new implementation issue with a new request ID, report reference and dependency on the research issue; it never changes the original issue policy or auto-launches a recommendation.

Lightweight scope lives in native records, not a new canonical task tracker or hidden repository planning directory. Replan creates a scope revision and invalidates the affected approval/verification receipts. Full-spec continues to use OpenSpec exclusively for its implementation task authority.

### 10. Strengthen GitHub observation and preservation evidence

Retain the existing machine-readable gh adapter, adding schema-decoded observations for PR identity, draft/mergeability/review state, head-bound checks, effective required contexts and actionable review feedback. Decode nonzero command results where the CLI documents a semantic result: `gh pr checks` exit 8 means pending, not a generic process failure. Provide explicit allowed semantic exit codes through the adapter contract; ordinary nonzero exits remain failures.

Add project `ci_policy` values `all-reported` (compatibility default) and `required`, plus `allow_no_checks:false`. Determine required contexts using authoritative applicable branch protection/ruleset evidence including application identity; `gh pr checks --required` alone only classifies checks that reported and cannot establish absent contexts. Unreadable/unsupported effective requirements remain unconfirmed under required-only mode. Deduplicate superseded check attempts and bind observations to the delivered head. Keep all-reported mode conservative; a deliberately no-check policy must still be able to prove there are no unmet known requirements. Never use administrator bypass.

Add a snapshotted merge method (`merge`, `squash`, `rebase`; default `merge`) and use the existing exact-head guard. Store an intent before submission. Unsupported merge queues or repository restrictions become specific waits/decisions; this change does not implement merge queues or silently choose another method.

For preservation, read authoritative merged PR identity, exact source head, target and resulting `merge_commit_sha`, then fetch the target and prove that result is an ancestor of it. A test-merge SHA from an unmerged PR is not preservation. Keep original source-head ancestry as an additional check for merge commits, but do not require it for squash/rebase. Store both source and resulting identities with the method/PR receipt. Unknown identity or a force-pushed-away result retains the worktree. Branch preservation still requires the exact remote ref; no patch-similarity heuristic substitutes for evidence.

PR title/body come from issue intent and actual receipts. Use a marked controller-owned section for summaries and updates; preserve user text outside it. Discovery remains exact and refuses multiple/closed-unmerged matches.

Reviewed public contracts: [checks](https://cli.github.com/manual/gh_pr_checks), [guarded merge methods](https://cli.github.com/manual/gh_pr_merge), and GitHub's documented [merged commit semantics](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request). Pinned adapter fixtures must cover those contracts before native integration changes; tests never mutate user remotes or live forge PRs.

### 11. Bound verification and review feedback rounds

Persist a corrective round ID, accepted scope, starting commit, finding identities, remaining budget and explicit disposition. Internal verification/review failures before archival can return to Apply against unchanged approved planning content. After delivery, retain PR identity but invalidate old check/review/merge receipts whenever the source head changes. Budget defaults to zero repair rounds; an explicit project policy can permit a finite number (initial recommended enabled value: one).

For full-spec feedback after archive, leave the completed archive immutable and create a tracked revision OpenSpec change in the same issue worktree, based on the prior delivered round. Explore produces its correction artifacts; the revision uses configured plan approval, real tasks, checks, independent Review and archive before pushing the next head. Keep all prior change/archive receipts in round history and the original issue base for ticket-wide comparison. Never move a completed archive back to active or pretend archived tasks are a new Apply plan.

Lightweight revisions update only the short scope when needed and honor its approval policy. Findings that require new scope, ambiguous user intent or policy change become decisions, not automatic repairs. Forge comments are evidence to interpret, not authorization. Repeated identical findings cannot reset the budget; changed plan/head invalidates stale replies. A new merge form is required for each corrected head when human merge approval applies.

### 12. Keep cleanup narrow and outcome-aware

The default disposable-path list is empty. Optionally accept exact relative generated-directory names per repository (for example a deliberately selected dependency/cache directory), validated and snapshotted at execution start. Reject root/dot, absolute/parent paths, globs, `.git`, control/agent-instruction paths, paths containing tracked files, symlink traversal and unknown nested repositories. Check allowed paths and the exact native worktree again immediately before scoped deletion. Do not recursively treat every ignored file as generated.

After delivery/report preservation and complete writer quiescence, remove only proven owned allowed directories, re-read all tracked/untracked/ignored status, and use non-force native retirement. Record progress so a crash after disposal/removal cannot target replacement resources on retry. Unexpected paths remain blockers. Coding retention uses strategy-aware delivery receipts; research retention uses verified report receipts. Close the SQLite issue only after retirement is confirmed, retaining sessions and deliverables.

### 13. Extend the existing native work surface

Update observer schemas and read-model projection first, then native home/sidebar/detail presentation. Expose policy, effective scope/approval, current operation/round, worker activity, wait reason/owner/next observation, decisions, attention delivery state, separate capacity blockers and preserved reports. Use the existing Overview/Plan/Diff/Workers structure: Plan shows full-spec documents, research contract/report or lightweight scope as appropriate. Research has no fictional implementation task count. Continue ticket-wide diffs and historical delivery comparisons.

Observer reads remain read-only; mutation goes through Supervisor controller tools and native forms. Retain bounded lazy document/diff/report reads, host Markdown/theme, narrow layouts, keyboard behavior, navigation state and offline freshness. Per-record decoding errors become visible diagnostic entries rather than a failed entire snapshot. Update worker role instructions and the four existing workflow skills so behavior is discoverable without duplicating controller rules in prompts.

## Risks / Trade-offs

- [One broad change spans lifecycle and product behavior] → Implement the numbered foundation groups first, preserve compatibility tests and enable each later policy only after its native vertical slice passes.
- [Shorter lock scope permits stale completions] → Retain execution ownership, compare operation/generation/fingerprint under coordination, and test pause/replan/race results explicitly.
- [Native storage is not transactional with SQLite or files] → Keep current authoritative execution intent in one envelope, publish immutable artifacts before references and reconcile cross-system postconditions.
- [Schema migration could reject useful historical work] → Preserve original records, support validated legacy normalization and isolate unknown records without hiding them or writing guessed receipts.
- [Active versus retained limits surprise existing users] → Preserve the old effective resource ceiling for omitted new settings and show effective limits in doctor/readiness.
- [A progress watchdog mistakes legitimate work for a stall] → Respect explicit operation deadlines/declared waits and escalate for inspection without automatic destructive control.
- [Attention/repair creates model churn] → Stable native admission IDs, persistent handling states, one initial diagnostic turn per incident, finite repair budgets and no synthetic-notice feedback.
- [Native process cleanup differs from custom behavior] → Keep the existing process-tree tests authoritative; retain a minimal platform shim if a proven contract cannot be expressed by the pinned implementation.
- [Forge rules are unavailable or incomplete] → Keep readiness unconfirmed; never use a reported-check list as proof of all effective requirements.
- [Squash/rebase erases original ancestry] → Bind authoritative merged PR/source/result evidence and verify the resulting target commit, with no patch-similarity fallback.
- [Generated-path cleanup is broader than intended] → Empty default, exact snapshotted paths, path/ownership/tracked/symlink checks, and preserved deliverable receipts before any disposal.

## Migration Plan

1. Add malformed/legacy/future record fixtures and the reproduced CI-wait regression before refactoring. Capture all currently supported full-spec acceptance invariants in tests.
2. Introduce typed results and minimal delivery waits first; then add schema decoding and record normalization. Dry-run decoding through doctor/query diagnostics before rewriting legacy records.
3. Add scoped Runner behavior and operation ownership, then extract workflow internals and setup/query seams. Replace the global slow-operation critical section only when concurrency, cancellation and crash tests pass.
4. Normalize effective capacity/configuration. Existing full-spec executions keep their original IDs, approvals and compatibility defaults. Do not automatically resume old ambiguous recovery records; require an explicit retry after diagnosis when intent cannot be proved.
5. Add durable decisions/attention and native role/report support. Keep repair disabled and full-openspec default. Enable research/lightweight only once each complete path is tested.
6. Enable delivery strategy/policy settings and explicitly selected cleanup paths; update docs and API evidence alongside each feature. Run all repository checks and native renderer/build acceptance.
7. Before applying an upgraded runtime to real retained work, stop admission, wait for/confirm owned operations, take a coordinated SQLite backup and export original plugin-owned records and retained report files, then activate the upgraded service and reconcile. Do not copy a live SQLite database without its consistent backup mechanism/WAL treatment.

Rollback stops admission and confirms writer quiescence. Older code MUST NOT be run against records it cannot decode. Prefer retaining the new decoder with capabilities disabled; restoring a pre-upgrade snapshot is safe only if no later external effects or new work need reconciliation. Otherwise keep the upgraded read/recovery path and preserve worktrees until a forward repair reconciles current reality. No rollback resets, force-removes or discards user work.
