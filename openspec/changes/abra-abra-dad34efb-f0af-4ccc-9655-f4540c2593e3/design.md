# Design

## Context

See `proposal.md` for motivation and scope. The assigned change retains **spec-driven**, despite the checkout's current default being `abra-compact-v1`; do not change either schema to execute this issue.

Current seams at the retained base:

| Concern                                          | Existing owner / caller                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| Five instruction bodies                          | `.opencode/agents/{abra,explore,apply,review,research}.md`                |
| Separate Abra/lead host definitions              | `packages/runtime/src/config/host.ts:8-28`                                |
| Policy, fingerprint and native profile transform | `packages/runtime/src/opencode/role-policy.ts:12-165`                     |
| Engineering defaults and portable skill loading  | `opencode/engineering-skills.ts`, `opencode/skills.ts`                    |
| Composition and plugin-scope lifetime            | `opencode/application.ts:277-298`, `plugin/index.ts:49-74`                |
| Native selection and inventory                   | `opencode/runtime.ts:501-525,713-797,1068-1119`                           |
| Capture and guidance injection                   | `workflow/worker-context.ts:79-180,274-318`, `opencode/guards.ts:197-260` |
| Durable-before-prompt boundary                   | `workflow/sessions.ts:312-420`                                            |
| Model dispatch and execution snapshots           | `config/dispatch.ts`, `config/snapshot.ts`, `workflow/execution.ts`       |

`WorkerContextSchema` currently accepts version 1. Its guidance digest, exact prompt identity, policy compatibility and evidence-first preflight are safety contracts. Native `build` is the historical implicit worker selection; an explicit `workers.<role>.agent` is already validated against the **worker location**, not the central registry. Configuration currently always resolves a complete model from task/repository dispatch, role override or the required default.

`docs/supported-apis.md:211` claims transforms cannot create agents. The accepted plan identifies pinned 2.3.0 `editor.update` missing-ID insertion as the intended supported route. This worktree has no `node_modules`; Explore has not inspected installed declarations or run native proof. Apply must verify that route with the pinned declarations and real disposable server before relying on it, and replace the stale claim with actual evidence. No dependency installation, shell verification or browser journey was performed during planning.

## Goals / Non-Goals

**Goals**

- Make the package a deep module: callers choose a definition and provide immutable facts; preparation resolves instructions, requirements, capabilities and a serializable profile without callers parsing Markdown or knowing native transforms.
- Keep three boundaries separate: definition authorship, immutable assignment preparation, and native registration. State, admission/retry decisions and authorization remain runtime-owned.
- Preserve exact historical authority while changing defaults for genuinely new executions.
- Prove behavior through public package services, current controller seams and the real pinned native registry/request path.

**Non-goals**

- No workflow-role expansion, generic orchestration framework, dynamic module discovery, sandbox for untrusted callback code, extra frontend or embedded OpenCode host.
- No new checkpoint authority, implicit recovery of incomplete effects, host trust changes, active-definition hot reload or rewrite of old captures.
- No migration of runtime controller/tool-handler implementations into the package.

## Decisions

### 1. Domain vocabulary and ownership

| Term                | Meaning and distinguishing example                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Definition          | Stable authored agent identity and behavior/capability recipe. `review` is a bundled definition; an additional specialist can be selected for the existing Review role.                                      |
| Assignment role     | Existing enforced controller role, not inferred from a definition name. A specialist selected for Review still cannot write. Project Lead is a management identity, not a fifth implementation worker phase. |
| Native profile      | OpenCode-selectable execution configuration. `workers.review.agent` names this, not a catalog definition.                                                                                                    |
| Static revision     | Digest of resolved, task-independent profile material and contribution descriptors. Source instruction changes produce a new managed worker native ID.                                                       |
| Prepared assignment | Captured definition selection, static profile, resolved requirements, named task fragments and instruction-delivery provenance bound to one prompt identity.                                                 |
| Available skill     | Discoverable and loadable through native skill tooling; not automatically included or proven consumed.                                                                                                       |
| Preload skill       | Explicitly resolved skill body included during preparation, with identity/digest/provenance. It grants no permissions.                                                                                       |
| Dispatch profile    | Existing named complete **model** selection; distinct from a native agent profile and an agent definition.                                                                                                   |

Keep these distinctions in package API documentation and configuration docs. Do not rename existing durable IDs or introduce competing native session/model brands.

Dependency direction:

```text
@abracode/contracts <- @abracode/agents <- @abracode/runtime
                     (host capable)
@abracode/contracts <- browser/presentation consumers
```

`@abracode/agents` may use Effect 4.1.4 and pinned native plugin/schema types; never runtime. Browser-safe data projections, if needed, belong in contracts and contain no host imports. Export explicit package entrypoints for definition/services, bundled implementations, policy and native adapter rather than source-directory imports.

**Alternative rejected:** extracting only Markdown or introducing a runtime-owned facade. That leaves callers coordinating policy, registration and preparation and does not deliver the agreed programmable interface.

### 2. Common service, six implementations and catalog

Use Effect 4 `Context.Service`:

```ts
interface AgentService {
  readonly definition: AgentDefinition;
  readonly prepare: (
    input: PrepareAgentInput,
  ) => Effect.Effect<PreparedAgent, AgentDefinitionError>;
}

class Agent extends Context.Service<Agent, AgentService>()("@abracode/agents/Agent") {}
```

Export `AbraLive`, `ExploreLive`, `ApplyLive`, `ReviewLive`, `ResearchLive` and `ProjectLeadLive`, all implementing this common tag through one preparation engine. Alias the native schema namespace as `NativeAgent` where necessary to avoid confusing it with the service.

Build each implementation in a **separate Context** in the caller's scope, extract its common-tag value, then collect the six values into `Agents`. Never merge six layers publishing `Agent`: a merge would overwrite the common tag. Catalog construction rejects duplicate stable IDs. `list`, `get` and `prepare(id, input)` are traced Effects with explicit unknown-ID/definition errors, not silently substituted defaults.

A concrete caller shape, with names illustrative except the agreed public services:

```ts
const prepared = Effect.gen(function* () {
  const catalog = yield* Agents;
  return yield* catalog.prepare("review", {
    role: "review",
    task: immutableTask,
    repository: immutableRepository,
    configuredModel: capturedModel,
  });
});
```

The result supplies the resolved static profile plus named assignment fragments and requirement evidence. It does not create a native session, reserve capacity, submit a prompt or retry a controller operation.

Additional definitions use the same construction/preparation path. A seventh fixture specialist is registered programmatically with a read-only custom tool, one available-only skill, one preloaded skill and an injected context dependency. It runs under an existing compatible role. No new YAML module path, arbitrary import or production fixture flag is introduced.

**Alternative rejected:** six unrelated tags or a name-switch in runtime. Either hides the substitutable common interface or makes every specialist require runtime edits.

### 3. Authoring and preparation engine

The authored definition supports:

- Stable definition ID, description, mode, supported assignment-role compatibility and optional complete native model preference.
- Ordered instruction sources: package-relative file assets and inline fragments. Move the five bodies unchanged in meaning; inline the current project-lead guidance from `config/host.ts`.
- References to existing native/runtime tools, plus typed custom contributions retaining input/output schema and Effect handler types.
- Skill references/contributions classified as available or preload, with required skill/tool declarations distinct from discovery.
- An Effect context provider returning uniquely named fragments from immutable, bounded task/repository inputs.
- Permission restrictions constrained by the selected assignment role.

Split task-independent resolution from assignment-specific preparation internally. Resolve file instructions and preload content using injected Effect `FileSystem` and `Path`; resolve locations relative to the installed package/assets and supplied canonical skill root, not `process.cwd()` or a developer checkout. Skill bodies remain in `.agents/skills`; package metadata points to them rather than maintaining copies. Preserve native `abra-*` identifiers and existing role/workflow engineering selection.

Layer construction supplies provider/tool callback dependencies and retains their Effect environment for callbacks. The provider receives a copied/frozen readonly input view, not `Controller`, mutable execution records, native lifecycle methods or a hidden service lookup into runtime. Typed custom handler errors map to native recoverable tool failures; interruption/defects keep their category. Trace bounded operation/definition identities, never raw fragments, prompts or secrets.

No module-initialization I/O, direct host filesystem reads bypassing injection, nested `Effect.runPromise`/managed runtimes, or detached background work inside services. Registration acquisition and cleanup live in the existing host scope. Use the native Effect tool contract instead of converting handlers into private Promise runners.

`AgentDefinitionError` should distinguish unknown/duplicate identity, invalid definition, missing/unreadable source or skill, incompatible role/capability and provider failure with safe definition/source information. Native registration errors are typed separately at the adapter boundary and mapped once into existing runtime diagnostics.

**Alternative rejected:** task-specific instructions inside native profiles, implicit preloading of every available skill, or providers invoked by the context hook. These respectively leak facts across assignments, change current conditional-use behavior, or drift/repeat effects on every request.

### 4. One policy owner and constrained custom tools

Move the existing policy tables, requirement combination, engineering selection and fingerprint algorithm to the package. Preserve ordering and the exact `{ version: 2, role, ...policy }` digest input for the existing five managed roles. Preserve protected-control-path behavior, browser-only shell resources, external read roots and assignment-change editing. Add the current lead restriction as its own management policy without changing any worker role set or historical fingerprint.

Runtime keeps active-assignment/generation checks, realpath/path/move validation, diagnostic provenance, lead scope checks and all lifecycle guards. They import package policy rather than duplicate allowlists. Native session permissions use the same policy, narrowed to assignment scope. An agent's shared static permissions never contain another issue's change name or scratch path.

Custom tools are trusted authored code, not an untrusted code-execution facility. Their declaration must bind a stable contribution ID/revision, typed schemas and an existing permitted capability action; the read-only specialist uses the existing read authority. They cannot claim a new management permission, use reserved `abra_*` identities, collide with native tools or substitute for an existing runtime handler. Request filtering recognizes only contributions captured for the current definition/assignment. Execution authorization rechecks exact current assignment, role and declared permitted capability. Any editing/shell contribution must additionally use the existing scoped path/command authorization rather than becoming a bypass; unsupported authorization shapes fail closed.

Preserve built-in native tool eligibility and fingerprint bytes; adding a safe custom contribution does not rewrite the role policy. Existing endpoint authorization remains necessary even if the native tool was visible. Test direct invocation, not only filtered request lists.

**Alternative rejected:** unioning arbitrary definition permissions into role allowlists or treating tool requirements as grants. Both violate the agreed role ceiling.

### 5. Native adapter and static profile revisions

`OpenCodeAgents` is an Effect service for scoped registration. Its live layer receives the actual plugin `ctx` at construction, plus small injected dependencies for installed sources, location classification, captured-profile reads and contribution authorization. These callbacks carry data/typed effects, not a package dependency on runtime.

Map resolved instructions to native `system`, and description/model/mode/permissions to their pinned native fields. Register through the pinned agent transform; tools and skills use their corresponding native transforms. Existing runtime tools remain registered exactly once by `registerTools`; bundled definitions reference them. Replace the split registration in `installRoleProfiles`/`registerSkills` with one composed package adapter path, retaining runtime-only wrapping and handlers where appropriate.

- Central: stable `abra`, primary/visible/default, explicitly configured model; stable hidden `project-lead` and its existing one-tool authority. Retain central-only management and native user entry behavior.
- Owned worker locations: hidden managed profiles selectable by the controller; no package-created visible Abra entry point, scheduler or management service.
- Unrelated native tools/skills/project instructions remain intact.

Derive worker native IDs from a canonical serialization of resolved static profile data: definition identity, instructions, description, mode, model preference, role-constrained permission template, preload content/digests and contribution descriptors. Include source **content**, not installation absolute path, in revision identity. Exclude issue text, repository facts, session/prompt ID, selected session model, assignment fragments and assignment-specific permission roots. Keep the complete digest with the captured profile and detect ID/content conflicts.

`PreparedAgent` separates serializable data from live callbacks. Persist profile data, instruction-delivery identity, skill/tool provenance and contribution compatibility revisions; never serialize functions, Layers or Contexts. Authored callback/contribution revisions identify which installed implementation can execute captured behavior. Missing compatible implementations block, not substitute.

Worker plugin activation registers its bundled static profiles and restores profiles loaded from retained assignments for that exact owned location before inventory is exposed to preflight. A central plugin context is not a remote registry editor: each worker-location plugin owns its own transforms. Retained profile reads are injected by runtime; package registration does not discover executions or gain controller authority. Startup must avoid a registration/preflight activation cycle and verify actual active-plugin readiness, not just an open port.

Use native registration as the instruction owner; generated host configuration supplies bootstrap/plugin/default-agent settings or package-derived fields only where required. Do not keep a second Abra/lead body or a `{file:.../.opencode/agents/...}` prompt. Prove the pinned field mapping and creation of absent IDs against a real server.

**Alternative rejected:** stable mutable worker IDs, filesystem agent copying or central-only registration. They respectively change active work after restart, overwrite repository configuration, or fail worker-location discovery.

### 6. Definition and model selection captured at execution creation

Add optional `workers.<role>.definition`, separate from `agent`. Default new selections to `explore`, `apply`, `review`, `research`. Static YAML validation checks shape without starting services or invoking providers. Catalog-dependent validation uses the supplied catalog and reports unknown/incompatible definitions with the configuration field. Programmatic consumers can supply extra catalog entries; there is no dynamic module loader.

New execution snapshots distinguish the new selection generation from legacy snapshots and retain each selected definition ID, static revision/material needed for later role preparation, native override and existing complete model/provenance. Resolve task-independent definition material before capturing new execution settings; do not run task context providers for roles that have not been assigned. Later phases use the captured static material, not newly edited catalog defaults. If a later provider/custom implementation is incompatible with captured compatibility revisions, block for explicit recovery rather than silently use its replacement.

Preserve model precedence exactly: explicit task selection; task-selected model profile; repository selection/profile; role override; required application default. Definition model preference is only a fallback for a programmable consumer with no configured selection; normal AbraCode always has a required default. It must not become a new precedence tier above that default. Continue complete model/variant validation and explicitly set the native session model at creation/dispatch (`switchModel` for reused sessions).

No marker/definition field in an old snapshot means **legacy selection**, not the bundled default. Preserve explicit captured native agent or historical implicit `build`, captured model and original requirements for old contexts. Executions without configuration snapshots must also take the historical branch rather than accidentally reading new package defaults from current config. Only deliberate new execution adopts the new default. A legacy fresh turn may read relocated role assets where the previous path read current guidance; that does not relabel or rewrite any older capture.

**Alternative rejected:** defaulting new fields during legacy decode or reusing `agent` as a definition selector. Either silently rebinds active work or breaks existing native overrides.

### 7. Preparation retention, request assembly and recovery

Keep runtime as durable assignment owner. Reorder the existing admission seam as necessary:

1. Under existing execution ownership, retain the prospective session/prompt identity and preparation intent before invoking assignment providers. Obtain selected static definition material from the execution snapshot.
2. Prepare once, using immutable task/repository facts and injected dependencies. Concurrent callers cannot prepare the same identity independently.
3. Persist a new versioned context payload with exact static profile, captured fragments, requirements, selected native agent/model and delivery provenance; publish it as the active context using existing guarded record updates.
4. Ensure the required profile is available at the owned worker location before new inventory checks. Validate skills there and required tools after native model shaping. Create/reuse the retained session identity, set explicit model/profile and assignment-specific permissions, then admit the exact retained prompt under the existing durable admission boundary.

The exact staging between preparation and inventory may separate static and skill-resolution fields, but **all required prepared evidence must be complete and retained before prompt submission**. Do not publish incomplete evidence as a usable context or lose independently committed execution fields. Keep unsubmitted capacity release distinct from admission uncertainty.

A small runtime-owned preparation receipt/stage bound to the existing prospective prompt identity distinguishes started preparation from a complete captured payload. Once complete, neither hooks, repeated preflight, follow-up requests nor restart rerun the provider. If interruption/crash leaves only a started preparation, there is no proof the callback did not run: keep it unadmitted and surface a blocker requiring existing explicit recovery to a fresh assignment. Do not pretend arbitrary callback effects are exactly-once across a crash, or automatically rerun them under the old identity. Scope cleanup must still run.

New context version 2 carries prepared evidence; the decoder accepts original version 1 without mutating it. Maintain its original guidance path as historical provenance even though the source file was removed. Unknown versions or digest/profile/assignment mismatches remain preserved and unavailable. Retained payloads must stay immutable and bounded diagnostics must omit full prompts/fragments.

Request assembly has explicit branches:

| Capture / selection         | Static instruction delivery                                                                       | Assignment fragments                  |
| --------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------- |
| v2 package-native profile   | Native `system` already owns the captured static instructions; hook does not append them again    | Captured named fragments only         |
| v2 external native override | Preserve external native system; hook adds captured managed static guidance once                  | Captured named fragments              |
| v1 context                  | Existing captured guidance injection, original native selection/skills                            | Existing retained prompt semantics    |
| Legacy without capture      | Historical compatible behavior/explicit blocker where evidence is required; no fabricated capture | No reconstructed historical fragments |

Restore exact captured managed profiles on restart before unadmitted prompt inventory validation. Already admitted IDs retain evidence-first reconciliation and never receive a second instruction because registration changed. Restore registrations without creating sessions or issuing prompts. Keep stable Abra/lead session identities and existing native model/form/permission checks.

**Alternative rejected:** rebuilding prepared context from current files on restart or rerunning providers as a recovery convenience. Both change the payload under an immutable prompt identity and risk duplicate effects.

## Risks / Trade-offs

- **Policy fingerprint drift from harmless-looking reorder/normalization** → Baseline exact policy/permission snapshots before moving code; test the actual prior capture against the new owner, not two copies of the new algorithm.
- **Native upsert/system mapping differs from the accepted pinned API assumption** → First implement a bounded real-native registration regression; stop the dependent adapter work and report the exact incompatibility rather than copying files or weakening tests.
- **Cold worker activation deadlocks on central catalog/profile lookup** → Worker-local adapter loads static package definitions and injected retained data without preflight/controller admission recursion; exercise a foreign location with no role files.
- **Captured callbacks cannot be serialized across code upgrades** → Persist static data/fragments and implementation compatibility identities; never execute a replacement callback to claim historical compatibility. Incomplete preparation remains explicit and unadmitted.
- **Custom tools are authored executable code** → Treat authors as trusted application code; enforce declared role/action/assignment entrypoints and preserve existing trusted-process limitations. Do not advertise this as an untrusted-code sandbox.
- **Removing discovered files breaks tests or relocatable startup** → Migrate all readers, seeded fixtures, host generation and installation checks before deleting only the five owned sources.
- **A passing unit registry fake misses native shaping/instructions** → Assert actual provider request system/tool list and real worker-location inventory/skill loading under pinned OpenCode.
- **Test runner skips the new package** → Add package tests to existing Vite+ projects, package type/Effect checks and frozen installation/boundary regressions.
- **Toolchain unavailable in the worker** → Use the authorized supported Node 26.4+/pnpm environment. The central observation `mise exec -- node --version` = `v26.13.0` is not proof of worker readiness; ordinary shell Node was reported as `v24.22.2`. Do not modify host trust or install tools to conceal a prerequisite failure.

## Migration Plan

1. Add the package and baseline contract tests; leave existing consumers intact until the API/policy parity is proved.
2. Introduce new selection/capture contracts and compatibility decoders before switching defaults. Preserve originals and unknown additive retained evidence.
3. Compose catalog/native services in `applicationLayer`, under the `Layer.build` context retained by plugin scope. Inject package services at existing workflow/runtime seams, including test `createWorkflow` callers; do not add private runtimes.
4. Switch new execution defaults and request assembly; migrate fixtures and all instruction/skill/profile readers.
5. Remove only the five duplicate discovered files after confirming no live consumer remains. Historical serialized paths are permitted as provenance, not live instruction reads.
6. Update schema/examples, API evidence and verification docs; run focused proof and final required checks/journeys.

Deployment remains the existing explicit configuration/apply/restart procedure, not active-work hot reload. Native human plan/merge forms retain their current owners. Rollback before deployment is a normal source revision; after new prepared records exist, an older binary is not assumed able to run them. Preserve/export records and use a version supporting their format, rather than deleting fields/profiles or replaying uncertain assignments.

## Verification Plan

Use the existing `docs/testing.md`, `.agents/skills/testing/SKILL.md` and `docs/verification/README.md` harnesses. Apply supplies observed results; this document is a plan, not passed proof.

| Proof boundary          | Cases / observation                                                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package public services | Six implementations in separate Contexts; catalog list/get/duplicate/unknown; correct guidance, policy, skills and native mapping                                                                          |
| Seventh specialist      | Generic authoring, typed custom tool execution/result validation, available versus preload, injected context provider, existing-role ceiling                                                               |
| Effect environment      | Injected FS/Path and provider service, source/provider failures, interruption cause, no partial admission, scoped registration cleanup                                                                     |
| Policy/guards           | Exact prior fingerprints/permission resources; Review read-only; Explore change-only paths and move/symlink refusal; Apply owned scope; forbidden worker management/delegation; direct custom invocation   |
| Selection               | Omitted definition default, explicit external agent, both selectors together, unknown/incompatible definition, full task/repository/profile/override/default matrix and explicit session model             |
| Retained formats        | v1 capture and legacy snapshot fixtures through actual decoders; no retroactive defaults; v2 round trip/tamper refusal; changed source/config/catalog across restart/later phases                          |
| Admission               | Provider counter once through requests/restart; incomplete preparation interruption blocked; capture-before-submit; lost-response/native-evidence reconciliation with unchanged ID and no extra prompt     |
| Real native             | Absent-ID insertion, native `system` fields, central/worker profile visibility and location discovery, real skill loading, effective filtered tools and single instruction occurrence in observed requests |
| Packaging               | New package included in checks/discovery, boundary invalid-import fixtures (including type-only and reverse runtime dependency), frozen relocated installation with no removed-file reads                  |

Run focused `pnpm test:one <file>` and affected checks while editing; select asset/subprocess tests explicitly. At handoff run `pnpm check` and `pnpm test:all`, preserving any additional configured verification commands.

Extend the existing engineering/full-spec disposable native journey rather than adding a separate app or test scheduler. Run:

```sh
ABRACODE_TEST_JOURNEY=engineering \
ABRACODE_TEST_EVIDENCE_DIR=/tmp/opencode/abra-agents-<unique-run> \
  pnpm test:one packages/runtime/tests/extended/native.test.ts
```

Use a fresh caller-created evidence directory outside the fixture root and retain command output plus `native-engineering.json`/cleanup evidence there. Extend the journey's existing evidence fields for definition/profile revision, actual request instruction counts, skills/tools, provider-preparation count and unchanged admission IDs. Health requires actual `server.info()` and active worker plugin. Exercise preparation/capture, native action, restart restoration and cleanup. The final evidence must show successful test exit and `result: pass`, `cleanup_complete: true`, with files still readable after teardown. Run affected extended installation coverage as well because frozen source/asset ownership changed.

Never start/restart the operator service or push to user remotes. Stop only fixture-owned resources. Missing supported runtime, frozen supplier cache or browser prerequisites are concrete blockers, not permission to install or weaken expectations. Native deterministic-provider proof establishes integration and boundaries, not autonomous model quality or live-provider/forge readiness.
