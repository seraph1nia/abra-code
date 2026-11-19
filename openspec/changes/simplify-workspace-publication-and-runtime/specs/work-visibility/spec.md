# Spec Delta

## ADDED Requirements

### Requirement: Expose only committed generated surface revisions

A new generated layout SHALL become visible across workspace listings, exact reads, transcript attachments and snapshot saving only after its revision and required originating message association are durable and publication commits. Readers SHALL retain access to earlier committed revisions during replacement. Observation MUST be read-only.

#### Scenario: First publication stops after writing the revision

- **WHEN** a first revision has been reserved and written but its association or final commit is pending
- **THEN** the workspace offers no current layout, usable attachment or save for that revision, and an exact read reports it unavailable or pending

#### Scenario: Replacement pauses after its association is written

- **WHEN** revision two has its association but the final publication commit is pending
- **THEN** revision one remains current and eligible for an otherwise valid save, while revision two is unavailable in all public reads and actions
- **AND** once revision two commits, it becomes current, its exact attachment resolves, and the first revision remains historically readable

#### Scenario: Recovery retries the original native call

- **WHEN** restart or same-input retry reconciles an interrupted publication
- **THEN** it publishes the original captured layout, revision and call association exactly once, and a later retry of an older committed call preserves the newer current revision

#### Scenario: A supported older layout is opened

- **WHEN** an installation retains a valid old completed head, a head pending replacement, or a legacy latest-only layout
- **THEN** completed revisions and provable predecessors remain readable, pending replacements stay hidden until recovery commits, and latest-only layouts expose only their recorded revision and proven provenance

### Requirement: Bound repeated supervisor checks within one workspace observation

A read-only workspace observation SHALL check the current central supervisor once for the requested combination of recent receipts, generated surfaces, message attachments and projects. Section count MUST NOT multiply assignment-discovery scans. Scope-specific refreshes SHALL read only the requested sections. Subsequent observations and actions SHALL obtain fresh authorization.

#### Scenario: Fallback requests all four sections

- **WHEN** the periodic fallback requests all four sections in a populated workspace
- **THEN** those reads perform at most one supervisor assignment-discovery scan in total and return their existing authorized values, bounded windows, diagnostics and message associations

#### Scenario: Only receipt evidence changed

- **WHEN** the observer requests only recent receipts
- **THEN** it reads the receipt section and retains the previously observed values for the other three sections without fetching them

#### Scenario: Session eligibility changes after a successful observation

- **WHEN** the previous reader has ceased to qualify as the central supervisor and requests another observation or submits a guarded action
- **THEN** the request is checked against current authority and refused before protected data is returned or an action is admitted

### Requirement: Retain browser request identity before dispatch

Chat submission, interactive review feedback and saving a generated snapshot SHALL durably retain the exact request identity and input in the browser before dispatch. Reload or a lost response SHALL preserve the pending request for its original session and selection. Each action SHALL reconcile using its own receipt or explicit same-input retry.

#### Scenario: Browser storage rejects the initial snapshot save

- **WHEN** the operator selects Save snapshot and the browser cannot persist the request
- **THEN** the snapshot and task selection remain open, the browser sends zero save requests, and the operator sees that storage must be available before retrying

#### Scenario: Save succeeds but its response or local result write is lost

- **WHEN** the operator reloads and explicitly retries that snapshot save
- **THEN** the browser reuses the original request ID, task, surface, revision and other submitted inputs and recovers the original report
- **AND** choosing to save another snapshot after completion can create a distinct request

#### Scenario: Chat or feedback is pending after reload

- **WHEN** a session resumes with an existing pending chat submission or review response
- **THEN** the matching action restores its original input, checks its exact receipt and keeps missing or uncertain evidence pending without automatic resubmission
