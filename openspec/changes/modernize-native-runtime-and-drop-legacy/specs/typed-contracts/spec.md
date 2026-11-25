# Spec Delta

## ADDED Requirements

### Requirement: Initialize fresh storage schemas directly without migration ladders

The work-graph SQLite database SHALL initialize directly at schema version 1 with all current tables, columns and indexes, and SHALL reject incompatible versions cleanly instead of executing incremental upgrade ladders. Plugin-owned execution, project, setup, surface and review records SHALL validate exclusively against their current version-1 contracts without reading or writing legacy fallback keys.

#### Scenario: Fresh work database is opened

- **WHEN** a new work database is created on an empty path
- **THEN** all current work, dependency, batch, inbox and thought tables and indexes are created directly at schema version 1

#### Scenario: Database or record has an unsupported schema version

- **WHEN** the runtime opens a database or reads a durable record whose schema version does not match the current version
- **THEN** the incompatible version is rejected or isolated as an unavailable diagnostic without attempting a legacy migration

### Requirement: Validate version-1 durable records directly

Every plugin-owned execution, project, setup, operation, decision and attention record SHALL validate directly against its current version-1 contract without pre-versioning normalization or legacy archival. Records missing the required version, using an unknown version or representing an impossible state MUST remain preserved and unavailable for mutation, with actionable diagnostics.

#### Scenario: Current version-1 execution is loaded after restart

- **WHEN** a valid version-1 execution with pending approval is loaded after restart
- **THEN** decoding retains its native IDs, fingerprints, approval state and claim without issuing a new authorization

#### Scenario: Unversioned or corrupt record is encountered

- **WHEN** a scan encounters a record missing schema version 1 or failing current validation
- **THEN** the record remains preserved and visible as unavailable for mutation while other valid executions remain inspectable

### Requirement: Normalize work creation requests under one strict contract

Work creation arguments, normalized creation requests and persisted retry inputs SHALL derive from one owned family of validated contracts without legacy omitted-field fallback decoders. Normalization SHALL preserve title/description trimming, priority bounds, sorted unique dependencies, workflow/scope/report identity and the Supervisor-scoped implicit request key. Invalid inputs MUST NOT create partial graph or request records.

#### Scenario: Equivalent creation is retried

- **WHEN** the same request is retried with whitespace-normalized goal text or reordered duplicate dependencies
- **THEN** it resolves to the original normalized request and issue rather than creating independent work

#### Scenario: Saved request contains malformed data

- **WHEN** a persisted retry input cannot be decoded according to the current request contract
- **THEN** the system reports the invalid source without rebinding the request ID or changing the original issue

## MODIFIED Requirements

### Requirement: Observer errors have a declared domain contract

Expected observer and web-gateway failures SHALL have schema-defined error identities, safe user-facing messages and accurate HTTP status codes (`400` for invalid input, `404` for missing resources, `409` for stale/conflicting state, `503` for unavailable services) so clients can distinguish a missing issue, stale form or conflict from connection failure. Tagged native host errors SHALL map to declared domain errors rather than crashing as unexpected defects. Such errors MUST NOT mutate lifecycle state or hide unrelated readable work.

#### Scenario: Planning document is unavailable

- **WHEN** a planning-document read targets a retired worktree or an unavailable owned document
- **THEN** the observer returns its declared unavailable-resource error and the client can preserve the ticket and other readable views

#### Scenario: Native host returns a tagged not-found or unavailable error

- **WHEN** an in-process or client native call returns a tagged session-not-found or service-unavailable error
- **THEN** the boundary maps it to a declared domain error rather than terminating as an unhandled defect

#### Scenario: Web submission hits a stale form or conflict

- **WHEN** a browser request targets a changed form, invalid cursor or conflicting submission identity
- **THEN** the HTTP gateway returns the matching status code and safe actionable explanation instead of a generic conflict message

#### Scenario: Observer connection fails

- **WHEN** a read cannot reach the native service
- **THEN** the client identifies connection failure separately from a declared missing-resource error and keeps its last snapshot marked stale

### Requirement: Refactoring retains evidence and immutable identities

Internal restructuring SHALL preserve supported stored identities, approval bindings, captured policy and schema evidence, histories, uncertain effects and unknown additive evidence under the current version-1 contracts. New update interfaces MUST enforce the existing append-only and immutable-evidence rules. Unsupported data MUST remain preserved and unavailable for mutation.

#### Scenario: Existing execution resumes after upgrade

- **WHEN** an installation restarts on a compatible version-1 store while work has a pending approval, uncertain admission, external custody or incomplete cleanup
- **THEN** restart retains those exact obligations and identities without replay, fabricated historical evidence or new authorization

#### Scenario: Scoped update attempts to rewrite history

- **WHEN** a scoped write removes a prior reply, changes captured report inputs or replaces an immutable approval or publication identity
- **THEN** validation rejects the write and preserves the original record

#### Scenario: Future additive evidence is retained

- **WHEN** a compatible version-1 record containing unrecognized additive evidence receives a supported owned-field update
- **THEN** that evidence remains intact rather than being silently discarded

## REMOVED Requirements

### Requirement: Decode and migrate durable records explicitly

**Reason**: Greenfield fresh-start policy removes v0→v1 plugin record migration and `legacy-original/` archival; replaced by `Validate version-1 durable records directly`.
**Migration**: Start with a fresh `.abracode/` state directory using version-1 records.

### Requirement: Work creation uses one normalized contract

**Reason**: Replaced by `Normalize work creation requests under one strict contract`, dropping historical omitted-field legacy request decoders.
**Migration**: Start with a fresh `.abracode/` work database.

### Requirement: Action upgrades preserve historical authority and uncertainty

**Reason**: Greenfield fresh-start policy drops historical pre-current action schema upgrade paths and compatibility normalizers.
**Migration**: Start with a fresh `.abracode/` state directory; all PR actions use the current validated target and submission contract directly.
