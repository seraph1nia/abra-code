# Proposal

## Why

AbraCode makes the full OpenSpec artifact package and repeated human handoffs the normal experience even for bounded work, although OpenSpec 2 supports smaller project schemas and AbraCode already supports automatic continuation and finite repair. Keep OpenSpec as the planning and task authority while reducing routine documents and interruptions, with explicit human review for consequential decisions and merge.

## What Changes

- Add a project-local `abra-compact-v1` OpenSpec schema: concise proposal, behavioral spec deltas and verifiable tasks, without a mandatory separate design document. Adopt it as this repository's default for new changes; retain `spec-driven` for deeper planning.
- Honor OpenSpec's `skip_specs: true` when the existing behavioral contract remains correct, so these changes need only proposal and tasks. Strict validation, tracked task completion and independent Review still apply.
- Add optional per-issue OpenSpec schema selection and a one-way request to require human plan approval. Retain these inputs in single/batch request identity, persisted issues and execution policy; an issue cannot waive repository-required approval or alter merge authority.
- Continue automatically from validated planning into Apply when the captured repository policy already permits it. Document an opt-in attended routine loop with two existing repair rounds, human merge approval and escalation for changed/uncertain scope or repeated failures. Preserve conservative shipped defaults and active execution policies.
- Bind new executions to the selected schema in the owned worktree and expose the schema, effective approval source and remaining repair allowance through existing status/diagnostics. Missing or changed schema inputs block rather than silently falling back.
- Update Abra's project-owned guidance to choose detailed planning and explicit human plan review for lifecycle authorization, persisted contracts, native integrations, migrations and deletion policy. Schema size and quality-profile labels do not confer authority.
- Preserve Explore, Apply and independent Review sessions, current checks, controller archival/delivery, exact-content merge forms and safe retirement. Reuse OpenSpec's native schema/configuration facilities; add no execution framework, generated-skill customization or new mandatory report artifact.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `work-policies`: Compact OpenSpec artifacts, schema-aware omission handling, retained schema selection, stronger task-specific plan gates and an inspectable opt-in automatic coding loop.

## Impact

- Planning assets: new `openspec/schemas/abra-compact-v1/`, `openspec/config.yaml`, project-owned instructions and documentation. This proposal itself uses the existing `spec-driven` schema; implementation introduces the compact one.
- Intake/persistence: `src/work/{model,intake,batch,graph}.ts`, native tool contracts and execution record compatibility, with additive SQLite migration and unchanged historical request identities.
- Execution: `src/openspec/{adapter,contracts}.ts`, `src/workflow/{execution,advancement,checks,worker-context}.ts` and existing policy/status projections. Reuse finite correction, admission, approval and recovery owners.
- Verification: real pinned-CLI compact/skip/detailed cases, intake and policy regressions, disposable native automatic/required-approval/repair/restart journeys, and required project checks.
- Personal `abracode.yaml`, registered policy and running services are not automatically changed. Existing changes/archives and unfinished chat-first implementation remain intact; no work is started, approved, delivered or retired by this proposal.
