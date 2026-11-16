# Spec Delta

## ADDED Requirements

### Requirement: Offer compact OpenSpec planning without changing execution authority

Full-openspec SHALL support a repository-owned compact schema with proposal, behavioral spec deltas and tracked tasks, without a mandatory design document. This repository SHALL use it for new changes by default while retaining detailed planning as a selectable schema. Schema selection MUST NOT change workflow policy, worker permissions, checks, independent Review, archival, merge authorization or safe retirement.

#### Scenario: Bounded behavioral change uses the repository default

- **WHEN** a new full-openspec change in this repository uses the compact default
- **THEN** planning produces a concise proposal, the affected behavioral spec deltas and verifiable tasks without requiring a separate design document
- **AND** implementation remains gated by controller validation and the captured approval policy

#### Scenario: Consequential work needs detailed planning

- **WHEN** Abra prepares work involving lifecycle authorization, persisted contracts, native integrations, migrations or deletion policy
- **THEN** its project-owned guidance directs it to select detailed planning and explicitly require human plan approval before admission
- **AND** uncertainty about scope is resolved through the existing decision route rather than silently treating the work as routine

#### Scenario: A schema adds a planning prerequisite

- **WHEN** a valid repository-owned schema introduces an additional artifact required for implementation
- **THEN** the existing OpenSpec instruction and readiness surfaces expose that prerequisite without adding another execution engine or task store

### Requirement: Preserve OpenSpec planning choices in work request identity

Full-openspec intake SHALL accept an optional schema selection and an optional one-way requirement for human plan approval. Single and batch requests SHALL retain these choices in normalized identity and persisted issues. Reusing a request with changed choices MUST be rejected. Other workflow policies MUST reject these OpenSpec-specific choices. Omission SHALL preserve existing intake behavior.

#### Scenario: Single request is retried with a different schema

- **WHEN** a caller reuses a request ID with a different explicit OpenSpec schema
- **THEN** intake rejects the rebinding and preserves the original issue

#### Scenario: Batch request loses its response

- **WHEN** a batch containing explicit schema and human-plan requirements is retried with the same keyed definitions after restart
- **THEN** it returns the original issue mapping and retained planning choices without creating duplicate work

#### Scenario: A batch changes a required approval

- **WHEN** a caller retries a retained batch after removing a task's explicit human-plan requirement
- **THEN** the whole retry is refused as changed input without modifying any original issue

#### Scenario: Research attempts to select a coding schema

- **WHEN** research-only or lightweight-fix intake includes an OpenSpec schema or the new OpenSpec-specific approval requirement
- **THEN** intake rejects the incompatible choice without starting work or silently changing workflow policy

### Requirement: Bind new executions to their actual OpenSpec schema

Before admitting Explore, new full-openspec executions SHALL resolve an explicit schema or the owned worktree's default, retain its name, source and content identity, and confirm the change reports that schema. Later admissions and checkpoints MUST reject schema drift or unavailable inputs without fallback. Configuration edits MUST NOT reinterpret retained work; legacy records SHALL remain readable without fabricated historical schema provenance.

#### Scenario: Explicit schema exists only in the target repository

- **WHEN** a task selects a valid schema committed in its fetched target repository but absent from the central installation
- **THEN** provisioning resolves it in the owned worktree and creates the change with that schema

#### Scenario: Selected schema is unavailable

- **WHEN** an explicit schema cannot be resolved at the owned worker location
- **THEN** no Explore prompt is admitted and the retained execution identifies the missing schema and clearing action
- **AND** provisioning does not substitute the repository default

#### Scenario: Default changes after the execution was bound

- **WHEN** the project default changes after a new execution has captured its schema
- **THEN** its later admissions, restart recovery and correction revisions retain that schema selection

#### Scenario: Schema instructions change during execution

- **WHEN** a retained schema definition or one of its referenced templates no longer matches the captured content identity
- **THEN** dependent admission or advancement blocks with the original evidence preserved rather than using the changed workflow

#### Scenario: An execution predates schema capture

- **WHEN** status reads a historical execution without the new schema provenance
- **THEN** it preserves that record and its existing authority, reports unavailable original provenance and does not invent a past content identity

### Requirement: Honor native planning prerequisites and intentional omissions

Planning readiness SHALL require strict OpenSpec validation, real tracked tasks and every transitive implementation prerequisite reported by OpenSpec to be done or explicitly skipped. A native skip SHALL satisfy that prerequisite without requiring its files. Missing artifacts, task counts or local guesswork MUST NOT create a skip. Artifacts outside the implementation prerequisite closure MUST NOT become additional approval gates.

#### Scenario: Existing specifications remain correct

- **WHEN** a compact change validly declares skip_specs because it changes no specification-level behavior
- **THEN** proposal and tasks can make planning ready with the specification artifact reported as skipped and no delta files created
- **AND** Apply and independent Review use the retained contract and disclose the intentional omission

#### Scenario: Skipped specifications also contain delta files

- **WHEN** a change declares skip_specs but also contains conflicting specification files
- **THEN** strict validation blocks planning and no automatic handoff occurs

#### Scenario: A task file exists before its prerequisites

- **WHEN** the tracked task artifact exists but a required proposal or specification dependency is missing
- **THEN** planning remains blocked even if the task artifact itself reports done

#### Scenario: Schema declares an unrelated planning artifact

- **WHEN** an artifact is outside the transitive implementation prerequisite closure
- **THEN** its absence alone does not block Apply and does not authorize its creation

#### Scenario: Implementation reports success with unfinished tasks

- **WHEN** an Apply session succeeds but native tracked task progress still has remaining work
- **THEN** verification and delivery remain blocked regardless of schema size or automatic supervision

### Requirement: Allow an issue to strengthen its human plan checkpoint

An explicit per-issue human-plan requirement SHALL take precedence over a repository or quality-profile result that permits automatic continuation. It MUST NOT waive another required gate. Effective plan policy and provenance SHALL be captured before worker admission and retained through restart, replan and correction. The new task option MUST NOT grant standing authority, bypass a native human form or alter merge policy.

#### Scenario: Sensitive task runs in a repository permitting routine continuation

- **WHEN** the repository permits automatic plan continuation but an issue explicitly requires human plan approval
- **THEN** validated planning waits for its matching native human form before Apply
- **AND** neither Abra's prose nor a worker question answer satisfies that checkpoint

#### Scenario: Compact schema has no standing approval policy

- **WHEN** an issue selects the compact schema while its captured policy requires plan approval
- **THEN** the human checkpoint remains required

#### Scenario: A repository override conflicts with a profile label

- **WHEN** a task explicitly requires human plan approval and the resolved quality policy otherwise disables that approval
- **THEN** the explicit requirement wins and status exposes the effective requirement rather than inferring authority from the profile name

#### Scenario: Operator changes configuration during a pending checkpoint

- **WHEN** repository configuration disables plan approval after an execution captured a required checkpoint
- **THEN** that execution continues to require its original human form after restart

### Requirement: Continue routine full-spec work within retained authority

When captured policy permits automatic plan continuation, the controller SHALL advance validated planning into Apply and retain checks, independent Review and archival. Automatic corrections SHALL use existing configured finite budgets and scope rules; ambiguity, repeated findings, exhaustion and pauses MUST retain their current stopping behavior. Compact planning MUST NOT enable automation, repairs or merge authority merely by being selected.

#### Scenario: Routine issue completes without a planning interruption

- **WHEN** an explicitly authorized routine full-openspec issue has a valid compact plan and captured policy permits automatic continuation
- **THEN** Apply, checks and independent Review can proceed without a plan form or another user advance request
- **AND** a required human merge form remains pending before merge

#### Scenario: An in-scope defect is repairable

- **WHEN** an automatic posture and retained nonzero repair budget permit a new in-scope correction
- **THEN** the controller uses its existing correction route, reruns checks and independent Review and consumes the same durable budget

#### Scenario: Defect requires a changed behavioral contract

- **WHEN** Review or repair identifies changed requirements or unresolved conflicting expectations
- **THEN** the existing scope decision and replanning route blocks dependent work without rewriting accepted requirements or granting a new approval

#### Scenario: Repeated failure or exhausted budget is observed

- **WHEN** an unresolved finding repeats or the captured repair allowance is exhausted
- **THEN** the execution retains its findings and next decision instead of starting another automatic correction

#### Scenario: Manual posture or pause is active

- **WHEN** routine work is paused or the configured manual posture disallows automatic repair
- **THEN** compact schema selection does not resume it or admit an otherwise prohibited repair

### Requirement: Explain planning policy through existing observations

Existing work status and worker diagnostics SHALL expose the selected schema, available schema provenance, effective plan-approval requirement and its source, and consumed or remaining correction allowance. Observations MUST distinguish unavailable historical evidence from current configuration and MUST NOT create approval, repair or resume authority. Routine successful transitions MUST NOT require extra model turns or a new report artifact.

#### Scenario: Operator inspects an automatic routine issue

- **WHEN** status is read for a new compact execution with standing plan authority
- **THEN** it explains the retained schema and why a plan form is unnecessary while independently reporting merge, delivery, cleanup and closure

#### Scenario: Operator inspects a sensitive issue

- **WHEN** diagnostics is read for an issue carrying the explicit human-plan requirement
- **THEN** it identifies that task requirement as the effective source and preserves the pending form
