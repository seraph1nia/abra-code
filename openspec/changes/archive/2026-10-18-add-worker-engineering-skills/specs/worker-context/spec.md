# Spec Delta

## ADDED Requirements

### Requirement: Coding admissions retain role-relevant engineering guidance

For new full-openspec and lightweight-fix worker prompt admissions, the system SHALL select a documented set of bundled engineering skill prerequisites appropriate to the role, combine them with existing workflow and configured prerequisites, and retain their native identities, content digests, selection source and conditional loading guidance through the existing captured context. Explore SHALL receive design, domain modeling and verification planning guidance; Apply SHALL receive design, domain modeling, diagnosis, verification and blast-radius guidance; Review SHALL receive design, verification and blast-radius assessment guidance. Research-only SHALL retain its existing prerequisites without requiring coding skills, recipes or repository checks. Skill selection MUST NOT widen role permissions or require all available procedures to run on every task.

#### Scenario: Lightweight Apply starts without OpenSpec

- **WHEN** a new lightweight Apply prompt is admitted
- **THEN** its coding skill prerequisites resolve at the assigned worker location alongside configured requirements
- **AND** its guidance uses the short contract without adding OpenSpec planning prerequisites

#### Scenario: A selected portable skill is unavailable

- **WHEN** a new coding admission cannot uniquely resolve one of its role-selected engineering skills
- **THEN** admission reports the missing or ambiguous skill, worker location and prerequisite source through the existing capability diagnostic without widening permissions or automatically installing it

#### Scenario: Existing captured admission predates the suite

- **WHEN** recovery inspects or retries a retained prompt whose captured requirements do not include the engineering suite
- **THEN** it preserves that prompt's captured requirements and guidance rather than retroactively adding new role defaults under the same prompt identity
- **AND** ordinary current permission-policy compatibility and native admission reconciliation still apply

#### Scenario: Deliberate new turn follows an upgrade

- **WHEN** the controller authorizes a fresh coding turn with a new prompt identity
- **THEN** its newly captured context selects the current role-relevant engineering defaults

#### Scenario: Skill availability is inspected

- **WHEN** diagnostics shows a resolved engineering skill without native invocation evidence
- **THEN** it continues to identify loading as unobserved and does not claim that the procedure ran or its behavioral proof passed
