# Design

## Context

See [proposal.md](proposal.md) for motivation and scope. The input is the audit's numbered findings 1–23: N01–N11 followed by E01–E12. The nine stretch findings are not part of this change. The audit reviewed the current working tree at base `e64a438`, which already includes substantial uncommitted integration work; implementation must build on that state rather than restore the base revision.

The relevant existing seams are:

- `src/opencode/tools.ts` pairs a Standard Schema input with a handler returning `unknown`, decodes the input again, and converts all expected failures to successful `ok:false` content. `guards.ts` separately throws `Tool.Error` inside an Effect generator. The recorded reproduction confirms `Die(Tool.Error)` rather than the typed failure channel.
- Native tool declarations already support Effect codecs, structured output schemas and per-call progress. Native RPC declarations support declared error schemas and events. The installed TUI context exposes session status/pending data and focused keymap layers.
- `identities.ts` validates Timestamp only as nonempty text and generates it with the wall clock. Many deadlines already use Effect Clock. Persisted execution schemas establish phase-specific evidence that the mutable working type subsequently loses.
- `applicationLayer` is built into the host plugin scope. Changing it to a finite `Effect.provide` around registration would close the database before callback use. Client discovery must remain lazy so plugin activation completes before cross-location RPC work begins.
- Observer snapshot/detail paths repeat graph/record reads. TUI requests manually manage fiber slots, while operations have a separate local fiber map and durable kernel-backed ownership. These are separate concerns.
- `WorkInput`, `NewIssue`, the work-create tool schema and request normalization repeat one creation contract. Existing SQL retry and migration tests cover compatibility with saved requests lacking newer fields.

API evidence is the pinned declarations/source under `node_modules/@opencode/{plugin,schema,client}`, Effect 4.0.1 source, and `docs/supported-apis.md`. Existing integration tests exercise host lifetime, process trees, restart identity, and the real bundled-Bun terminal renderer. The preceding audit passed `pnpm check`, 197 unit/integration tests and one native E2E test; those results are a baseline, not validation of this planned change.

## Goals / Non-Goals

**Goals:**

- Retain the schema-to-handler type relationship and native failure/progress semantics at each public adapter boundary.
- Make time, platform services, client acquisition and background fibers testable within explicit application lifetimes.
- Share only read observations that belong to the same request; retain fresh authority checks before side effects.
- Account for every selected finding with implementation and behavior-focused validation.

**Non-Goals:**

- Replace the controller, SQLite graph, kernel locks, policy snapshots, workflow gates or native worktree/session ownership.
- Upgrade pinned packages, add an observability backend, introduce a workflow engine or implement S01–S09.
- Give every internal interface a runtime schema, require immutable execution state everywhere, or eliminate specialized Node APIs whose safety contracts are needed.

## Decisions

### 1. Preserve native channels in a typed tool registration boundary

Create a generic tool definition/registration helper that retains each input schema, result schema and handler relationship until `editor.add`. Do not widen the heterogeneous definition list to a handler returning `unknown` or repair it with casts. Public successful outputs use a schema-defined `{ ok: true, result?: ... }` envelope, with omitted `result` for no-value operations. Populate native structured `output` and keep the existing successful JSON content envelope so current success readers remain compatible. Give each tool its actual result projection; the explicit raw-record backup route can carry validated JSON evidence without pretending its additive fields are a closed execution type.

Use native Effect input codecs and host decoding, then remove decoding from `d.run`. The strict excess-property policy must be owned by the registered schema/decoder and exercised through the actual native boundary. The installed generic codec support alone does not prove host parse-option behavior. If a plain codec cannot enforce this, use a schema-owned strict native decoder with the same advertised representation; retain a narrowly documented Standard Schema boundary only where the pinned host requires it. In either case the handler consumes validated arguments once and does not cast or silently strip forbidden fields. Keep portable Standard Schema for the shared Promise/TUI RPC contract.

Map expected handler failures to `Effect.fail(Tool.Error)` with a safe message, code and recovery action. Guard failures use that same channel directly. Preserve failed verification/rejected management calls as failures; explicit classified CI/review waits remain successful values. Unexpected defects retain their cause and interruption remains interruption. Adapt tests and model-facing instructions that currently inspect `ok:false` rather than native tool state. Do not broadly catch every defect to restore the old envelope.

**Alternative considered:** retain JSON-only success/error envelopes. This preserves a superficial shape but prevents native error presentation, typed consumers and failed-tool diagnostics from understanding rejected actions.

### 2. Own schemas where values enter and retain upstream contracts

Alias the worker model contract to native `Model.Ref`. Derive a local diagnostic error projection from native type/message/status fields, retaining redaction and deliberate stricter checks while excluding response bodies. Narrow native events by their discriminants rather than reconstructing already branded IDs through strings.

Use `Schema.fromJsonString` with existing bounded source/field diagnostics for CLI payloads, SQLite JSON columns and legacy JSONL entries. Keep synchronous decoding inside synchronous SQL transactions. Use schema decoding defaults for independent configuration constants and one set of count/priority/progress refinements. Computed defaults, canonical-path checks and cross-field/domain decisions remain explicit resolution logic.

Define one creation-schema family: public optional inputs, resolved normalized requests and supported saved request inputs. Derive tool types and `WorkInput`/`NewIssue` from that family. Preserve current trim/sort/deduplicate semantics, workflow/scope/report contributions and Supervisor-scoped implicit-key hashing. Historical requests missing policy/scope fields must normalize compatibly, and raw import evidence remains preserved. Schema consolidation must not silently reorder canonical hashed fields or add null-valued fields.

Maintain JSON normalization at native storage/RPC boundaries until an explicit codec proves byte/shape compatibility for omitted optionals and additive fields. The audit demonstrated that `toCodecJson` on an explicit optional undefined encodes null whereas current stringify omits the property; a mechanical substitution is rejected. No database/record version bump is planned for representationally identical improvements.

**Alternative considered:** derive all public outputs directly from broad mutable execution types or replace every stringify with a generated JSON codec. Both lose deliberate projection or compatibility decisions.

### 3. Make domain failure and phase evidence explicit

Convert effectful expected invariants to yielded typed errors or small effectful validation functions. Replace simple `attemptN`/nested-generator scaffolding with `catchIf`, `matchEffect`, `tapError` and direct values. Keep Result/Exit when branches genuinely form data, including command completion and owned-operation exits. Keep throwing assertions in pure invariants or synchronous transactions wrapped by `Effect.try`; audit and document those deliberate boundaries before narrowing `domainEffect`'s legacy defect recovery.

Extract named schema contracts for provisioned, approved, verified and delivered evidence from the owning record fields. Validation functions return small required-value projections; checks, finalization and native worktree adapters consume those values instead of repeatedly asserting optional fields. Full-spec, lightweight, research and setup variants retain their different evidence requirements. A refined value proves the observation that produced it, not that a later generation still owns authority: operation identity/generation/fingerprint checks remain mandatory at commit time. Retain legitimate internal ports such as Runtime, Runner, Locks and decoded SessionState.

**Alternative considered:** assert the entire mutable execution into a phase interface, or re-decode it repeatedly inside every helper. The first bypasses proof and the second adds boundary work without preserving clear ownership.

### 4. Use one clock and one scoped application environment

Keep persisted Timestamp as a branded string with validation for supported UTC instants; retain valid historical `Z`/zero-offset forms without rewriting them. Reject impossible calendar values and invalid time text. Generate timestamps from Effect Clock/DateTime and supply time explicitly to pure constructors/SQL actions. Preserve native decoded DateTime values and encode them at the existing wire seam. Do not use a new fallback timestamp to fabricate historical authorization.

Provide FileSystem, Path and ChildProcessSpawner once at the application/adapter layer and capture those services for callbacks. Migrate ordinary filesystem operations where semantics match. Retain Node's no-follow flags, bigint identity, Dirent overloads and non-cancellable mutation protection where required. Build application resources in the host scope; acquire/release command and file handles in per-operation scopes. Scripts receive the equivalent live environment and tests can replace it.

Initialize one lazy shared native-client acquisition effect in that environment. Concurrent first callers share acquisition, successful acquisition is retained for the plugin lifetime, and failed acquisition is evicted so later calls can retry. Client initialization must not start discovery during plugin registration. Do not use an unbounded cache of initial failure or silently start a new native server.

Use FiberMap/FiberHandle for TUI request slots and the local operation registry. Automatic fiber cleanup replaces bookkeeping, while selection/request-version fences remain to reject late results. Local task replacement never replaces cross-process kernel locks or durable generation/stop records. TUI/plugin disposal owns subscriptions and requests; native panels that intentionally share a plugin view do not cancel one another's work simply because one surface unmounts.

**Alternative considered:** global caches or a single application scope for subprocess handles. These would obscure failure retry or delay ownership release beyond the command's termination contract.

### 5. Declare observer errors and emit post-commit invalidations

Add schema-defined observer errors such as `not_found`, `resource_unavailable` and `invalid_selection`, constructed using native RPC error factories. Map only known expected codes; internal defects keep their native framework failure. A document-specific failure changes that resource's state, whereas transport failure marks connectivity stale. Retain safe bounded messages and existing source containment checks.

Declare a small native `work.changed` event carrying home and optional issue/repository identity. Instrument successful graph mutations and successful plugin-record commits at their owning write seams, covering worker reports/decisions and project/setup changes as well as foreground controller actions. Keep a scoped post-commit publisher behind a minimal callback/service; attach it after RPC registration without eagerly discovering a client. Worker-location publishers retain their actual native envelope location. Consumers accept home-matching invalidations from central and relevant worker locations, coalesce refresh and ignore unrelated homes; they do not forward received events back into publication.

Notifications happen after the relevant commit and outside shared coordination locks. Publication failure is logged safely but cannot turn a committed action into a retried mutation or roll it back. The graph and record stores remain separately authoritative; an invalidation is not an atomic snapshot of both. Reconnect the ephemeral event subscription and perform a fresh read after subscribing/reconnecting. Preserve periodic refresh because the native transport has neither replay nor automatic reconnection.

Build a request-local decoded observation bundle for the graph explanation, issues, executions, projects/setup and record diagnostics. Reuse it within readiness/overview/detail projections instead of calling full snapshot/collection paths recursively. Do not introduce a process-wide TTL cache or pass request-local observer data into a mutating gate. Instrument read counts in focused fixtures and remove duplicate work before claiming performance improvement; graph and native storage do not become a cross-store transaction.

**Alternative considered:** event-only refresh or a durable custom event bus. The former loses updates across disconnects; the latter duplicates native infrastructure without a lifecycle need.

### 6. Use native session presentation and keymaps

Synchronize newly discovered worker sessions and pending inbox state through the host data service without focusing conversations. Derive display running/queued state from that service; keep only OpenCrew-specific activity excerpts and an explicit sync/freshness indicator. Remove TUI polling of `session.active` and duplicate execution-event status maintenance. Server-side authoritative `NativeRuntime.session` observation is unaffected.

Register named Back/Home and applicable directional navigation commands in panel-targeted keymap layers with mode/focus predicates. Generate footer help from `ctx.keymap.shortcuts`. Preserve editor/dialog precedence, tab and panel behavior, focus restoration and narrow layouts. Keep low-level button activation and geometric focus helpers where there is no native equivalent widget. Do not invent a generic host button API.

**Alternative considered:** retain hardcoded `useKeyboard` shortcuts and maintain another session store. That bypasses remapping/discovery and duplicates state the host already owns.

### 7. Preflight worker selections without expanding authority

After native location provisioning/activation and before admitting a new retained worker prompt, inspect the agent/model inventory at the owned worktree location through the location-aware native client. Validate the effective configured or inherited profile and required tool capability. Preserve agent/model variant semantics and report unavailable inventory, missing selections and incompatible capabilities with distinct safe errors. Do not query only central registry data or fall back to another model.

Integrate preflight with WorkerSessions' retained admission/recovery path. Inspect existing durable prompt admission before considering resubmission: an already-admitted prompt is observed/stopped through existing rules, not recreated or deleted because a later inventory changed. Inventory reads cannot block the global coordination lock; the current generation/reservation must still match before admission. Preflight does not test credentials and does not change native provider retry policy.

**Alternative considered:** probing providers or validating inventory only while loading configuration. The first adds cost and changes retry behavior; the second cannot establish the actual cross-repository worker environment.

### 8. Add bounded observability using the host Effect runtime

Annotate named operation spans/logs with safe issue/execution/generation/operation identifiers when available. Add counters for observer requests, admission waits and distinct observed provider failures, plus a histogram for reconciliation duration. Labels are finite method/role/outcome categories, not per-issue/session/model identifiers or raw messages. Do not count repeated observation of one retained failure as new provider failures. Use the existing logger/metric runtime without a new exporter, process or telemetry dependency.

**Alternative considered:** logging raw causes everywhere or exporting a new telemetry pipeline. These increase disclosure and operational scope without improving the local integration contract.

## Risks / Trade-offs

- **Native input decoding can change excess-field handling** → exercise strict validation through the pinned real host before removing handler validation; preserve a documented compatibility adapter if necessary.
- **Native failed-tool semantics change model-visible behavior** → mark the change breaking, retain safe recovery guidance and update tests/instructions that consumed `ok:false`; prove failure does not grant approval or automatically terminate unrelated work.
- **Schema/clock tightening can expose historical malformed records** → preserve originals, report bounded diagnostics, retain supported valid timestamps and saved request normalization, and avoid opportunistic migrations.
- **Layer/fiber refactoring can release resources too early or interrupt a writer too soon** → retain host-lifetime tests, process-tree termination tests, command scopes and generation/kernel-lock fences.
- **Notifications can turn commit success into ambiguous failure or create refresh storms** → isolate post-commit best-effort publication, filter home/location, coalesce, reconnect and preserve polling.
- **Host session caches can report unsynchronized sessions as idle** → track sync freshness, include pending prompts and test off-screen/new sessions; never use UI cache as controller authority.
- **Request-local reuse can be mistaken for transaction consistency** → document separate stores and read freshness; revalidate all mutation evidence independently.
- **Broad scope can hide unfinished findings** → use the coverage table below and close every unchecked task before archive; do not quietly defer the selected observability item.

## Migration Plan

1. Implement shared schema/time/request contracts and compatible decoders first, including valid legacy fixtures; retain current persisted representation.
2. Convert domain failure paths and phase-specific evidence seams, then integrate scoped services/client/fibers with existing cancellation tests passing.
3. Switch native tool input/output/error/progress boundaries and update their native fixture consumers together.
4. Add observer errors, request-local projection reuse and post-commit events, then switch TUI data/keymaps and worker profile preflight.
5. Add bounded metrics/correlation and revise `docs/supported-apis.md`, architecture, testing and model-facing tool guidance for the final contracts.
6. Run the complete required checks and strict OpenSpec validation. Deploy the plugin and matching TUI contract together, restarting them to release old scopes/subscriptions.

No database migration or native-resource recreation is required. A code rollback to the prior integration can read the same valid records, but reverts native failure presentation and typed RPC/event consumers together. Malformed records discovered by stricter validation stay intact for explicit repair. Do not restore old data over concurrent valid work or recreate sessions/forms/worktrees during rollback.

## Finding Coverage

| Final list | Audit ID | Planned change                        | Validation focus                                                      |
| ---------- | -------- | ------------------------------------- | --------------------------------------------------------------------- |
| 1          | N01      | Typed native guard failures           | Fail versus Die cause and real host rejected tool                     |
| 2          | N02      | Native failed-tool status             | Domain rejection, routine wait and defect stay distinct               |
| 3          | N03      | Schema-defined structured tool output | Actual advertised schema, successful and no-value results             |
| 4          | N04      | Native schema-owned tool input        | Strict unknown-field rejection and no handler re-decode               |
| 5          | N05      | Native tool progress bridge           | Bounded updates, durable evidence and cancellation                    |
| 6          | N06      | Native model/error projections        | Brand/optional compatibility and response-body exclusion              |
| 7          | N07      | Declared observer RPC errors          | Resource unavailable versus disconnected service                      |
| 8          | N08      | Post-commit work invalidations        | Commit ordering, failed publish, home filtering and missed events     |
| 9          | N09      | Host session/pending presentation     | New/off-screen/queued sessions and sync failure                       |
| 10         | N10      | Targeted native keymaps               | Remapping, editor/dialog precedence and cleanup                       |
| 11         | N11      | Worker-location inventory preflight   | Missing agent/model/capability and retained admissions                |
| 12         | E01      | Yielded expected domain failures      | Defects/interruption remain distinct; synchronous SQL stays atomic    |
| 13         | E02      | Focused Effect combinators            | Same domain outcomes with simpler failure paths                       |
| 14         | E03      | JSON codecs                           | Malformed data diagnostics, omission/null and additive evidence       |
| 15         | E04      | Shared defaults/refinements           | Computed defaults, nonnegative counts and consistent task totals      |
| 16         | E05      | Valid clock-derived timestamps        | TestClock, valid historical forms and invalid calendar values         |
| 17         | E06      | Lazy single-flight client             | Concurrent callers, failed acquisition retry and activation ordering  |
| 18         | E07      | FiberMap/FiberHandle lifetimes        | Replacement, stale response fences, pause/disposal and lock ownership |
| 19         | E08      | Captured platform services            | Injectable services, callback lifetime and process-tree termination   |
| 20         | E09      | Request-local observer bundle         | Collection read counts and next-request freshness                     |
| 21         | E10      | Correlated diagnostics/metrics        | Safe identities, deduplicated failure counts and finite labels        |
| 22         | E11      | Required phase evidence contracts     | Type-level rejection of missing evidence and policy variants          |
| 23         | E12      | Work creation schema family           | Public input, normalized request, legacy retry and hashing parity     |

## Implementation evidence: pinned input repair and native defaults

Real model-driven calls proved that the pinned built-in input-repair hook deletes excess properties from ordinary closed object descriptions before a strict validator runs. The strict input adapter therefore exposes an equivalent composed object description and one schema-derived portable validator. The repair hook leaves that composition intact. Native malformed/extra argument calls fail before handler entry and create no issue. This is the narrowly scoped portable compatibility boundary permitted by decision 1; no handler re-decoding or cast is retained.

Inventory tests also exercise the pinned native implicit `build` profile (`Agent.Info.default`) and the omitted/`default` model variant equivalence. Explicit missing agent IDs, disabled/missing models and nondefault missing variants still fail admission without substitution. Optional retained worker-failure prompt identity distinguishes a new failed turn from a repeated observation without changing schema version or rewriting historical records.

The repeated native correction-budget test exposed a stale-write race: a concurrent progress save could overwrite a newly appended decision from an older execution snapshot. Correction decisions now append through Records.update under the existing coordination lock, validate generation/operation identity, and synchronize the caller from the committed result. A deterministic regression preserves both newer progress and the decision.
