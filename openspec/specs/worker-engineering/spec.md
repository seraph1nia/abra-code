# worker-engineering Specification

## Purpose

Give managed workers repeatable design, terminology, diagnosis and behavioral verification techniques within AbraCode's existing execution roles and controller-owned gates.

## Requirements

### Requirement: Portable engineering skills are available without installing upstream workflows

The system SHALL supply offline, explicitly attributed adaptations named `abra-codebase-design`, `abra-domain-modeling`, `abra-diagnosing-bugs`, `abra-verification` and `abra-blast-radius` at central and managed worker locations. Their loading routes and any required references SHALL be usable from the assigned worktree. Registration MUST preserve unrelated repository skills and instructions and MUST NOT require an upstream plugin, model configuration, installer, runtime network fetch or access to another harness's skill directory.

#### Scenario: Worker operates in an unrelated repository

- **WHEN** a managed worker starts in a registered repository without the upstream skill packages
- **THEN** its applicable bundled engineering skills can be listed and loaded through the native skill tool without adding control files to that repository
- **AND** existing local skills and instructions remain available and unchanged

#### Scenario: Runtime has no upstream network access

- **WHEN** a worker loads a bundled engineering skill while upstream sites are unavailable
- **THEN** its procedure and required references remain usable from the installed AbraCode sources

### Requirement: Design and domain modeling respect accepted scope

Engineering guidance SHALL direct workers to assess caller-visible behavior, interface complexity, ownership and meaningful test interfaces when a design decision is relevant. Domain modeling guidance SHALL distinguish proposed terminology, existing documentation and accepted requirements. Explore SHALL capture proposed glossary or architectural decisions only within its assigned planning change; Apply SHALL update repository documentation only when covered by accepted scope; Review SHALL assess terminology and design read-only. Unresolved contradictions SHALL use the existing worker-question and scope-decision mechanisms rather than silently redefining requirements.

#### Scenario: Explore settles a new domain term

- **WHEN** planning establishes a term that belongs in the repository glossary
- **THEN** Explore records the definition and any proposed documentation task inside its assigned change
- **AND** it does not edit root documentation or treat conversational agreement as approval to implement

#### Scenario: Implementation reveals a design conflict

- **WHEN** an engineering skill recommends a design incompatible with the approved requirements
- **THEN** the worker identifies both sources through the existing decision route and stops dependent work without rewriting the accepted plan

### Requirement: Difficult bug diagnosis uses a falsifiable reproduction

Diagnosis guidance SHALL direct Apply to establish and run a bounded reproduction of the reported symptom, narrow the reproduction where useful, evaluate falsifiable hypotheses and rerun the original scenario after a fix. It SHALL distinguish a demonstrated result from an unproven hypothesis or unavailable environment, remove only its own temporary instrumentation within authorized scope, and retain reproducible regression coverage when an appropriate test interface exists. Diagnosis MUST NOT reset correction budgets, authorize production instrumentation or extend accepted scope.

#### Scenario: A correction addresses a reproducible failure

- **WHEN** Apply uses diagnosis guidance for an in-scope difficult bug
- **THEN** it identifies the failing invocation, the symptom it asserts, the tested cause and the result of rerunning that invocation after the fix
- **AND** the controller still requires its configured checks and independent Review

#### Scenario: The actual symptom cannot be reproduced

- **WHEN** the required environment or evidence is unavailable after bounded attempts
- **THEN** the worker reports the attempts and missing prerequisite through the existing reporting tools without claiming a proven diagnosis

### Requirement: Verification recipes describe real observable behavior

Verification guidance SHALL use the target repository's existing commands and harnesses to describe launch or preparation, a usable-instance health check, the relevant user action, observable expected state, evidence capture and cleanup of resources created by that verification. A recipe SHALL identify isolation requirements and distinguish temporary evidence from preserved evidence. Creating or changing repository recipes SHALL require accepted write scope; absence of a recipe MUST NOT itself trigger repository setup, extra approval, host installation or a new workflow. Existing documented checks SHALL remain usable.

#### Scenario: Apply uses an existing project recipe

- **WHEN** a relevant recipe exists in the assigned repository
- **THEN** Apply follows its documented interaction and verifies the resulting state using an isolated fixture or an explicitly authorized instance
- **AND** it reports the invocation, expected and observed behavior, evidence location and limitations without claiming cleanup preserved a deleted artifact

#### Scenario: Recipe creation is outside the change

- **WHEN** a foreign repository has no recipe and the accepted scope does not include creating one
- **THEN** Apply uses relevant existing documented verification commands or reports a concrete missing prerequisite
- **AND** it does not install a package, write a new skill or expand the plan solely to satisfy the guidance

#### Scenario: Verification starts temporary resources

- **WHEN** an authorized recipe starts an isolated process or browser and captures evidence
- **THEN** its cleanup targets only resources that run created, preserves the named evidence and does not remove controller-owned sessions or worktrees

### Requirement: Blast-radius proof follows the changed behavior beyond the diff

Blast-radius guidance SHALL direct Apply to identify the concrete safety assumption behind a risky change and test it through real code or the appropriate application interface where feasible. It SHALL account for relevant persisted formats, external contracts, retries or downstream consumers, and distinguish confirmed risks, cleared cases and unproven assumptions. Findings outside accepted scope SHALL remain decisions or follow-up recommendations rather than automatic implementation tasks.

#### Scenario: Persisted state changes

- **WHEN** a change's safety depends on older persisted state remaining readable
- **THEN** the proof exercises representative retained input through the actual decoder or application path and states the observed outcome
- **AND** citing the new type declaration alone is not presented as runtime proof

#### Scenario: A safety assumption remains unproven

- **WHEN** the relevant runtime condition cannot be exercised
- **THEN** the worker labels the assumption and its verification limitation explicitly for independent Review

### Requirement: Independent Review assesses engineering evidence under existing gates

Review guidance SHALL assess applicable behavioral proof, design and terminology against the currently verified worktree, including applicable staged, unstaged and untracked implementation content. It SHALL distinguish source inspection, a matching controller check receipt, accessible observed results and unavailable evidence. Applicable unverified behavior MUST NOT be labeled verified solely because a skill was available, loaded or mentioned. Full-spec work SHALL use the existing completeness, correctness, coherence and conflict assessments; lightweight work SHALL use its accepted short contract. No additional report endpoint, skill-use receipt or lifecycle phase SHALL be required.

#### Scenario: Proof code has not been committed

- **WHEN** a relevant implementation or proof file is uncommitted or untracked in the verified worktree
- **THEN** Review assesses that current content against the accepted contract rather than limiting inspection to a committed diff ending at HEAD

#### Scenario: Ad hoc output is not available to Review

- **WHEN** Apply reports having run a proof but Review cannot inspect its result or a matching configured check covering it
- **THEN** Review discloses the missing applicable evidence through its existing report instead of treating the worker's statement or a scratch path as proof

### Requirement: AbraCode supplies a verified repository recipe

AbraCode SHALL include a repository-owned verification recipe and feature map grounded in its existing disposable-repository and native-server harnesses. The map SHALL cover full-spec approval and implementation, lightweight correction, and preservation/retirement or restart behavior supported by the implementation baseline. Each journey SHALL identify its invocation or harness entry, expected observable results and limitations. At least one mapped journey SHALL be executed end to end before the recipe is declared usable. Recipe execution MUST NOT mutate the operator's active service, production repositories or user remotes.

#### Scenario: Contributor follows the shipped recipe

- **WHEN** a contributor executes a documented journey in the repository's test environment
- **THEN** the journey drives the existing isolated harness, reports its actual observed outcome and identifies the evidence that remains after teardown

#### Scenario: Planned finishing behavior is not implemented

- **WHEN** the independent finishing change has not supplied a proposed behavior in the implementation baseline
- **THEN** the recipe identifies that limitation and maps available behavior without claiming the proposed journey already passes
