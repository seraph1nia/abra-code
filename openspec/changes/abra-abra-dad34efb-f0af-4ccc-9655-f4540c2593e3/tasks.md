# Tasks

Implementation starts only after controller validation and the required native human plan approval. Do not answer that form, change approval policy or treat this checklist as authorization. See `design.md` for dependency direction, capture compatibility and verification boundaries.

## 1. Establish package and compatibility baselines

- [x] 1.1 Confirm the assigned Apply environment has supported Node 26.4+, frozen pnpm and required local dependencies using authorized commands; retain actual versions and any prerequisite blocker without changing host trust, installing host tools or touching the operator service.
- [x] 1.2 Add `packages/agents` as `@abracode/agents` with declared exports, package-local TypeScript/Effect checks and the runtime workspace dependency; update lockfile/workspace check integration and verify a frozen package installation resolves the new package without runtime-to-source imports.
- [x] 1.3 Include package tests in the existing Vite+ unit/integration discovery and package Effect diagnostics; add a small discovered public-export test and verify it runs via `pnpm test:one <new-test-file>` and the package check.
- [x] 1.4 Capture existing role policy fingerprints, native permission resources/order and engineering requirements in regression fixtures before moving them; verify the fixtures against current production helpers and retain representative original v1 context/legacy snapshot inputs.

## 2. Prove the pinned native registration seam

- [x] 2.1 Inspect pinned OpenCode 2.3.0 agent/tool/skill transform declarations and add a bounded regression in the disposable native harness that inserts an absent agent ID with `editor.update`; verify actual native inventory and system/description/model/mode/permission fields rather than a registry fake.
- [x] 2.2 Exercise transform scope closure and unrelated native entry preservation in that regression; verify only the test scope's registrations disappear and no session/prompt is created by registration.
- [x] 2.3 Correct the obsolete cannot-create-agents claim in `docs/supported-apis.md` using the observed pinned API/test evidence, explicitly distinguishing host config `prompt` from native profile `system`; verify documentation cites the exercised regression and does not claim unrun behavior.

## 3. Implement programmable definitions and Effect services

- [x] 3.1 Define the authored definition, immutable preparation input, named fragment, serializable prepared profile/evidence and typed failure contracts; verify schema/type tests reject malformed identities, duplicate fragment names and invalid tool contracts while preserving native ID/model types.
- [x] 3.2 Implement the common `Agent` Context.Service and shared preparation engine using injected FileSystem/Path, ordered inline/file instructions, available/preload skills, permission constraints and traced typed failures; verify public preparation tests cover ordering, injected paths/files, source failures and no import-time I/O.
- [x] 3.3 Implement dependency-bound Effect context providers and typed custom tool contributions without nested runtimes; verify provider failure/interruption cause, immutable inputs, retained schema/handler types and scope cleanup with controlled dependencies.
- [x] 3.4 Add `AbraLive`, `ExploreLive`, `ApplyLive`, `ReviewLive`, `ResearchLive`, `ProjectLeadLive` and the catalog; build each common-tag implementation in a separate Context and verify six distinct list/get/prepare results plus explicit duplicate/unknown-definition errors.
- [x] 3.5 Add the seventh fixture specialist using an existing role, typed read-only tool, available-only skill, preload skill and injected context service; verify the generic catalog/preparation path works without special workflow handling, with only the preload body automatically included.
- [x] 3.6 Document the package caller interface, dependency injection, error/cleanup ownership and definition/native-profile/dispatch-profile distinction alongside the package; verify the documented example is exercised by a compiling service-level test.

## 4. Move canonical instructions, policy and skill selection

- [x] 4.1 Move the five role bodies into package-owned assets and define current lead guidance inline, preserving identity/boundaries and procedure references; verify all six preparations have the correct guidance without frontmatter leakage while retaining the old discovered files until consumers migrate.
- [x] 4.2 Move policy/fingerprint, native-permission derivation, capability combination and engineering selection into the package, including existing lead restrictions; verify the baseline fixtures from 1.4 match exact old fingerprints/permission resources and existing conditional engineering/Research behavior.
- [x] 4.3 Migrate runtime policy consumers, configuration validation and assignment guidance to the package owner; verify role-policy, patch-guards, worker-context and engineering-skill regressions still enforce Review read-only, Explore change-only, Apply owned scope and worker management/delegation refusal.
- [x] 4.4 Implement shared custom-contribution eligibility and runtime-injected execution authorization; verify a current eligible specialist can execute its read-only tool, while reserved-name collisions, forbidden actions, stale/wrong-role/direct calls and unsupported scope-authorization shapes fail closed without altering policy fingerprints.
- [x] 4.5 Document canonical asset/policy/procedure ownership in existing architecture/instruction docs; verify native `abra-*` skill IDs and `.agents/skills` bodies remain single-source and no generated OpenSpec skill body is customized.

## 5. Integrate scoped native registration

- [x] 5.1 Implement `OpenCodeAgents` and its live layer receiving native plugin context, with profile/tool/skill transforms and typed native errors; verify the service uses the existing host scope and the pinned native regression exercises prepared definitions rather than parallel hardcoded registration.
- [x] 5.2 Generate revisioned hidden worker native IDs from canonical resolved static material, excluding task facts and installation paths; verify instruction/preload/static-field edits change revision, relocation/task/model-dispatch facts do not, and ID/content conflicts are refused.
- [x] 5.3 Compose catalog/native services into `applicationLayer` and retain their Context for callbacks through existing `Layer.build`; migrate split profile/skill registration and inject existing runtime tool references without duplicate handlers, verified by Effect lifetime tests and native registry counts.
- [x] 5.4 Register stable central-only visible/default Abra, hidden current-identity lead and hidden controller-selectable worker-location profiles; verify foreign worker discovery without central role files, correct active-plugin readiness, stable central/lead identities and preserved unrelated repository tools/skills.
- [x] 5.5 Replace duplicated host-generated Abra/lead bodies and removed-path prompts with the package-owned registration/bootstrap route; verify configuration and relocated startup tests select the explicit configured model and contain no second instruction copy.

## 6. Add independent definition selection and retained configuration

- [x] 6.1 Add optional `workers.<role>.definition` to input/resolved configuration while preserving `agent` as an independent native override; verify omitted defaults, combined selectors, malformed/unknown/incompatible selections and catalog-dependent diagnostics without a dynamic loader or service side effects.
- [x] 6.2 Capture new per-role definition selection/static revision material and compatibility identities in execution snapshots before assignment, without running unassigned-role providers; verify configuration/catalog edits between phases cannot replace captured selection or static instructions.
- [x] 6.3 Add explicit legacy-snapshot/no-snapshot decoding and selection branches; verify later legacy role admissions preserve historical explicit-agent or implicit-build behavior and models until a deliberate new execution, without fabricating definition provenance.
- [x] 6.4 Preserve task/repository/model-profile/role/default precedence and definition preference only as an unconfigured-programmatic fallback; verify the dispatch matrix, variant noninheritance, unavailable selections and explicit native session model creation/switching.
- [x] 6.5 Regenerate `abracode.schema.json`, update the tracked example and configuration/operator docs for both selectors and offline inspection limits; verify generated-schema consistency and existing read-only configuration tests without executing context providers.

## 7. Capture prepared assignments and preserve admission recovery

- [x] 7.1 Add version 2 worker-context prepared evidence and lossless original v1 decoding, including static profile, fragments, requirements, selection/delivery provenance and integrity checks; verify round trips, tampering/unknown-version refusal and original fixture identities/guidance/skills/model/request IDs.
- [x] 7.2 Integrate package preparation at the existing session-admission seam with retained prospective identities and a runtime-owned preparation stage; verify provider invocation once under concurrent preparation, capture-before-prompt, scoped failure cleanup and no submission of partial preparation.
- [x] 7.3 Make interrupted/incomplete preparation unadmitted and explicitly recoverable only as a fresh authorized assignment; verify crash/interruption after provider start does not automatically rerun that provider or leak uncertain capacity under the old identity.
- [x] 7.4 Implement captured-profile restoration at the exact owned worker location before new-admission inventory checks, with injected retained-profile loading and compatible contribution checks; verify cold restart does not deadlock activation, read current source to reconstruct a profile or silently replace unavailable callbacks/tools.
- [x] 7.5 Change request assembly to inject captured fragments without providers, add managed static guidance only for external overrides and retain v1 guidance semantics; verify repeated real/model-shaped requests contain static instructions once, preserve override/repository instructions and do not preload available-only skills.
- [x] 7.6 Preserve evidence-first uncertain admission and existing prompt/session/generation guards across profile restoration; verify lost-response/source-edit/restart regressions retain the exact capture and ID with no duplicate prompt/session or retroactive skill additions.
- [x] 7.7 Extend bounded context diagnostics and documentation with definition/profile revision and preparation blockers without full private fragments/prompts; verify reads remain nonmutating, legacy provenance is explicit and forbidden/stale effective tools still stop provider calls.

## 8. Complete consumer migration and packaging proof

- [x] 8.1 Migrate controller fixtures, asset readers, engineering-recovery seeds, configuration assertions and OpenSpec-update fixtures to package ownership; verify focused worker-lifecycle/context/engineering/configuration/update tests while retaining intentional historical serialized paths only as provenance.
- [x] 8.2 Remove only `.opencode/agents/{abra,explore,apply,review,research}.md` after consumer migration; verify no live reader or fixture requires those paths and that unrelated native agent files, instructions and user work are preserved.
- [x] 8.3 Extend workspace-boundary lint/tests to reject agents-to-runtime and browser/contracts/presentation-to-agents imports, including type-only/dynamic/source-path variants; verify actual invalid-import fixtures fail and supported declared exports pass.
- [x] 8.4 Update relocated installation/package checks and asset coverage for the new workspace; verify the affected extended installation test starts from the frozen relocated install with canonical skills/package assets and no development-checkout dependency.

## 9. Retain integrated acceptance evidence

- [x] 9.1 Extend the existing engineering native journey and its full-spec feature recipe for real profile creation/discovery, skill loading, custom tool filtering, single instruction delivery, provider-once capture and source-edit/restart/override behavior; verify the journey still exercises real human plan/merge boundaries and preserves additional configured checks.
- [x] 9.2 Run the affected extended disposable native engineering journey with a fresh external `/tmp/opencode/abra-agents-<unique-run>` evidence directory; retain invocation/output and actual request/profile/admission observations, verify successful test exit plus `result: pass` and `cleanup_complete: true` after teardown, and disclose deterministic-provider limits or exact missing prerequisites.
- [x] 9.3 Run final `pnpm check` and `pnpm test:all` on completed work, plus any additional captured repository checks; retain accessible results for independent Review and rerun affected proof if later edits invalidate it, without operating the user's service or remotes.

## Workflow follow-up

- Controller performs strict OpenSpec planning validation and presents the required native human plan form before Apply admission.
- Independent Review assesses current implementation and accessible proof against all four capability deltas, including compatibility and native acceptance evidence.
- Controller alone owns final checks, OpenSpec archival/canonical validation, commits, merge authorization, delivery, retirement and issue closure.

## Main integration verification

Codex integrated this implementation into main after verifying the controller repair, per the user's explicit direction. Final combined proof: `pnpm check`, `pnpm test:all` (800 tests), standalone E2E (43 tests), build, configuration schema, licensing, both native journeys and relocated installation. See [current integration evidence](../../../docs/verification/main-agent-integration.md). The original native worktree and execution history remain retained; this is not a native delivery or merge receipt.
