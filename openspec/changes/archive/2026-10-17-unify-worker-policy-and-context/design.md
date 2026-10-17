# Design

## Context

See `proposal.md` for the motivation and scope. This change builds on the existing controller and four worker roles; it does not introduce another agent framework.

Observed implementation:

- `src/opencode/runtime.ts:createSession` constructs native permissions; `guards.ts:permittedTools` independently lists role tools. `installGuards` filters tools, rejects inactive sessions and validates file paths. Central agent Markdown and `opencode.jsonc` also contain permissions.
- Cross-repository sessions use `build` unless explicitly configured. The context hook reads the central role Markdown as system text. Its frontmatter is text in that path, not a native permission definition. No central agent files are copied into managed repositories.
- `skills.ts:registerSkills` registers four central procedures but only `crew-openspec-execution` at worker locations. Repository skills remain subject to native discovery.
- `runtime.ts:preflight` reads worker-location agent/model inventories and recognizes already-admitted prompts before new inventory checks. It currently verifies model tool support, not required skill identifiers or effective tool names.
- `workflow/sessions.ts` persists session/prompt identities but reconstructs `workerPrompt` on uncertain admission recovery. `Queries.diagnostics` largely returns session observations; a pre-session capability failure needs an execution-level projection.
- The context hook records post-filter tools at `worker-tools/<session>`, but this is a latest observation rather than an admission-bound context record.

The pinned declarations and `docs/supported-apis.md` establish the native seams: agent transforms update existing entries but cannot add them; `client.skill.list({location})` supplies worker-location skills; session context hooks expose actual request tools; tool execution hooks carry session identity. There is no verified client API here for previewing the fully shaped tools of a future worker request. `ctx.tool.list()` is a location plugin registry, not proof of another location's model-visible tools.

The active `integrate-spec-verification-review` change already extends Review's guidance and report contract. Preserve that working-tree behavior and the full-spec `spec_verification` requirement; this proposal does not supersede its Review policy.

## Goals / Non-Goals

**Goals:** A small policy seam shared by native adapters; explicit, replayable OpenCrew-supplied context; worker-location capability checks; and useful issue/role diagnostics before and after session creation.

**Non-Goals:** New worker roles, per-task permission escalation, arbitrary external tool profiles, copying repository control files, capturing every host instruction, replaying a whole Supervisor transcript, changing delivery approvals, or defending against hostile same-user shell processes. Frontend/backend/security expertise remains task guidance or a relevant skill within the existing role boundary.

## Decisions

### 1. Own role semantics in one typed policy module

Introduce `src/opencode/role-policy.ts` with a closed policy for Supervisor and the existing worker roles. Separate declarative role data from native encoders. The policy exposes allowed tool names, permission actions, file-write scope (`none`, `assigned-change`, `owned-worktree`), protected control-file rules, required capability groups and role guidance identity. Evaluate policy-dependent choices using the assignment and workflow; keep changing phase/session ownership in the controller.

Derive session permission rules, request tool filtering and execute-before tool authorization from that policy. Preserve the existing realpath/patch destination validation and the trusted Apply shell behavior. A shell command remains arbitrary same-user execution; a native file-write scope does not become an OS sandbox.

Remove independently maintained permission tables from Markdown/configuration. Retain native discovery metadata and prose in agent Markdown. At the central location, use supported agent transforms to apply derived permissions to already registered OpenCrew profiles, including Supervisor. At worker locations, apply the assigned role through session permissions and hooks, retaining `build` fallback and explicit-agent preflight. Do not add registry entries through unsupported transforms or rewrite target project agent files. Central manually invoked profiles are not a substitute for an assigned, controller-managed execution.

Alternative: make Markdown frontmatter authoritative and parse it into every guard. Rejected because file scope, active ownership, native action mapping and tool alternatives are typed controller concerns. Duplicated handwritten tables are also rejected because they preserve drift. The prose files remain editable without making their frontmatter a permission source.

### 2. Declare prerequisites without introducing permission profiles

Extend existing `workers.<role>` configuration with optional bounded arrays:

- `required_skills`: exact native skill identifiers, resolved at the worker location. No fuzzy name matching or fallback to the Supervisor registry.
- `required_tools`: groups shaped as `{ any_of: [<tool-name>, ...] }`. Every group must be satisfied. A single required tool is a one-element group.

Merge these additively with policy defaults. Validate nonempty identifiers/groups, duplicate normalization, bounded sizes and forbidden alternatives. Use exact existing tool names. A group containing an unauthorized alternative is invalid even if another alternative would be allowed. This does not provide an extension point for browser/MCP grants.

Policy defaults require core read/search/skill functionality plus phase-specific operations: planning/editing and `crew_spec` for full-spec Explore/Apply, development shell for Apply, the appropriate structured report tool for Review/Research, and the existing question/progress/wait protocol. Represent native editing alternatives as a group including `patch`, `edit` and `write`, with path enforcement applied to whichever is actually exposed. Do not require `crew_spec` or full-spec skills for lightweight/research work. Use policy-aware skill selection to preserve the existing portable registration behavior without injecting every central procedure.

Alternative: grant tools whenever a skill requests them. Rejected because a procedure is not authority. Automatic skill installation and filesystem search across unrelated homes are also out of scope. Operators resolve missing identifiers by configuring native discovery or explicit existing OpenCrew registration.

### 3. Assemble and retain an admission context at the session boundary

Introduce `src/workflow/worker-context.ts` for context assembly and `src/workflow/worker-context-contracts.ts` for owned schemas. Keep session transport in `NativeRuntime` and lifecycle sequencing in `WorkerSessions`; do not grow `runtime.ts` or `controller.ts` into a second policy implementation.

A versioned `WorkerContext` record contains:

- execution/issue/repository, generation, role, session intent/session and prompt identity;
- workflow, owned worktree, retained base and scope/approval reference;
- effective agent/model selection, policy version/digest and role guidance path/content digest;
- the exact OpenCrew-rendered admission text and role guidance required for resubmission, stored internally;
- relevant repository instruction and artifact references, with their observed source and availability;
- retained decisions appropriate to this assignment, and required skill/tool resolution;
- capture time and explicit provenance states.

The manifest describes what OpenCrew supplies. Repository files can change and native global/nested instructions can be discovered later; neither an instruction reference nor a skill inventory entry proves the model loaded it. Mark references as discovered, skills as available, and native loading as unobserved unless actual host transcript evidence establishes it. Do not claim to capture the model's entire context window. Reference large plans instead of duplicating them into every prompt.

Persist context records in native plugin storage, with an optional reference on the existing admission/execution state and an index by execution/role for failures without sessions. Keep immutable admission payloads separate from bounded latest resolution/request observations. Use existing schema/decode and record-commit conventions; include these records in the existing export/backup path. No SQLite task mirror or new database is needed.

Capture executable OpenCrew instructions and render prompt text once before submission. On an uncertain retry, inspect native evidence first and reuse the original prompt ID and captured text. If current enforcement is incompatible with the captured policy, retain a specific blocker rather than rerendering or loosening authority. A deliberate new turn creates a new manifest using current configuration and decisions; it does not overwrite the earlier payload. Answers delivered during an active conversation keep their existing steering/decision routes.

Alternative: reconstruct context from current issue/files in diagnostics or recovery. Rejected because it cannot prove what was supplied and can change an uncertain retry's meaning.

### 4. Use two capability validation stages

**Before prompt submission:** Resolve the effective model/agent with existing native semantics, validate declared tool groups against the role ceiling, and resolve required skills using `client.skill.list` at the assigned worktree. Verify usable content and the native skill loading route. Retain missing/ambiguous/unusable skill errors with the requirement's source, worker directory and clearing action. Skill references go into the supplied context for loading on demand; do not preload unrelated procedures. Preserve resource ownership and distinguish definitely unsubmitted failures from uncertain prompt custody.

**Before each managed provider request:** Reuse the existing context hook to apply the policy, inspect actual tools after native model shaping, check all required groups and retain the observed names/model/time against the active context. Read captured role guidance rather than silently replacing it with the latest central Markdown. Reject an unsatisfied capability before the provider request and retain a typed diagnostic for normal worker failure observation. Do not manufacture a successful preflight from registry names.

Keep execute-before authorization independent: request visibility, retained manifest contents and successful prerequisite validation never authorize an inactive or wrong-role call. Check assignment generation and current role/session before accepting request observations, so an old callback cannot overwrite a replacement worker's latest evidence.

On recovery, existing inbox/transcript proof takes precedence over new-admission inventory validation. Subsequent provider requests still enforce current role authority and compatibility; discovering drift does not replay an admitted prompt. Preserve existing capacity reservation, cancellation and external-custody behavior. Definitely unsubmitted blockers release active compute capacity after confirming no prompt was submitted; uncertain reservations remain conservative.

Alternative: promise all effective tool checks before queue admission using an invented preview API. Rejected because the pinned API evidence only supports definitive model-visible validation in the request hook. This plan deliberately distinguishes session creation, queued prompt admission and provider execution.

### 5. Extend existing diagnostics with provenance and blockers

Extend `crew_work_diagnostics` through `Queries.diagnostics` and its existing output schemas. Add execution/role context summaries even when no session exists; retain existing session/model/error fields. Show context identity, instruction/contract references, configured prerequisites and resolution source, actual tool observations/freshness, policy compatibility and a clearing action for each blocker.

Keep serialized summaries bounded using reference/count projections and explicit omitted counts rather than returning full stored prompt/guidance text. Never include environments, credentials, raw provider bodies or a reconstructed global prompt. Current inventory unavailable, captured provenance unavailable and tool loading unobserved are distinct states. Diagnostics reads do not write a new manifest, recover a worker or grant approval. No TUI redesign or new observer RPC is required for this change.

## Risks / Trade-offs

- **Native permission precedence or tool shaping differs from assumptions** → Verify against pinned declarations/source and the real deterministic-model E2E harness; document the exact hooks used before integrating. Never restore tools removed by the host.
- **Stricter defaults expose previously silent capability gaps** → Name the role, requirement and clearing action; retain owned resources. Existing configurations remain valid, but a session lacking capabilities necessary for its actual role is correctly blocked.
- **Required skills are available but never consumed** → Supply explicit references, keep loading lazy, and distinguish availability from observed loading; do not use availability as compliance proof.
- **Context capture duplicates prose or grows storage** → Store one immutable payload per admitted/attempted prompt, reference large documents, and retain only bounded latest observation summaries. Do not add automatic deletion in this change.
- **Captured instructions become stale during retry or an upgrade** → Reuse captured text for the same identity, refuse incompatible policy and require a new deliberate admission to change the payload. Native project-file references remain historical observations, not frozen file contents.
- **Sensitive issue text exists in stored admission payloads** → Keep payload access internal like existing native transcripts; diagnostic projections return identities/references and bounded safe status, not raw admission text.
- **Concurrent callbacks or partial writes corrupt provenance** → Persist payload before its execution pointer, fence observation updates by generation/session/prompt, and tolerate orphaned immutable payloads after interruption. Never infer a submitted prompt from a manifest alone.

## Migration Plan

1. Add schemas and shared policy with compatibility defaults. Replace duplicated enforcement sources without changing the existing five role boundaries; preserve current Review verification guidance.
2. Introduce optional context references and immutable native-storage records. Old execution records remain valid; label historic context `legacy_unavailable`. An already-admitted legacy prompt is observed without replay and retains existing role enforcement. Its next deliberate new prompt must use the new context contract.
3. Wire assembly and two-stage capability checks through new admissions, retries and corrective rounds. A failed preflight can be intentionally refreshed under a new context identity when configuration changes; no old payload is silently rewritten. Ordinary recovery can recheck availability for unchanged retained requirements.
4. Add bounded diagnostics and update configuration, operations, architecture, supported-API and testing documentation. Export context payloads with existing record backups so recovery does not depend on a retired worktree.
5. Run `pnpm check`, `pnpm test` and `pnpm test:e2e` using temporary repositories and deterministic providers. Exercise cross-repository defaults, custom agent absence, model-specific patch tools, prerequisite failures, denied calls, lost admission responses and native restart.
6. Roll back only after worker quiescence using the documented backup procedure. Retain new additive records; old code must not be used to reconstruct or replay a new-format uncertain admission. If rollback cannot interpret its retained intent, keep the newer recovery reader and reconcile first.
