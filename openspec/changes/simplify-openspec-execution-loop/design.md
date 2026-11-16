# Design

## Context

See proposal.md for motivation and scope. This change extends the existing full-openspec policy; it does not introduce another coding policy or execution engine.

Observed integration points:

- `src/openspec/adapter.ts` creates a change without a schema argument and requires every artifact to be `done`, despite decoding `skipped`. Its current planning test also uses global planning completeness instead of the implementation prerequisite closure.
- `src/work/{model,intake,batch,graph}.ts` owns normalized single/batch identities and SQLite issue persistence. The current database version is 6; optional model dispatch is already retained beside original request input.
- `src/config/policy.ts` resolves quality defaults before explicit repository overrides. A task's strict profile alone cannot restore a plan form disabled by a repository override.
- `src/workflow/advancement.ts` already continues from validated planning when `plan_approval_required` is false. `corrections.ts` already implements durable finite rounds, repeated-finding stops and decisions for changed or uncertain scope; manual supervision disables automatic repair.
- Worker roles and approved-plan fingerprints remain enforced independently of OpenSpec guidance. `Git.planFingerprint` currently masks checkbox changes only in files named `tasks.md`.
- The unfinished chat-first change is refactoring presentation, not these lifecycle authorities. Extend shared observations rather than adding another inspector or report renderer.

OpenSpec 2 supports project-local schemas, per-change schema names, native prerequisite/task status and intentional spec omissions. The pinned CLI's schema resolver reports the selected source through `schema which --json`. Structural validation of the proposed three-artifact graph has passed in memory, but no compact schema files or end-to-end proof exist yet.

## Goals / Non-Goals

**Goals:**

- Make ordinary full-openspec work use a smaller planning package and continue within explicit standing authority.
- Keep deeper planning and a stronger human plan checkpoint selectable before admission.
- Preserve exact request identity, captured policy, restart behavior, finite corrections and independent Review.
- Support native schema extension through required planning artifacts and templates, with location-specific diagnostics.

**Non-Goals:**

- Combining worker roles, weakening approved-plan fingerprints, letting workers approve their own work, or changing merge/retirement authority.
- A general stage language, risk-classification engine, task database, schema registry, shared-store integration or new report pipeline.
- Renaming/removing research-only or lightweight-fix, changing global automation defaults, or expanding project-lead grants.
- Editing generated OpenSpec skill bodies, replacing instruction refresh, rewriting other active changes or silently changing personal settings.

## Decisions

### 1. A small project schema is the extension mechanism

Implement `openspec/schemas/abra-compact-v1/` by forking the pinned built-in schema and editing the owned copy. Preserve the established artifact IDs and paths:

| Artifact | Output        | Required predecessors | Guidance                                                                     |
| -------- | ------------- | --------------------- | ---------------------------------------------------------------------------- |
| proposal | proposal.md   | none                  | Brief problem/result, capabilities, scope boundaries and consequential risks |
| specs    | specs/**/*.md | proposal              | Behavioral deltas and observable scenarios using native spec syntax          |
| tasks    | tasks.md      | specs                 | A few coherent tasks, each with its completion evidence                      |

Set `apply.requires: [tasks]` and `apply.tracks: tasks.md`. Remove the design artifact and every dependency or instruction that assumes a design document. A short technical choice belongs in the proposal; a change needing extensive architecture work selects `spec-driven` instead. Keep proposal capability declarations and native spec rules so validation and archival continue to work.

Templates should encourage concise writing without inventing rigid task-count limits. They must not instruct agents to omit actual behavioral changes or weaken required proof. No new required results/report artifact is added.

Use native `skip_specs: true` only when the existing specification-level contract remains correct. The specs artifact stays in the schema and is explicitly skipped by OpenSpec; its absence alone is not an opt-out. No unsupported `skip_design` metadata or fabricated spec is introduced.

Change only this repository's tracked default after adapter compatibility and regression coverage pass. Do not install the compact schema into every managed repository or alter a foreign repository's default during provisioning. Owners can commit their own schemas through normal work.

Alternative: a proposal/tasks-only schema for every task. Rejected because behavioral changes should still update durable specifications. Alternative: silently treating design as optional in the controller. Rejected because the schema should describe the actual planning contract.

### 2. Add two small intake choices, not a new policy system

Add optional full-openspec work fields:

- `openspec_schema`: an explicit native schema name; omission follows the target repository's default for new executions.
- `require_plan_approval`: an affirmative task requirement. Accept only an explicit true value when supplied; it can strengthen the effective policy and cannot disable approval.

Both flow through the owning input/issue schemas, normalization, single and atomic batch intake, native tool schemas and SQLite storage. Reject these fields for other workflow policies. Include them in retained request input and batch receipts so retries cannot change the planning contract under an old request ID.

Use an additive database migration from the then-current version and nullable issue columns for these choices. Preserve old request JSON byte-for-byte; normalization of an older request must not add defaults that change its comparison identity. Test old-version upgrades and single/batch response loss.

Resolve the existing repository/profile policy normally, then apply the one-way task requirement: explicit true always requires the human plan form. Record that effective requirement with provenance (`task_requirement` versus the existing resolved policy source) before any worker admission. Do not change quality-profile precedence or teach profile labels to imply authority they do not currently provide. No per-task false option is added.

Alternative: setting repository plan approval false and relying on a strict task profile for exceptions. Rejected because repository overrides currently win. Alternative: two-way task overrides. Rejected because a work request must not weaken required repository gates.

### 3. Bind the native schema at the owned worktree

During provisioning, keep the existing clean-worktree instruction refresh. Resolve the explicit schema, or read the default from the owned worktree's OpenSpec configuration, after that refresh and before Explore. Use the target worktree as cwd for native schema resolution; central availability is not proof of worker-location availability.

Retain a versioned schema binding in the existing execution record: name, explicit/default selection source, native resolution source, and a digest of schema.yaml plus its referenced template paths and contents. This is execution evidence, not another schema store. Decode consumed CLI output through owned adapter contracts and consult/update `docs/supported-apis.md` for any newly consumed command shape.

Pass the retained name explicitly to `new change --schema ...`. On creation recovery, inspect the existing change and require its reported schema to agree; do not adopt a conflicting directory or recreate it. Recompute/compare the binding before new role admissions and dependent OpenSpec checkpoints. Source changes, missing inputs and definition/template drift block rather than selecting a fallback. A changed project default does not switch a retained explicit binding.

Carry the same selection into correction and synchronization revision changes. Before reusing an owned prompt after uncertain submission, preserve its captured content and observe native admission as today; a current schema failure must not trigger prompt replay. Detect drift before the next eligible new admission/advancement rather than pretending already admitted work was undone.

Legacy executions without the binding remain readable and continue their existing metadata/approval recovery route. Do not backfill a historical digest from current files or let the new default recreate an existing change. Diagnostics label unavailable original provenance explicitly.

Schema names identify definitions, not immutable content: OpenSpec's numeric version field is not a pin. Use a new name for incompatible revisions and restore the original inputs to recover a drifted active execution. Updating a schema selected by the current execution requires separately planned work using an unaffected schema. No in-place rebinding command is part of this change.

### 4. Translate OpenSpec readiness faithfully

For planning, read native status and apply instructions. Starting from `applyRequires`, follow the returned artifact `requires` edges transitively, including dependencies of artifacts already marked done. Require every artifact in that closure to be done or natively skipped; reject missing dependency identities and malformed status. Then require strict validation, configured task tracking, a nonzero total and an unblocked apply state.

Do not rely solely on `isPlanningComplete`, which describes all declared artifacts, or on the existence of tasks.md, which can appear before its prerequisites. Artifacts outside the implementation closure are not new gates. This traversal only interprets native artifact readiness; it does not create runtime phases or mirror task state.

Implementation completion still requires native all_done and consistent zero remaining tasks, unchanged approved planning contents, controller checks and independent Review for the same content. The Review scorecard remains mandatory for full-openspec; intentional omissions are explained, not fabricated or automatically scored as verified.

Keep tasks.md in the bundled compact schema to fit the current fingerprint behavior. Arbitrary custom task filenames and checkbox normalization are outside this change; preserve the existing boundary and disclose it in integration documentation instead of claiming unrestricted custom-schema compatibility.

### 5. Reuse the existing automatic continuation and correction loop

The normal opted-in path is:

```text
requested goal -> compact planning -> controller validation -> Apply
                                                           |
                      in-scope, finite repair <--- checks + Review
                                                           |
                                              archive + delivery
                                                           |
                                                  human merge form
                                                           |
                                                 merge + safe cleanup
```

There is no new automatic-approval actor. A captured false plan-approval requirement means policy already permits continuation; a captured true requirement still needs the native exact-plan form. Keep the controller's existing validation and continuation path, including periodic recovery when an event is missed.

Document an operator opt-in recipe using the current settings: attended-automatic supervision, repository plan_approval false, merge_approval true and repair_rounds 2. Preserve other declared verification and delivery policies. Do not edit the ignored personal file, apply declarations, restart a service or enable this recipe as a side effect of installing the schema. The shipped manual posture and zero automatic-repair default remain unchanged.

Abra selects `spec-driven` plus require_plan_approval true for consequential work listed in the proposal. This is guidance for intake judgment; the enforceable controller guarantee is the selected captured gate. Do not claim a path-based or semantic risk classifier. Uncertainty uses existing durable questions before dependent work.

Automatic repair keeps the existing scope classification, shared durable round budget, repeated-finding refusal and pause behavior. Scope changes require a decision and the current replanning route; a resolved decision is not a human approval receipt. Post-archive revisions preserve earlier archives and the selected schema; they do not reset the budget. Provider/model failures do not gain an automatic substitute.

Alternative: merge Explore and Apply to save a handoff. Deferred because it changes permissions, recovery and ownership. Smaller artifacts and automatic handoff are enough for this iteration.

### 6. Extend observations and owned guidance once

Expose the schema binding or unavailable provenance, effective plan requirement/source, and consumed/remaining repair allowance through existing status and diagnostic contracts. Do not use a new frontend lifecycle, mandatory report, or model polling loop. Preserve independent approval/delivery/cleanup/closure observations and bounded output.

Update the project-owned orchestration/execution guidance and role prompts to consume the selected schema and required artifact closure. Avoid requiring a design document or a human form when neither applies. Keep concise project-specific drafting rules in the owned schema/configuration. Generated OpenSpec skills remain upstream output; the existing refresh test must continue to preserve custom guidance and schemas.

## Risks / Trade-offs

- Less routine planning review can miss a bad interpretation -> explicit opt-in, concise scope/scenario artifacts, independent Review, human merge and task-specific stronger plan gates. Native scripted tests cannot establish autonomous interpretation quality.
- Custom schema support can grow into a framework -> start with one compact schema plus the existing detailed schema; preserve native artifact/task authority and current worker roles.
- Schema drift guards can stop work after an upgrade -> retain exact source evidence, block without replay/fallback, and document restoration or separately authorized new work. Do not retroactively fabricate legacy pins.
- Added issue fields can change retry identity -> additive migration, optional fields, stable normalization and native single/batch restart fixtures.
- Default adoption can make uninitialized compatibility code fail -> land adapter support and real-CLI proof before changing this repository's default.
- The chat-first change touches shared contracts -> add typed evidence at its current owning projections without rewriting that change or reviving terminal/report UI scope.

## Migration Plan

1. Add intake/record compatibility and one-way policy resolution, proving existing requests and executions retain their behavior.
2. Implement schema binding, explicit creation/revision selection and native readiness/skip support with pinned-CLI fixtures.
3. Add the owned compact schema/templates and run schema validation plus real behavioral/skip/detailed validation and archival journeys.
4. Update status/diagnostics, role guidance and operator opt-in documentation; then adopt the compact default for this repository's future changes. This proposal and other existing changes keep their recorded schema names.
5. Prove the automatic path, stronger human gate, finite corrections, merge wait, pause and restart in disposable native repositories. Run required project checks and retain external evidence following the verification recipe.

No service or policy rollout is automatic. Rollback stops new admissions, restores this repository's default and keeps the compact schema available for retained changes. Do not remove a schema still referenced by active work, rewrite prior archives or downgrade the database. Existing captured policies and approvals survive rollback; unsupported newer records must be preserved and refused safely.

## Sources

- [OpenSpec schema customization](https://openspec.dev/docs/customize-schemas)
- [OpenSpec schema contract](https://openspec.dev/docs/schemas/schema-yaml)
- [Pinned 2.0.0 customization documentation](https://github.com/Fission-AI/OpenSpec/blob/v2.0.0/docs/customization.md)
- Local integration and acceptance references: `docs/openspec.md`, `docs/supported-apis.md`, `docs/verification/README.md` and `docs/verification/features/full-spec.md`.
