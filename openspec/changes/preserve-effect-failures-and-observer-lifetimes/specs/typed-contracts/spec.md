# Spec Delta

## MODIFIED Requirements

### Requirement: Validate external data before use

The system SHALL validate the structure and safety-relevant values of CLI JSON, repository manifests, parsed configuration, plugin-owned wire responses and tool arguments before using them. Missing fields, invalid values and malformed JSON MUST produce a source-specific diagnostic without optimistic defaults or lifecycle advancement. Fetched Git object IDs, retained report payloads and JSON inbox rows SHALL produce bounded typed read failures on malformed input. Additive upstream fields SHALL remain compatible when the consumed contract remains valid.

#### Scenario: OpenSpec returns a syntactically valid invalid result

- **WHEN** an OpenSpec status response contains invalid artifact or completion fields
- **THEN** the system reports the command and invalid field path and retains the execution and its evidence without advancing it

#### Scenario: Forge response grows an unrelated field

- **WHEN** a forge response includes a new field while all consumed identity and readiness fields remain valid
- **THEN** the response remains usable and existing readiness checks still apply

#### Scenario: Invalid model-facing arguments

- **WHEN** a tool request contains an unknown policy or an invalid identifier
- **THEN** validation rejects it before issue creation, resource allocation or record mutation

#### Scenario: Git returns malformed commit text

- **WHEN** the fetch operation resolves a ref and Git returns text that fails the supported commit ID grammar
- **THEN** the caller receives a source-specific invalid-data failure before using the value as a base commit

#### Scenario: A retained report is corrupt

- **WHEN** a reader or recovery operation encounters malformed JSON in an export receipt or the required embedded report data
- **THEN** the operation returns a bounded data or report-integrity failure and preserves the existing artifact

### Requirement: Observer errors have a declared domain contract

Expected observer failures SHALL have schema-defined error identities and bounded safe data so clients can distinguish a missing issue, unavailable retained resource or invalid read selection from connection/framework failure. Inbox reads SHALL preserve their domain code and classify invalid selections separately from unavailable remote or local resources. Such errors MUST NOT mutate lifecycle state or hide unrelated readable work.

#### Scenario: Planning document is unavailable

- **WHEN** a planning-document read targets a retired worktree or an unavailable owned document
- **THEN** the observer returns its declared unavailable-resource error and the client can preserve the ticket and other readable views

#### Scenario: Observer connection fails

- **WHEN** a read cannot reach the native service
- **THEN** the client identifies connection failure separately from a declared missing-resource error and keeps its last snapshot marked stale

#### Scenario: An inbox detail cannot be observed

- **WHEN** a user selects an inapplicable project, the remote has imposed a cooldown, or a client calls the inbox from outside its central location
- **THEN** an inapplicable project is an invalid selection, and cooldown or an unavailable central reader is an unavailable resource
- **AND** the native RPC and web client preserve the specific domain code and a bounded diagnostic

## ADDED Requirements

### Requirement: Preserve the origin of inbox storage failures

A local inbox index read, decode or transaction failure SHALL surface as a typed local failure. Only evidence from the remote service may establish a remote cooldown or access revocation. Existing committed task and source-link identities SHALL survive local failures.

#### Scenario: Indexed data cannot be decoded

- **WHEN** a scan or summary contains malformed JSON
- **THEN** the read reports a local data failure, preserves the stored evidence and leaves remote access state unchanged

#### Scenario: A write fails during refresh or assignment

- **WHEN** a local write fails while applying a remote page, recording its diagnostic, or linking a source to a newly created task
- **THEN** the caller can identify the local failure and any open transaction rolls back its partial changes
- **AND** retrying an assignment continues to use its original source and request identity

### Requirement: Lifecycle creation requires evidence of absence

Lifecycle decisions that depend on absence of a retained clone, clone intent, pending checkout or OpenSpec change directory SHALL distinguish a missing entry from an unreadable or unusable entry. An inconclusive probe MUST stop the dependent creation or adoption step and preserve existing evidence.

#### Scenario: A path is unreadable or is a dangling link

- **WHEN** the controller checks an existing entry and cannot inspect it or verify the required identity
- **THEN** it returns a typed diagnostic before issuing the dependent clone or change-creation command

#### Scenario: An entry is genuinely missing

- **WHEN** the entry is absent and the existing ownership, intent and schema checks permit creation
- **THEN** the normal authorized creation path remains available
