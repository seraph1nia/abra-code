# Spec Delta

## Purpose

Ensure external inputs and retained orchestration evidence are validated before they can influence execution, authorization, delivery or recovery.

## ADDED Requirements

### Requirement: Validate external data before use

The system SHALL validate the structure and safety-relevant values of CLI JSON, repository manifests, parsed configuration, plugin-owned wire responses and tool arguments before using them. Missing fields, invalid values and malformed JSON MUST produce a source-specific diagnostic without optimistic defaults or lifecycle advancement. Additive upstream fields SHALL remain compatible when the consumed contract remains valid.

#### Scenario: OpenSpec returns a syntactically valid invalid result

- **WHEN** an OpenSpec status response contains invalid artifact or completion fields
- **THEN** the system reports the command and invalid field path and retains the execution and its evidence without advancing it

#### Scenario: Forge response grows an unrelated field

- **WHEN** a forge response includes a new field while all consumed identity and readiness fields remain valid
- **THEN** the response remains usable and existing readiness checks still apply

#### Scenario: Invalid model-facing arguments

- **WHEN** a tool request contains an unknown policy or an invalid identifier
- **THEN** validation rejects it before issue creation, resource allocation or record mutation

### Requirement: Decode and migrate durable records explicitly

Every plugin-owned execution, project, setup, operation, decision and attention record SHALL have a versioned validated contract. Recognized legacy records SHALL migrate without changing issue/session/worktree identity, recorded policy, pending obligations or authentic authorization evidence. Unknown future versions or impossible states MUST remain preserved and unavailable for mutation, with actionable diagnostics.

#### Scenario: Existing full-spec execution upgrades

- **WHEN** a valid pre-versioning execution with pending approval is loaded after upgrade
- **THEN** migration retains its native IDs, fingerprints, approval state and claim and does not issue a new authorization

#### Scenario: Incomplete legacy state

- **WHEN** a legacy record lacks evidence required to resume its recorded phase
- **THEN** the system preserves the original data and requests recovery rather than inventing a receipt or replaying a mutation

#### Scenario: Unknown record version does not disappear

- **WHEN** a scan encounters an execution written by an unsupported newer version
- **THEN** the execution remains visible as unavailable for mutation and other valid executions remain inspectable

### Requirement: Distinguish expected waits from failures

Operation results SHALL distinguish completed work, routine waiting, retryable external failure, failed verification and unsafe recovery conditions. Retry policy MUST derive from this classification and retained identity, rather than free-text message matching or retrying every failure.

#### Scenario: Waiting is not a failed execution

- **WHEN** CI is pending or required review approval has not arrived
- **THEN** the execution records a waiting reason and next observation time and retains its current delivery authorization

#### Scenario: Changed remote identity

- **WHEN** the PR head or owned repository identity differs from recorded delivery evidence
- **THEN** the system stops the affected mutation and surfaces recovery or renewed verification requirements without automatic merge

### Requirement: Keep representations consistent

Validated data contracts SHALL define the accepted tool and observer representations as well as their internal types. Diagnostic output MUST identify the operation and offending field without dumping credentials or unlimited external payloads. Already validated native runtime values SHALL retain their native identities and timestamp semantics.

#### Scenario: Input description matches execution validation

- **WHEN** a tool advertises accepted workflow and policy fields
- **THEN** the handler accepts exactly that documented validated shape and returns a consistent structured failure for invalid data

#### Scenario: Native diagnostic timestamps cross the observer

- **WHEN** a decoded native message is projected to a custom wire response
- **THEN** it is encoded to the documented JSON timestamp representation and the observer receives a validated response
