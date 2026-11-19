# Proposal

## Why

AbraCode currently spreads agent definitions across discovered Markdown, generated host configuration, role policy, skill registration and worker-context assembly. A host-capable Effect package should own the six agents and expose a usable programmable interface now, while the existing runtime retains controller authority and immutable admission evidence.

## What Changes

- Create `packages/agents` (`@abracode/agents`) with a common Effect 4 `Agent` service, six named live implementations, an extensible `Agents` catalog, shared preparation and scoped `OpenCodeAgents` native registration.
- Support authored instruction sources, native tool references, typed custom tool contributions, available versus preloaded skills, model preferences and Effect context providers receiving immutable task/repository inputs.
- Move the five current role instruction bodies into package assets and inline project-lead guidance into its definition. Remove the duplicate discovered role files only after migrating every consumer and fixture. Keep reusable skill bodies canonical under `.agents/skills`.
- Move role policy and engineering-skill selection into the package without changing existing policy fingerprints or permissions. Runtime guards and native permissions consume that same owner.
- Make revisioned package-native worker profiles the default for new executions at owned worker locations; keep Abra central/visible and project lead hidden under their stable identities. Preserve explicit native `workers.<role>.agent` overrides.
- Add optional `workers.<role>.definition` selection, defaulting to the bundled role definition. Support additional catalog definitions programmatically, without adding workflow roles, module loading or configuration UI.
- Retain definition selection in new execution snapshots and a versioned, serializable prepared payload before prompt admission. Restore captured profiles before native inventory checks; inject captured assignment fragments without rerunning providers or duplicating package instructions.
- Preserve legacy selection, captured guidance/skills/model/request IDs, configured dispatch precedence, explicit session model selection, uncertain-admission reconciliation, request/execute authorization and all human checkpoints.
- Update schema generation, package/import checks, test discovery, relocated installation fixtures and documentation. Replace the outdated native-registration claim with pinned OpenCode 2.3.0 regression evidence.

## Capabilities

### New Capabilities

- `programmable-agents`: Effect-based definition authoring, preparation, catalog composition and scoped native registration of bundled and additional agents.

### Modified Capabilities

- `worker-context`: Package-owned default worker profiles; prepared assignment capture, instruction delivery, profile restoration and legacy compatibility.
- `worker-policy`: Package ownership of the authoritative policy and constrained definition/contribution capabilities without additional authority.
- `application-configuration`: Independent definition/native-profile selectors and captured definition selection while preserving existing model dispatch.

Unchanged contracts in `project-leads`, `worker-engineering`, `typed-contracts` and `release-distribution` remain acceptance constraints, not new capabilities.

## Impact

- New workspace package; runtime depends on agents; agents may depend on contracts, Effect and pinned native schemas/plugin types, never runtime. Browser and portable-rendering consumers must not import this host-capable package.
- Runtime integration: `opencode/application.ts`, `plugin/index.ts`, `opencode/runtime.ts`, guards, skill/tool registration, configuration/host generation, execution snapshots, worker contexts and session admission/recovery.
- Assets/consumers: `.opencode/agents/{abra,explore,apply,review,research}.md`, fixtures and installation/native journeys; skill procedure sources do not move.
- Verification: package tests, controller/context/policy/configuration regressions, real pinned native registration/discovery/filtering/restart proof, relocated installation and required repository checks.
- No standalone application, embedded-host migration, frontend specialist, AG-UI change, scheduling/delivery/onboarding redesign, duplicate runtime tool handlers, host trust changes or active-work hot reload. Human plan and merge forms remain mandatory where captured policy requires them.
