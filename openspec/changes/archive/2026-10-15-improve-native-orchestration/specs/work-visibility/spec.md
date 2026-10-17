# Spec Delta

## Purpose

Make execution outcomes, actionable decisions and preserved deliverables understandable through OpenCrew's existing native ticket views and management tools.

## ADDED Requirements

### Requirement: Present waits and next actions explicitly

Ticket views and status tools SHALL distinguish workflow phase, worker activity, external operation, routine wait, actionable failure and unsafe recovery. Each blocker SHALL expose its owner or dependency, relevant evidence and the next clearing action. Normal CI/review waits MUST NOT appear as recovery failures.

#### Scenario: Ticket awaits CI

- **WHEN** a delivered ticket is waiting on a named check
- **THEN** the operator sees the check reason and next observation rather than a generic recovery-required label

#### Scenario: Execution has stale ownership evidence

- **WHEN** mutation is stopped because the owned identity cannot be verified
- **THEN** the ticket remains visible under attention with the identity conflict and a recovery action

### Requirement: Preserve unresolved decisions in the work surface

The existing native work home, ticket detail and Supervisor tools SHALL expose open questions and their answer owner independently of the latest status message. Decision answers MUST use authorized controller/native-form routes and MUST NOT be inferred from navigation or read-only observer requests.

#### Scenario: Worker update follows a question

- **WHEN** a worker reports progress after opening a question
- **THEN** the ticket still shows the unresolved question and who owes its answer

### Requirement: Present policy-appropriate plans and deliverables

Full-spec tickets SHALL retain native planning/task views. Research tickets SHALL expose the report and evidence without fictional implementation-task progress. Lightweight tickets SHALL expose their recorded scope and verification/review evidence. Report and revision history SHALL remain accessible after worktree removal and service restart.

#### Scenario: Research ticket is opened after retirement

- **WHEN** an operator opens a completed research ticket whose worktree is gone
- **THEN** the retained report is readable with its source base, limitations and follow-on links

#### Scenario: Lightweight ticket has no OpenSpec directory

- **WHEN** a lightweight ticket's plan view is opened
- **THEN** it displays accepted scope and approval status without reporting missing full-spec artifacts as a failure

### Requirement: Explain compute and resource capacity separately

Readiness and operator views SHALL distinguish active-worker limits, role limits, retained-resource limits and dependency blocks. Releasing active capacity MUST NOT make the UI imply that an issue claim or preserved resource was released.

#### Scenario: Worker capacity is available but retained limit is full

- **WHEN** all worker turns are idle and the retained-execution limit is reached
- **THEN** queued work displays the retained-resource blocker and the executions consuming it

### Requirement: Retain native observer behavior

The observer SHALL remain read-only, use host theme/navigation primitives and preserve bounded lazy reads, keyboard navigation and retained offline snapshots. New schema/record failures MUST remain visible without making unrelated tickets or historical reports disappear.

#### Scenario: Disconnected observer has pending decisions

- **WHEN** the observer loses its connection
- **THEN** it keeps the last snapshot, marks freshness unavailable and does not imply that cached approval or progress information is current

#### Scenario: One record cannot be decoded

- **WHEN** a ticket contains an unsupported durable record
- **THEN** the observer shows its diagnostic while valid tickets and navigation continue to work
