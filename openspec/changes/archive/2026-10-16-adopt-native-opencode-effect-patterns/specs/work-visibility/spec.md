# Spec Delta

## MODIFIED Requirements

### Requirement: Retain native observer behavior

The observer SHALL remain read-only, use host theme/navigation primitives and preserve bounded lazy reads, keyboard navigation and retained offline snapshots. New schema/record failures MUST remain visible without making unrelated tickets or historical reports disappear. Expected read errors SHALL preserve other valid views and be distinguished from loss of the service connection. Request-local reuse of observations MUST NOT hide newer committed state from subsequent requests or supply cached authority to a mutating controller action.

#### Scenario: Disconnected observer has pending decisions

- **WHEN** the observer loses its connection
- **THEN** it keeps the last snapshot, marks freshness unavailable and does not imply that cached approval or progress information is current

#### Scenario: One record cannot be decoded

- **WHEN** a ticket contains an unsupported durable record
- **THEN** the observer shows its diagnostic while valid tickets and navigation continue to work

#### Scenario: One document read is unavailable

- **WHEN** a declared unavailable-resource error is returned for a selected planning document
- **THEN** the ticket snapshot and other valid views remain usable without claiming that the native service is disconnected

#### Scenario: Later read observes a new commit to work state

- **WHEN** a decision or execution changes after an observer request finishes
- **THEN** a subsequent observer request reads the newer committed state rather than reusing a previous request's cached authorization or readiness evidence

## ADDED Requirements

### Requirement: Refresh committed work through native invalidations

The observer SHALL react to native invalidations for committed work changes in its OpenCrew home, including decision, report, registration and execution changes that need not produce a session-execution event. Invalidations SHALL be emitted only after the relevant durable commit, coalesced for bounded refresh and scoped to the correct home/locations. They SHALL carry no mutation authority. Subscription loss, missed events or event-publication failure MUST remain recoverable through periodic reads and refresh after subscription/reconnection.

#### Scenario: Decision changes without worker activity

- **WHEN** a retained decision is resolved without a new worker execution event
- **THEN** the work view refreshes from committed data through the native invalidation path

#### Scenario: Unrelated home emits an event

- **WHEN** the client receives a work invalidation belonging to another OpenCrew home
- **THEN** the event does not select, mutate or refresh work for the current home

#### Scenario: Observer misses a notification

- **WHEN** the event subscription ends or a commit's notification is lost
- **THEN** periodic observation and refresh after reconnection eventually present the committed change without replaying a lifecycle action

#### Scenario: Publication fails after a durable mutation

- **WHEN** the durable action succeeds but its invalidation cannot be published
- **THEN** the action remains committed and is not reported as an uncommitted mutation that must be repeated solely because notification failed

### Requirement: Display native running and queued session state

Worker conversation activity SHALL use the host's synchronized native session and pending-prompt state. Known queued prompts SHALL remain distinguishable from idle conversations, including for off-screen worker sessions. Missing or failed synchronization MUST NOT be presented as authoritative idle state, and display data MUST NOT determine controller admission, approval or stop confirmation.

#### Scenario: Worker has a queued prompt

- **WHEN** a managed session has pending native prompt admission but no running provider turn
- **THEN** its work view indicates queued activity rather than presenting it as idle

#### Scenario: Newly discovered worker is off screen

- **WHEN** a new managed session appears while its conversation is not focused
- **THEN** the observer synchronizes its native status and pending state without stealing conversation focus

#### Scenario: Session synchronization fails

- **WHEN** worker status cannot be synchronized
- **THEN** the observer marks the presentation unavailable or stale rather than inferring confirmed worker quiescence

### Requirement: Panel navigation participates in native keymaps

Work-panel navigation SHALL use named host keyboard commands with the appropriate panel focus and input-mode scope. Shortcut help SHALL reflect the active native bindings, including user remapping. Panel commands MUST NOT consume ordinary prompt-editor or dialog input, and disposing the panel/plugin SHALL remove its commands and in-flight view work.

#### Scenario: Navigation shortcut is remapped

- **WHEN** the user changes a work-panel navigation binding
- **THEN** dispatch and displayed shortcut help follow the native remapping rather than a hardcoded shortcut

#### Scenario: User types in an editor or dialog

- **WHEN** a text editor or nested dialog owns input focus
- **THEN** panel Home/Back navigation does not intercept its ordinary input

#### Scenario: Panel is disposed during a read

- **WHEN** the panel/plugin is disposed while a detail or diff read is pending
- **THEN** its scoped requests and command registrations are released and a late response does not overwrite another selection or a disposed view
