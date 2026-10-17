# Tasks

## 1. Shared schemas, JSON and time

- [x] 1.1 (N06 / finding 6) Reuse native model references and derive the redacted native error projection; narrow consumed events without string reconstruction. Verify identity/diagnostic tests retain brands, optional fields and response-body exclusion.
- [x] 1.2 (E03 / finding 14) Replace parse-then-decode boundaries with owned JSON codecs in CLI decoding, graph columns and import; preserve bounded diagnostics, omission/null behavior and additive storage evidence. Verify contract, record and graph migration/retry tests, including the explicit-undefined counterexample.
- [x] 1.3 (E04 / finding 15) Put independent config defaults and shared priority/count/progress constraints in owning schemas, retaining computed defaults and path checks. Verify old configuration resolution and rejection of negative counts or inconsistent task totals.
- [x] 1.4 (E05 / finding 16) Validate supported UTC timestamp strings and derive generated/fallback times from Effect Clock, passing time into pure/SQL boundaries. Verify TestClock receipts, invalid text/calendar rejection and unchanged valid historical strings without record rewriting.
- [x] 1.5 (E12 / finding 23) Define shared public/normalized/saved work-request schemas and derive tool/intake types; retain canonical normalization and implicit request hashes. Verify intake, SQL legacy retries and policy/scope/report rebind protection.
- [x] 1.6 Update `docs/supported-apis.md` for native schema projections, timestamp and JSON compatibility decisions; verify examples against the pinned declarations and the tests delivered in this group.

## 2. Typed failures and phase evidence

- [x] 2.1 (N01 / finding 1) Return guard denials through the native typed Tool.Error failure channel. Verify rejected shell/edit/patch calls have Fail rather than Die causes and remain forbidden.
- [x] 2.2 (E01 / finding 12) Convert effectful expected domain assertions/throws to typed failures, keeping deliberate synchronous invariant boundaries wrapped in Effect.try. Verify defect/interruption distinction and existing lifecycle/transaction behavior before narrowing legacy defect recovery.
- [x] 2.3 (E02 / finding 13) Simplify mechanical Result/generator scaffolding in config, scheduler, guards, observer and workflow fallback paths with focused Effect combinators. Verify the affected existing behavior tests and retain Result/Exit where branch values are required.
- [x] 2.4 (E11 / finding 22) Extract required provisioned/approved/verified/delivered evidence contracts and thread validated projections through checks, finalization and native worktree adapters. Verify type-level rejection of missing evidence, policy/setup distinctions and stale-generation runtime gates without assertion casts.
- [x] 2.5 Document synchronous versus effectful invariants and refined evidence ownership in `docs/architecture.md`; verify the documented boundaries match the converted callers and existing restart/ownership tests.

## 3. Scoped services, client and fibers

- [x] 3.1 (E08 / finding 19) Capture platform FileSystem/Path/ChildProcessSpawner services at the application/adapter boundary and migrate compatible ordinary filesystem wrappers. Verify callback database lifetime, injectable services, no-follow/bigint/Dirent exceptions, and interruption/timeout process-tree termination.
- [x] 3.2 (E06 / finding 17) Implement lazy single-flight native-client acquisition with successful reuse and failed-acquisition eviction. Verify concurrent initialization, retry after discovery failure and no discovery during plugin setup.
- [x] 3.3 (E07 / finding 18) Replace local task-slot/map bookkeeping with scoped FiberMap/FiberHandle ownership in visibility and operations. Verify request replacement, stale selection protection, disposal, pause and retained kernel-lock/generation behavior.
- [x] 3.4 Update `docs/architecture.md` and `docs/testing.md` for captured environments, lazy acquisition and fiber ownership; verify the documented lifetime/cleanup behavior in the integration fixtures delivered with this group.

## 4. Native tool contracts and progress

- [x] 4.1 (N03 / finding 3) Make registration generic in input/result schemas, declare actual output contracts for every crew tool and return validated native structured output plus compatible success content. Verify advertised schema/handler type correspondence, representative reads/mutations, raw backup JSON and no-value success results.
- [x] 4.2 (N04 / finding 4) Move validation into native schema-owned tool inputs and remove handler re-decoding without weakening strict excess-property rejection. Verify the actual pinned host rejects malformed/extra arguments before handler entry; document any necessary narrowly scoped portable adapter.
- [x] 4.3 (N02 / finding 2) Return genuine action failures as native Tool.Error with safe code/recovery guidance; retain explicit routine waits as successful data. Verify native failed-tool state/events and update consumers of the old ok:false envelope without swallowing defects or cancellation.
- [x] 4.4 (N05 / finding 5) Thread a bounded native progress reporter through long setup/verification/delivery operations, preserving durable progress and ownership. Verify milestone/count updates, safe payloads, unchanged heartbeat meaning and cancellation/failure behavior.
- [x] 4.5 Update model-facing tool guidance and `docs/supported-apis.md` for structured outputs, native errors and progress; verify documented success/failure examples against real native calls in the group's tests.

## 5. Observer errors, commits and read reuse

- [x] 5.1 (N07 / finding 7) Declare portable RPC domain errors and map known missing/unavailable/invalid-selection failures through native factories; handle resource errors separately in the TUI. Verify expected RPC errors preserve unrelated work while connection/internal failures retain their distinct state.
- [x] 5.2 (E09 / finding 20) Introduce a request-local read bundle shared by readiness/snapshot/detail projections. Verify collection-read counts are reduced, a later request sees newer committed data, lazy document/diff limits remain and mutations never use cached authority.
- [x] 5.3 (N08 / finding 8) Publish small home-scoped work invalidations after graph/record commits, consume them through native RPC events and coalesce refresh with reconnect/poll fallback. Verify commit ordering, worker-location changes, unrelated-home filtering, publication failure and missed events without repeated mutations or global-lock-held publication.
- [x] 5.4 Update observer/API architecture documentation and `docs/testing.md`; verify the documented error, freshness and ephemeral-event recovery contracts through the fixtures delivered in this group.

## 6. Native presentation and worker admission

- [x] 6.1 (N09 / finding 9) Derive running/queued presentation from synchronized host session/pending data and remove duplicate TUI active polling/state. Verify new off-screen sessions, pending prompts, failed synchronization, existing tab behavior and no focus theft.
- [x] 6.2 (N10 / finding 10) Register panel navigation through targeted native keymap layers and derive help from active shortcuts while retaining necessary button focus behavior. Verify remapping, editor/dialog precedence, narrow rendering and cleanup with the real native renderer.
- [x] 6.3 (N11 / finding 11) Preflight effective agent/model/tool capability using the assigned location's native inventory before new prompt admission. Verify missing selections, unavailable inventory and cross-repository profiles preserve intent/resources, do not substitute providers and do not duplicate already-admitted prompts.
- [x] 6.4 Update native UI/admission guidance in architecture/API/testing documentation; verify examples against the renderer, worker lifecycle and native-server tests delivered with this group.

## 7. Correlated observability

- [x] 7.1 (E10 / finding 21) Annotate operation spans/logs with safe retained identities and add reconciliation-duration, admission-wait, distinct-provider-failure and observer-request measurements. Verify correlation, finite labels, deduplication and exclusion of secrets/raw provider payloads without adding an exporter/dependency.
- [x] 7.2 Document metric meanings and diagnostic identity fields in `docs/testing.md`/`docs/architecture.md`; verify the runtime fixtures produce the documented bounded observations and unchanged lifecycle outcomes.

## 8. Complete integration validation

- [x] 8.1 Run `pnpm check` and resolve formatting, type, lint and Effect diagnostic failures; verify each of the 23 finding IDs is implemented and its focused checks have passed.
- [x] 8.2 Run `pnpm test` and `pnpm test:e2e` using only disposable repositories; verify native input/output/error/progress, observer errors/events, inventory preflight, restart identities and existing cancellation/delivery/retirement gates without pushing user remotes.
- [x] 8.3 Run strict OpenSpec validation and inspect the final diff against proposal/spec/design and the finding-coverage table; verify no stretch work, unsafe cast workaround, schema/wire incompatibility or unchecked task is represented as complete.
