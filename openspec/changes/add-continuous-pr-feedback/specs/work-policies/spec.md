# Spec Delta

## ADDED Requirements

### Requirement: Resolve quality profiles without implicit workflow changes

Registration and work intake SHALL accept optional named quality profiles `strict`, `standard` and `quick`. Strict SHALL default coding work to all-reported CI and required plan approval and require an explicitly selected full-openspec workflow. Standard SHALL default to required-only CI and required plan approval while accepting either coding workflow. Quick SHALL default to required-only CI and standing plan authority and require an explicitly selected lightweight-fix workflow with a complete accepted scope. Profiles MUST NOT select or downgrade a workflow implicitly. Existing coding verification and independent Review SHALL remain mandatory in every profile. Profile selection MUST NOT alter merge authority, delivery, no-check authorization, diagnostic budget, repair budget, draft/reviewer/discussion automation, CI rerun authority or validation-engine selection. Research-only work SHALL retain its existing independent contract and ignore a repository's coding profile; an explicit task-level coding profile on research SHALL be rejected.

#### Scenario: Quick is requested for full specification work

- **WHEN** intake or admission would combine quick with full-openspec
- **THEN** it rejects the incompatible combination with an actionable explanation instead of converting the issue to lightweight-fix

#### Scenario: Strict work uses a lightweight workflow

- **WHEN** coding work explicitly combines strict with lightweight-fix
- **THEN** intake or admission rejects the incompatible combination without creating partial execution resources

#### Scenario: Quick scope is incomplete

- **WHEN** quick lightweight work lacks a goal, acceptance criteria or constraints required by its scope contract
- **THEN** Apply cannot start despite standing plan authority

#### Scenario: Repository grants standing merge authority

- **WHEN** an operator changes that repository's quality profile
- **THEN** its independently configured merge authority remains unchanged and the profile itself grants no new merge authority

### Requirement: Preserve profile provenance and execution compatibility

The system SHALL retain the requested profile, resolver version, effective values and explicit overrides. A task-level profile SHALL take precedence over a repository profile; explicit project CI and plan-approval overrides SHALL remain applicable and be shown as custom when they differ from the selected profile. Explicit profile selection during registration SHALL apply its covered defaults before overrides supplied in the same request; registration that omits a profile SHALL retain existing values. Request retry identity SHALL include an explicitly requested task profile. Execution admission SHALL snapshot the resolved profile and policies, and registry edits or software upgrades MUST NOT reinterpret an active snapshot. Unprofiled legacy projects, requests and executions SHALL retain their existing defaults, identities and authorization evidence.

#### Scenario: Existing project has no profile

- **WHEN** an existing registration is loaded after upgrade
- **THEN** its CI, plan/merge approvals and correction budgets remain as previously recorded without assigning a weaker preset

#### Scenario: Profile is customized

- **WHEN** standard is selected together with an explicit all-reported CI override
- **THEN** the effective policy uses all-reported and exposes the override rather than displaying an unqualified standard policy

#### Scenario: Request ID is reused with another task profile

- **WHEN** an existing creation request ID is reused with a different explicitly requested profile
- **THEN** the system rejects rebinding without changing the existing issue

#### Scenario: Repository profile changes during execution

- **WHEN** the repository changes from strict to quick while a strict execution is active
- **THEN** the active execution retains its original workflow, resolved policy and approvals through restart and retry

### Requirement: Snapshot automation and validation authority independently

Project registration SHALL accept draft publication policy, configured reviewer targets/request policy, public-reply policy, thread-resolution policy, finite CI rerun policy and optional external-validation selection as independent settings. Admission SHALL snapshot their effective values and budgets with the existing delivery and approval policy. Omitting them SHALL preserve legacy behavior, and changing them during an active execution MUST NOT silently widen authority. Setup/research work SHALL reject or ignore coding-only automation according to its contract rather than creating a PR or starting external coding validation implicitly.

#### Scenario: Registration enables replies after a run starts

- **WHEN** a project enables automatic public replies while an execution with manual-only discussion policy is active
- **THEN** that execution retains manual-only policy until an explicitly authorized reconfiguration/recovery route changes its retained contract

#### Scenario: Quality preset is selected without automation settings

- **WHEN** strict, standard or quick is selected and no new outward automation or external engine is explicitly configured
- **THEN** reviewer requests, replies, resolution and reruns remain disabled and validation remains native
