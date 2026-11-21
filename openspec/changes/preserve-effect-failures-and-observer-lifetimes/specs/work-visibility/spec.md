# Spec Delta

## ADDED Requirements

### Requirement: Each workspace subscriber owns its observation

Each live subscriber SHALL receive its own applicable baseline, ordered updates and terminal notification. This applies to repeated subscriptions to the same returned observation. Detaching a subscriber SHALL release its observation while preserving other subscribers, the native session and any existing admission.

#### Scenario: Two subscribers use one connection object

- **WHEN** a second subscriber attaches to the same observation after the first has seen the current epoch and sequence
- **THEN** the second receives its own full message and workspace state baseline before incremental updates
- **AND** detaching the first allows the second to continue observing the same native session

#### Scenario: A producer ends abnormally

- **WHEN** the producer of a live observation emits an invalid protocol event or exits unexpectedly
- **THEN** the affected subscriber receives exactly one bounded, sanitized error termination and releases its resources
- **AND** a later connection can establish a baseline without replaying the submitted prompt

#### Scenario: Two subscriptions observe the same admitted run

- **WHEN** subscribers observe one run with the same stable submission identity
- **THEN** each reports completion only from native evidence for that input and the native prompt is admitted at most once

## MODIFIED Requirements

### Requirement: Refresh committed work through native invalidations

The observer SHALL react to native invalidations for committed work changes in its OpenCrew home, including decision, report, registration and execution changes that need not produce a session-execution event. Invalidations SHALL be emitted only after the relevant durable commit, coalesced for bounded refresh and scoped to the correct home/locations. A transient post-commit coordination failure SHALL retain pending change scopes for bounded-delay retry while the publisher is live. They SHALL carry no mutation authority. Subscription loss, missed events or event-publication failure MUST remain recoverable through periodic reads and refresh after subscription/reconnection.

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

#### Scenario: Coordination fails with more changes pending

- **WHEN** a publisher has taken a committed scope, the coordination barrier fails transiently and more scopes arrive during retry
- **THEN** publication resumes after a successful barrier and covers all affected scopes, coalescing them where appropriate
- **AND** closing the publisher during backoff cancels the retry without replaying the committed mutation
