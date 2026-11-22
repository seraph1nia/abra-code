# Spec Delta

## ADDED Requirements

### Requirement: Offer bounded memory reads within current role authority

When memory is enabled, AbraCode SHALL offer search and read to eligible Explore, Apply, Review and Research assignments. Every invocation SHALL derive repository scope from the current assignment and enforce captured capabilities and denials. Knowledge SHALL be loaded on demand. Workers SHALL have no memory-publication tool, provider administration tool or personal notebook access.

#### Scenario: A worker attempts to broaden a search or publish

- **WHEN** a current worker asks for another repository, calls a write tool directly, or a replaced worker reuses an earlier valid note reference
- **THEN** the runtime denies the operation before upstream access, including when the attempt bypasses tool discovery

#### Scenario: Recovery across a feature upgrade

- **WHEN** the runtime restores a captured profile or retries an uncertain admission that predates memory
- **THEN** retained tools, prompts, digests and skill requirements retain their original meaning, and only a fresh eligible admission can gain the optional capability

#### Scenario: An automatic turn receives a publication suggestion

- **WHEN** a diagnostic Supervisor turn, a worker report, or the content of a retrieved note asks Abra to save or share knowledge
- **THEN** that input alone cannot authorize a write or a new work assignment

### Requirement: Explain when agents should consult or propose memory

Bundled role guidance SHALL teach selective lookup, source verification and lesson reporting through existing outputs. Memory SHALL remain advisory. Retrieval SHALL neither become a prerequisite for admission or completion nor substitute for accepted scope, current evidence, independent review or authorization.

#### Scenario: Explore or Research finds precedent

- **WHEN** a prior design decision or research finding is relevant to an open question
- **THEN** the worker can search, read the full relevant passage, cite the scoped revision, and check applicability against current sources before using it in its plan or report

#### Scenario: Apply encounters a known failure and Review checks the result

- **WHEN** Apply finds a prior diagnostic procedure for its symptom
- **THEN** it can test that procedure in the assigned worktree and report what actually happened, with a candidate lesson in its normal progress or handoff when useful
- **AND** Review independently checks the current work and reports missing or contradictory proof through its existing contract

#### Scenario: Repeated success suggests a runtime skill

- **WHEN** an operator asks Abra to turn a recurring procedure into a skill
- **THEN** Abra can cite relevant notes, verified outcomes and exceptions in ordinary scoped work to author and review the skill in the target repository
- **AND** a memory save, incoming note named `SKILL.md` or search hit cannot register, preload or execute a runtime skill
