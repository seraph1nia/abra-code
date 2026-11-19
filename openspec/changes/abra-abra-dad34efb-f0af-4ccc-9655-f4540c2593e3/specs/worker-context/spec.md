# Spec Delta

## MODIFIED Requirements

### Requirement: Assemble an explicit worker assignment context

For every new managed worker prompt admission, the system SHALL assemble context identifying the issue, execution, generation, role, owned worktree, retained base, workflow policy, applicable accepted scope or planning references, role guidance, selected definition, native agent/model and relevant retained decisions. It SHALL identify relevant repository instruction and artifact references and required skills/tools with their provenance. Workers SHALL remain independent sessions; the system MUST NOT implicitly copy the Supervisor conversation, all central skills, or the capabilities of another harness. Existing project instructions and configuration MUST NOT be overwritten to propagate AbraCode context. New executions SHALL use package-owned role profiles by default; explicit native profile overrides and historical execution selections SHALL remain effective.

#### Scenario: Worker starts in another repository

- **WHEN** a managed worker starts in a target repository whose native registry lacks the centrally named role
- **THEN** the package registers the selected managed worker profile at its owned location and supplies explicit assignment context without copying central agent files into the target repository
- **AND** an explicit native agent override retains its own native instructions plus the selected definition's managed guidance and requirements

#### Scenario: Research and lightweight work have no OpenSpec change

- **WHEN** context is assembled for research-only or lightweight-fix work
- **THEN** it references the retained short contract without inventing OpenSpec artifact prerequisites or implementation tasks

#### Scenario: Project instructions are present

- **WHEN** the target worktree contains repository instructions and locally discoverable skills
- **THEN** AbraCode preserves them, identifies relevant references and does not present the Supervisor's instructions as the target project's conventions

### Requirement: Retain supplied context before uncertain submission

The system SHALL persist the assembled AbraCode context and its versioned identity before submitting a new native worker prompt, bound to the execution generation, role, session intent or session, and prompt identity. New contexts SHALL include the serializable prepared native profile, definition identity/revision, captured context fragments and resolved guidance/skill/tool evidence. An uncertain-submission retry SHALL inspect native inbox/transcript evidence first and SHALL reuse the retained prompt identity and supplied context when resubmission is necessary. A deliberate new turn SHALL receive a new context identity. Historical or legacy admissions without retained manifests SHALL remain readable and be reported as lacking captured provenance; the system MUST NOT fabricate their original context.

#### Scenario: Submission succeeds but its response is lost

- **WHEN** the native inbox already contains the retained prompt after a service restart
- **THEN** recovery recognizes the admission without submitting another prompt or replacing its context with current file contents

#### Scenario: Submission was not admitted and context sources changed

- **WHEN** a retained prompt is absent from native evidence and role guidance or issue text changed after its context was persisted
- **THEN** recovery reuses its retained supplied context or reports an explicit policy incompatibility rather than silently rebuilding a different prompt under the old identity

#### Scenario: Existing execution predates context capture

- **WHEN** diagnostics reads a historical execution without a context manifest
- **THEN** it preserves the execution and labels context provenance unavailable without reconstructing an authoritative manifest from current files

#### Scenario: Prepared context predates the installed definition

- **WHEN** a supported prepared payload is restored after instruction sources or catalog defaults changed
- **THEN** its original profile, fragments, guidance, skills, native agent/model and prompt identity remain authoritative
- **AND** recovery does not relabel current instructions as the original captured definition

## ADDED Requirements

### Requirement: Assignment providers are not request hooks

The system SHALL prepare definition context once per assignment and retain the result before admission. Request hooks SHALL consume captured fragments and filter effective tools without rerunning providers. Concurrent preparation or uncertain recovery MUST NOT repeat a provider under an existing assignment identity. Interrupted preparation without a complete capture SHALL remain unadmitted and require an explicit fresh assignment before provider execution can repeat.

#### Scenario: Several model requests use one assignment

- **WHEN** a captured worker assignment makes multiple provider requests or restarts
- **THEN** each receives the same captured named fragments and the definition context provider has run once for that assignment

#### Scenario: Preparation is interrupted before capture

- **WHEN** preparation starts but is interrupted before the prepared payload is durably complete
- **THEN** no worker prompt is submitted and recovery reports incomplete preparation rather than automatically invoking the provider again under that identity
- **AND** ordinary controller recovery can authorize a fresh assignment without changing lifecycle gates

### Requirement: Restore captured profiles before inventory validation

Recovery SHALL register the exact captured managed native profile at its owned worker location before checking new-admission inventory. A supported captured profile MUST NOT be reconstructed from current instruction sources. Already admitted prompts SHALL retain native evidence-first reconciliation without duplicate submission. Unavailable or incompatible captured contributions SHALL produce a concrete blocker rather than silently substituting a current definition.

#### Scenario: Native registry was rebuilt after restart

- **WHEN** an unadmitted retained assignment references a captured profile absent from the rebuilt native registry
- **THEN** registration restores the captured revision before inventory validation and any necessary same-ID submission uses the original payload

#### Scenario: Captured custom tool implementation is unavailable

- **WHEN** a captured definition requires a contribution whose compatible implementation is no longer supplied
- **THEN** admission is blocked with the contribution identity and clearing action without another provider invocation or substituted handler

### Requirement: Managed instructions are delivered exactly once

Package-owned native profiles SHALL supply static definition instructions once. Assignment hooks SHALL add only captured assignment fragments and any managed guidance not already supplied by that profile. Explicit external native overrides SHALL keep their native instructions and receive the selected definition's managed guidance once. Instruction delivery MUST NOT remove repository instructions or preload an available-only skill.

#### Scenario: Worker uses its bundled native profile

- **WHEN** a model request is formed for a package-managed worker
- **THEN** the effective system contains one copy of its static role instructions and one copy of each captured assignment fragment

#### Scenario: External native override is selected

- **WHEN** the worker uses an explicit external profile with its own system instructions
- **THEN** those instructions are preserved alongside one copy of the selected managed definition guidance and captured fragments

### Requirement: Decode historical contexts without retroactive adoption

Supported prior context records SHALL remain readable with original agent, model, guidance, skills, prompt ID and provenance. Executions captured before definition selection SHALL preserve historical selection rules for all later role admissions until a deliberate new execution. Absence of new fields MUST NOT silently opt historical work into package defaults.

#### Scenario: Legacy execution reaches a later phase

- **WHEN** an execution lacking definition-selection capture advances to Apply after upgrade
- **THEN** it uses its historical native-agent/model selection rather than adopting the new bundled default
- **AND** current policy compatibility and existing checkpoints remain enforced

#### Scenario: New execution follows upgrade

- **WHEN** the controller deliberately creates a new execution after upgrade
- **THEN** it captures the current definition selection and package-default native profile unless an explicit override is configured
