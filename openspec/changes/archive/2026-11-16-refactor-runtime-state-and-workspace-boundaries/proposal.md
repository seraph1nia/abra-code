# Proposal

## Why

AbraCode's execution persistence and observation paths make independent changes interfere and make local reads perform global work. A broad cleanup should first close the reproduced consistency gaps, then make ownership, package boundaries and rendering costs explicit while preserving controller authority and retained evidence.

## What Changes

- Replace stale aggregate replacement with revision-checked, ownership-scoped execution updates, preserving generations, operation identity, immutable histories and supported legacy records.
- Reconcile browser admission by exact session/request identity independently of the recent receipt window; reconnect observation after both native stream failure and clean EOF.
- Introduce scoped change notifications, source revision evidence, AG-UI incremental updates, selective Effect atom invalidation and a bounded snapshot fallback without replaying input or adding another model loop.
- Separate task, finder, fleet and native-session reads; use bounded SQL search/count/page queries and coherent retained-state capture instead of constructing fleet snapshots for task detail.
- Extract `@abracode/contracts` and `@abracode/presentation` workspaces, then an encapsulated `@abracode/runtime` after its command/query boundaries are established. Preserve public root commands, native plugin loading and source-installation behavior.
- Decompose frontend observation/admission/history/composer/navigation responsibilities; keep the existing component stack and implement measured lazy loading, immutable hashed-asset caching and initial-load budgets.
- Replace per-document application compilation with a reusable portable renderer shell, inert document/diagram inputs and exporter identity derived from actual renderer inputs.
- Move application composition out of lifecycle advancement, expose explicit command/query contracts, and consolidate repeated domain projections, safe artifact-publication primitives and instruction ownership where callers benefit.
- Audit direct dependency ownership, supported upstream features and compatibility exceptions; update compatible React type packages and preserve the Zod 3 peer contract until an upstream-compatible migration is available.
- Add a fast contributor test tier, reduce duplicated fake behavior, preserve complete required suites, and retain native/browser/performance evidence and updated installation, API and verification guidance.

No public workflow or stored identity is intentionally broken. Internal source imports will change; compatibility entry points and fixtures must move with them.

## Capabilities

### New Capabilities

None. Extend the existing capability owners rather than creating a second workspace, workflow or reporting contract.

### Modified Capabilities

- `typed-contracts`: concurrency-safe retained updates and typed transport projections with compatible encoding.
- `work-visibility`: exact admission observation, reconnectable ordered synchronization, scoped reads/invalidation and deferred loading.
- `report-template`: reusable offline export assets, renderer-scoped cache identity and bounded isolated publication.
- `worker-policy`: single ownership of procedural guidance and task-specific assignment context without changing permissions.
- `release-distribution`: declared workspace dependencies, complete relocated installations and compatible dependency maintenance.
- `continuous-integration`: fast focused feedback plus complete isolated acceptance and measurable performance coverage.

## Impact

Primary areas are `src/storage`, `src/work`, `src/workflow`, `src/visibility`, `src/web`, `src/opencode`, both applications, scripts, workspace/package/TypeScript/Vite configuration, source-installation fixtures, licensing, project-owned skills and role instructions. New internal packages replace app-to-root and report-to-web relative imports. Native RPC and HTTP contracts receive additive scoped-observation and exact-receipt operations; existing fixed browser capability boundaries remain.

The investigation baseline was commit `66f42970486d56d508bef538582127ed4b1f6896`: `pnpm check`, 578 unit/integration tests, 29 end-to-end tests, the web build and all 35 communication benchmark cases passed. These are prior investigation results, not verification of this change. The review measured about 34,417 backend lines, 8,374 frontend lines, 84 execution fields, 75 app-to-root imports and a 3.24 MB minified main web chunk. Initial gzip transfer and timing must be remeasured on the implementation baseline; the previous test commands ran concurrently.

## Scope and Choices

### 1. Preserve authority and settle the baseline first

Keep SQLite authoritative for issues/dependencies, native storage for retained execution evidence, OpenCode for sessions, OpenSpec for planning/tasks and the controller for lifecycle gates. Require human plan approval before registered implementation admission. This proposal's configured compact schema does not grant implementation or checkpoint authority.

Inspect actual controller/delivery evidence for overlapping `make-chat-the-primary-workspace`, `simplify-openspec-execution-loop`, `complete-work-reliably` and operational changes before implementation. Their task completion is not delivery or canonical-spec synchronization. Read applicable deltas alongside canonical specs, record the effective baseline and resolve material conflicts through the existing decision route. This change does not authorize another issue's archive, merge, cleanup or closure, and does not take over deferred management-autonomy work. Its delta requirements are additive to avoid overwriting pending requirement replacements.

### 2. Make writes own their changes

Keep the physical execution record/key layout initially. Group fields by lifecycle, assignment, communication, obligations, validation/feedback, reports and finishing ownership in the repository API. Compute updates from current retained data inside the existing short cross-process coordination boundary. Full replacement requires the expected current revision; stale work must either be rejected or rebased through an explicit operation owning only its permitted fields. A generic partial patch from an observer or caller is not a public mutation capability.

Migrate every production save caller, including setup, recovery, diagnostics and report completion, before removing the stale-field preservation list. Retain schema/generation/operation checks and append-only/immutable-history validation. Use one controllable clock for newly generated adapter timestamps. Capture retained multi-store observations under short compatible coordination or validated revision retry; native session reads happen outside it and carry independent freshness. Persistent contention returns a bounded unavailable observation. No native network observation, compiler or Git operation runs under the shared commit lock.

Moving execution evidence to SQLite, splitting it across independent native keys and adopting Effect's workflow engine are excluded from implementation in this change. Record a concrete comparison against the resulting interfaces, durability and migration cost; any later adoption needs its own accepted migration. Existing cross-process locks remain necessary while native storage lacks transactions/CAS.

### 3. Separate observation from admission and display history

Add an authenticated exact receipt read scoped to the fixed Abra session and request ID, projected through the existing typed HTTP boundary. It observes retained admission only. Missing evidence remains missing/uncertain and never authorizes resubmission. The recent receipt list is display history, ordered explicitly when retained time is available. Immediate admission acknowledgement and same-ID retry use the same receipt contract. Test a suspended tab and more than 100 subsequent receipts, including another tab and service restart.

One scoped server observer reconnects on EOF/error with bounded backoff and cancellation. Bootstrap/reconnect establish a full baseline. Subsequent ordered updates carry observer epoch/sequence and applicable source revisions; timestamps describe freshness rather than establishing causal order. Use supported AG-UI state/message events, including state deltas where appropriate, with a full snapshot on a missing baseline or sequence gap. Keep native message/call IDs and hidden-reasoning exclusion. Legacy unordered inputs remain full-snapshot compatibility inputs and cannot silently supersede an established ordered epoch.

Classify changes by transcript, forms/permissions, exact admissions, issue IDs, finder/fleet and presentation resources. Preserve the existing legacy invalidation route as a broad fallback while updating all installed consumers. Coalesce updates, avoid emissions/refetches when only observation time changes, and selectively invalidate mounted queries, including off-page selections. The fallback attempts refresh at least every five seconds while mounted, with bounded read deadlines; it must not duplicate unchanged resource fetches. Browser disconnection releases observation only.

### 4. Give queries and packages useful boundaries

Task detail must not compute fleet readiness, inspect unrelated native workers or reload lead history. Finder SQL filters before pagination; separate aggregates retain complete fleet counts/attention and explicit coverage limits. Batch dependency and execution reads rather than fetching each issue independently. Request-local reuse is permitted; mutation authorization always rereads current owning evidence.

Extract packages in this order:

| Package                  | Owned interface                                                                              | Excluded capabilities                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `@abracode/contracts`    | Identities, DTOs/codecs, catalog/resource/report definitions and browser-safe HTTP contracts | Controller instances, filesystem, native registration and runtime effects |
| `@abracode/presentation` | Pure React/catalog rendering, UI primitives, tokens and captured-data bindings               | Router, queries, admission, CopilotKit/model tools and native adapters    |
| `@abracode/runtime`      | Explicit lifecycle commands, queries, repositories and host adapters                         | Imports from application UI entry points                                  |

Apps consume `workspace:*` dependencies through explicit subpath exports. Keep native RPC registration in its adapter, and keep live session, attachment, save/export and tool-rendering wrappers in `apps/web`. Enforce import restrictions and dependency declarations in checks, including type-only imports and offline bundle contents. Root scripts and `.opencode/plugins/abracode/index.ts` remain compatible thin entry points. Update every `import.meta.url`/installation-root assumption, source-copy recipe, generated bootstrap path, exporter inventory and attribution use alongside moves. Do not create a package for every workflow module.

Consolidate DTO fields through shared schema projections while preserving intentional bounded browser/native differences. Replace the generic string-map/unknown backend dispatcher with typed fixed operations; do not expose a generic native proxy. Establish explicit command/query interfaces and dependency composition at the application seam instead of leaking `Advancement` member paths through controller signatures. Extract pure decisions and small publication utilities only where existing callers share the same invariants.

### 5. Reduce frontend and export cost without losing behavior

Split `useWorkspace` into observation, admission, persisted draft and transcript-history owners; extract workspace navigation and scrolling responsibilities. Keep React, Base UI/shadcn, Tailwind, TanStack Router, Effect atoms, CopilotKit's supported render-only hooks, Pierre and A2UI. Preserve form binding resets/concurrent replies, mounted composer drafts/scroll, URL history, focus restoration, unknown/stale labels, desktop/mobile themes and 375/390px layouts.

Measure the full initially requested JavaScript graph, including modulepreloads, on identical toolchain/data conditions. Defer inactive inspector/report/diff capabilities and unnecessary Markdown languages/themes/diagrams using supported package entry points and options. Acceptance requires at least a 20% reduction in initial gzip JavaScript against the recorded pre-change baseline, without hiding eager bytes in renamed/preloaded chunks or dropping supported rendering. Cache only content-hashed public assets immutably; HTML, API, forms, receipts and report responses retain their required freshness/isolation. Compression adoption requires measured benefit and compatible streaming behavior.

Build a content-addressed portable report shell once per renderer identity during the normal build or first explicit export; subsequent documents reuse it without application compilation. Prepare Mermaid separately as bounded trusted SVG inputs and inject escaped canonical JSON/diagram data. Fingerprint actual renderer/catalog/style/tool/notice inputs; unrelated backend files and unrelated lockfile changes cannot invalidate it, while changed resolved renderer dependencies must. Preserve old export receipts and paths, include an explicit exporter ABI/version marker in the new identity, and never rewrite canonical JSON or legacy artifacts. Keep the 1 MiB document and 8 MiB HTML bounds, no external asset/network requirements, opaque sandbox, notices, atomic exclusive publication, exact-byte reconciliation and owned scratch cleanup.

### 6. Simplify instructions, dependencies and proof

Roles own identity/responsibility; skills own reusable procedures; prompts supply task facts; schemas own artifacts; code enforces authority. Remove duplicated procedure bodies and the active Research role's retired Vite/Solid instruction. Keep generated OpenSpec skills byte-for-byte upstream output. Preserve mandatory skill-availability admission policy, conditional skill use, captured requirements and content digests; changing availability or role permissions is not part of cleanup.

Audit root and package dependencies, narrow peer overrides, and supported upstream features at implementation time. Compatible React type updates are included. Keep Zod 3 while A2UI requires it and document that compatibility decision; remove a direct dependency only after proving package/peer resolution and supplier inventory. No automatic major upgrades, alternate providers, new state library, ORM or workflow engine is introduced.

Add a fast pure/in-memory tier without browsers/native services and move repository/CLI behavior into appropriate integration/native tiers. Prefer the actual in-memory SQLite graph over a second fake implementation where it preserves useful speed. Required `pnpm check`, `pnpm test`, `pnpm test:e2e`, build/schema/license gates and existing native journeys retain their coverage. Use dependency-aware checks to remove demonstrable duplicate work, not skip affected packages. Record sequential before/after timing, native/storage call counts, initial-load bytes and compiler counts. Final native/browser evidence and screenshots must survive fixture teardown; no paid providers, operator-service restart or user-remote push is authorized.

### 7. Rollout and risks

Implement regression fixes before mechanical extraction, then query/synchronization changes, controller decomposition/runtime relocation, frontend/export optimization and final guidance/test consolidation. Run focused proofs at each boundary and all required suites on the final frozen source. Every stage must remain buildable, restartable and reviewable.

Risks are lost evidence during caller migration, deadlocks or starvation during coherent reads, event gaps across restart, accidental browser/offline capability imports, broken relocated installation paths and exporter cache collisions. Mitigate with old-record/restart fixtures, bounded coordinated capture, epoch/gap recovery, enforced package/bundle boundaries and relocated source-installation/export tests. Roll back application code with a compatible retained-data reader; never downgrade state, rewrite receipts, alter an active schema binding or erase evidence to make an older runtime start.

### Finding coverage

| Review finding                  | Planned closure                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------- |
| 1. Execution persistence        | Owned updates, stale-revision refusal, caller migration and compatibility proof   |
| 2. Receipt window               | Exact request-status read and suspended/multi-tab regression                      |
| 3. Clean EOF                    | Scoped reconnect and disposal proof                                               |
| 4. Broad synchronization        | Scoped notifications, ordered deltas, semantic deduplication and fallback         |
| 5. Global read models           | Task/finder/fleet separation, SQL batching and coherent retained reads            |
| 6. Workspace boundaries         | Contracts/presentation extraction followed by encapsulated runtime                |
| 7. Frontend loading/composition | Cohesive state owners, measured lazy loading and asset caching                    |
| 8. Export pipeline              | Reusable shell, actual renderer fingerprint and retained artifact compatibility   |
| 9. Workflow interfaces          | Application composition, explicit use cases and bounded engine/storage comparison |
| 10. Agent/skill duplication     | Procedure ownership, corrected guidance and unchanged controller enforcement      |
| 11. Dependency maintenance      | Ownership/peer audit, compatible type updates and explicit Zod decision           |
| 12. Verification/baseline       | Fast tier, real graph seams, complete gates and overlap reconciliation            |
