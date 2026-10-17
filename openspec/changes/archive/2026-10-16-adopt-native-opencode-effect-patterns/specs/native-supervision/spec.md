# Spec Delta

## ADDED Requirements

### Requirement: Validate worker selection at its native location

Before admitting a new worker prompt, the system SHALL resolve its configured or inherited agent and model against the native inventory at the assigned worktree location and validate the tool capability required for its role. A missing selection or incompatible capability SHALL produce an actionable configuration blocker without silently substituting an agent, model or provider. If inventory is unavailable, admission SHALL retain its intent and identity for a later explicit or ordinary eligible recovery rather than optimistically submitting the prompt.

#### Scenario: Configured agent does not exist in the worker location

- **WHEN** a configured worker agent exists centrally but is absent from the assigned worktree's native inventory
- **THEN** the controller reports the location-specific selection error before submitting the worker prompt and preserves owned resources and recovery identities

#### Scenario: Selected model cannot execute required tools

- **WHEN** the resolved model inventory declares that the selected model lacks tool capability required by the worker role
- **THEN** admission is blocked with a specific capability diagnostic and no alternative model is selected automatically

#### Scenario: Valid inventory does not prove provider availability

- **WHEN** an inventory-valid selection later encounters a provider or credential failure
- **THEN** normal native failure observation and the existing explicit retry policy apply without treating preflight as provider-success evidence

### Requirement: Long custom tools expose bounded native progress

Long controller-owned setup, verification and delivery tools SHALL expose bounded live progress on their native tool call when execution milestones or command-output counts advance. Updates SHALL identify the operation phase without leaking raw environments, credentials or unrestricted output. Live tool progress MUST remain separate from retained recovery evidence and MUST NOT by itself authorize completion, reset meaningful worker-progress age on unchanged heartbeats or bypass cancellation ownership.

#### Scenario: Repository verification produces output

- **WHEN** a controller-owned check emits additional output while its originating native tool call is active
- **THEN** the tool displays a bounded phase/count update and the durable command wait and configured deadline remain authoritative

#### Scenario: Progress display cannot be delivered

- **WHEN** a post-milestone progress update cannot be displayed
- **THEN** durable results and ownership are preserved and no completed side effect is repeated merely to deliver the progress display

### Requirement: Diagnose operations with bounded correlation and measurements

Operational diagnostics SHALL correlate relevant execution activity with its issue, execution, generation and operation identities when available. The system SHALL expose bounded measurements of reconciliation duration, admission waits, provider failures and observer requests without using individual issue/session identities as metric labels. Diagnostics and measurements MUST NOT expose secrets, raw provider bodies or unlimited command content and MUST NOT become lifecycle authority.

#### Scenario: Correlated operation fails

- **WHEN** an owned operation fails after admission
- **THEN** its diagnostics identify the applicable execution/generation/operation and safe failure classification so the operator can locate retained evidence

#### Scenario: Many issues produce measurements

- **WHEN** many different issues run and observers refresh repeatedly
- **THEN** measurement labels stay within the declared finite categories rather than creating a distinct metric series for each issue or session
