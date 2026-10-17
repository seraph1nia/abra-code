# Proposal

## Why

OpenCrew already specializes its Supervisor, Explore, Apply, Review and Research roles, but permissions overlap across Markdown frontmatter, native session creation and tool hooks. Cross-repository workers receive assembled context without a retained explanation of its sources or an explicit check that required skills and effective tools are available, making drift and missing capabilities hard to diagnose.

## What Changes

- Define one typed policy for the existing roles, deriving native permissions, tool filtering, path constraints and execution checks from it while keeping behavioral guidance in Markdown.
- Retain an explicit, versioned context manifest for each new managed worker admission: assignment, accepted scope references, role guidance, selected agent/model, required skills/tools, instruction and artifact references, retained decisions and provenance.
- Expose bounded context summaries, requirement-resolution failures and observed effective tools through `crew_work_diagnostics`, including failures that happen before a session exists.
- Add optional `workers.<role>.required_skills` and `required_tools` declarations. These state prerequisites within the role's existing authority; they do not install skills, create tools or grant permissions.
- Resolve required skills at the assigned worktree location before admission; validate tool requirements against role policy before admission and against actual model-visible tools before the provider request. Support native editor alternatives such as `patch` replacing `edit`/`write`.
- Preserve native `build` fallback, configured agent/model behavior, independent sessions, managed-repository instructions, stable retry identities, controller checkpoints and the trusted-shell boundary.

## Capabilities

### New Capabilities

- `worker-policy`: One authoritative role policy with derived native enforcement and no implicit capability grants.
- `worker-context`: Explicit context assembly, required capability resolution, retained provenance and bounded diagnostics across repositories and restarts.

### Modified Capabilities

- `native-supervision`: Extend worker-location admission validation to required skills and tools, distinguishing pre-admission checks from final request-time tool validation and preserving uncertain admissions.

## Impact

Affects `src/opencode` policy, skill registration, runtime and guards; `src/workflow` session admission, prompt assembly and diagnostics; configuration and native storage/output schemas; central agent definitions and Supervisor configuration; and associated tests and operational/API documentation. No new dependency or host upgrade is intended. Existing configuration remains valid with empty additional requirements, and existing records remain readable without fabricated context evidence.

The scope excludes new specialist roles, external browser/MCP capability grants, automatic skill installation, repository instruction copying, a new UI or orchestration engine, and OS sandboxing. Those require separate decisions if later requested.
