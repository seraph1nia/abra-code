# OpenSpec instruction ownership

AbraCode uses OpenSpec 2.0.0. Generated workflows have one shared copy under
`.agents/skills/`: `openspec-propose`, `openspec-explore`,
`openspec-apply-change`, `openspec-update-change`, `openspec-sync-specs` and
`openspec-archive-change`. The `.openspec-target` file records Codex and OpenCode
as consumers of the same files. There are no duplicate skills or legacy commands
under `.opencode/skills` or `.opencode/commands`.

Invoke a workflow by its skill name or ask for it in ordinary language. Codex
also accepts `$openspec-propose`; OpenCode exposes `/openspec-propose`. Use the
corresponding skill name for apply, explore, update, sync and archive. Existing
`openspec/` planning artifacts, schemas, task files and archives keep their roles.

## Generated workflows and project-owned guidance

The six workflow files are the pinned CLI's generated output. `openspec update`
can replace those bodies. Do not add local rules there or change `generatedBy`
by hand. The formatter excludes exactly these six generated files so a format
pass cannot create drift that the next refresh reverses. Other skills and role
profiles remain formatted and checked.

AbraCode's controller rules live in its own skills: `orchestration`,
`openspec-execution`, `project-onboarding`, `recovery`, `browser` and the
engineering procedures. `openspec-execution` is an AbraCode procedure, distinct
from the generated workflow names. The plugin registers its unchanged native ID
`abra-openspec-execution` from the installed source. Its path, body and captured
worker requirements remain stable during this migration.

Keep custom checkpoint and role guidance in these project-owned files and
`.opencode/agents`. Repository instructions require registered work to go through
Abra. Native permissions and controller checks continue to enforce writer scope,
plan/merge approval, task completion, independent Review, delivery and recovery.
A generated skill is guidance, not approval or delivery authority.

## Refresh and migration verification

The controller already runs `openspec update` in the issue's clean owned worktree
before Explore, then retains the instruction-refresh commit separately from the
fetched base. A failed or partial refresh retains resources and blocks workers;
it does not authorize a new baseline or silent retry. This behavior is unchanged.

`tests/integration/openspec-update.test.ts` exercises the real pinned CLI. It
checks that controller provisioning updates a stale generated skill while
preserving the complete custom worker procedure. It also marks all six generated
skills stale in a copy of the migrated repository's instruction tree. One refresh
must restore their expected content while preserving all custom skills, an
unrelated local skill and role profiles; a second must leave the entire tree
byte-for-byte unchanged. Both runs must keep tool-specific copies and old command
directories absent.

The migration compared the old tool-specific copies with the shared workflows,
adopted the CLI's 2.0 templates and preserved the separately owned controller and
worker rules. Current upstream templates also use skill-name handoffs, exact task
source locations and stronger output-path/sync checks. Upstream attribution is
retained in the license inventory and OpenSpec notice.

When upgrading OpenSpec again, review its generated changes and rerun this
integration check plus the required project/native suites. Do not rewrite
custom guidance as generated output to silence a diff. Managed repositories may
have their own edited legacy files; OpenSpec preserves and reports those for
their owners to reconcile, and this migration does not remove them.

Acceptance on 2026-11-15 passed the project checks, 492 unit/integration tests,
all 3 end-to-end tests and the strengthened 7-test refresh regression. The final
CLI dry run reports no changes. Native proof and cleanup records are retained at
`/tmp/abra-openspec2-final-verified`; see [release acceptance](release-acceptance.md#openspec-2-instruction-migration-acceptance--2026-11-15)
for command results and limits.

## Retained schema identity

New full-openspec executions resolve their requested schema, or the owned worktree’s default, after instruction refresh and before Explore. The controller retains the resolved definition and referenced-template digests and passes the selected name explicitly when creating a change. A later default edit cannot switch that execution. New admissions, plan/check gates and archival reject unavailable or changed inputs and mismatched change metadata; restore the original schema source/templates to continue. Give incompatible schema revisions new names and implement them using an unaffected schema. There is no in-place rebinding command.

Historical executions without schema-content evidence remain readable with unavailable original provenance; current files do not become a fabricated past pin. Captured plan authority remains independent of schema size. See [planning choices](work-graph.md#openspec-planning-choices) and [native API evidence](supported-apis.md#openspec-2-schema-resolution-and-binding).

## Compact planning and schema revisions

This repository's default for new changes is the owned `abra-compact-v1` schema:
proposal, behavioral specs and trackable `tasks.md`, with no design prerequisite.
Brief implementation choices and scope boundaries belong in the proposal. Every
tracked task includes observable completion evidence. Behavioral deltas, strict
validation, configured checks, independent Review and human checkpoints remain
required. Native `skip_specs: true` is only for unchanged specification-level
behavior; do not invent a delta or an extra report to satisfy the workflow.

Use `openspec_schema: spec-driven` plus `require_plan_approval: true` at full-spec
intake for consequential work needing deeper architecture, security, migration
or compatibility analysis. Existing changes retain their own `.openspec.yaml`
selection; changing the default does not convert them. Schema selection does not
enable automatic supervision or weaken approval policy in any repository.

The compact definition and its referenced templates are a named contract. Make
incompatible updates under a new name, such as `abra-compact-v2`, and validate
real planning, task tracking and archival before adopting it. Active executions
retain content evidence and block on definition/template drift; restore their
original inputs instead of rebinding them. To roll back future defaults, change
this repository's tracked `openspec/config.yaml` to `schema: spec-driven`.
Preserve earlier schema directories while selected executions or changes need
them. `openspec update` refreshes the six shared generated workflows and preserves
the owned schema and custom guidance; never edit generated workflow bodies.

Real pinned-CLI integration cases exercise compact behavioral and skipped-spec
planning and detailed planning through controller-owned Apply, matching checks,
independent Review, native archival and the retained human merge form. They use
scripted worker outcomes in disposable repositories; autonomous task quality is
not measured by this contract proof.
