# Spec Delta

## Purpose

Preserve unanswered obligations and direct supervisory attention to work that needs reasoning while keeping routine coordination deterministic and quiet.

## ADDED Requirements

### Requirement: Questions have durable identity and an answer owner

An assigned worker SHALL be able to report a structured question with a stable key, execution generation, affected scope and answer owner. Open questions SHALL survive restart and unrelated messages until explicitly answered, cancelled or superseded. Workers MUST NOT authorize their own plan, merge, delivery or resource removal through this mechanism.

#### Scenario: Question survives a later status update

- **WHEN** a worker opens a question and later reports unrelated progress
- **THEN** the question remains open and visible with its owner and clearing action

#### Scenario: Duplicate question delivery

- **WHEN** the same worker retries the same keyed question after an uncertain response
- **THEN** the system returns the existing question rather than opening another obligation

#### Scenario: Worker asks to bypass a checkpoint

- **WHEN** a worker requests that a question answer substitute for required plan or merge approval
- **THEN** the controller continues to require the matching human authorization receipt

### Requirement: Declared waits are explicit and rechecked

The system SHALL retain the condition, owner, start time, optional bounded expiry and clearing action for a declared wait. Known approval and command waits SHALL use the same observable vocabulary. Expired or invalid waits MUST return to inspection rather than suppressing attention indefinitely.

#### Scenario: Worker declares a dependency wait

- **WHEN** an assigned worker reports waiting on a named dependency with a clearing condition
- **THEN** supervision records the wait and uses its bounded recheck cadence instead of classifying silence as immediate failure

#### Scenario: Wait expires without progress

- **WHEN** the declared deadline passes and no clearing evidence exists
- **THEN** supervision surfaces a new incident with the unresolved condition and current owner

### Requirement: Progress is distinct from busy state

Supervision SHALL evaluate native worker activity, explicit progress, running operations and declared waits separately. Repeated polling or a persistent busy flag MUST NOT reset the age of last meaningful progress. Suspected stalls SHALL produce bounded, deduplicated attention with evidence and MUST NOT by themselves authorize interruption, replacement or deletion.

#### Scenario: Busy worker stops advancing

- **WHEN** a worker remains busy beyond its configured progress threshold with no applicable declared wait or meaningful progress
- **THEN** the system creates a suspected-stall incident identifying the last progress and active operation

#### Scenario: Legitimate long operation remains declared

- **WHEN** a worker is waiting on an owned check that is still within its configured deadline
- **THEN** supervision presents the command wait and does not automatically kill the worker because chat output is quiet

### Requirement: Deliver actionable attention durably through native sessions

Attention requiring reasoning SHALL be persisted before admitting a Supervisor prompt and deduplicated by execution, incident generation and delivery identity. Restart recovery SHALL reuse the original admission identity. Delivery and handling MUST remain separate: an admitted prompt is not proof of a resolved incident. Routine successful polls and unchanged status MUST NOT create Supervisor model turns.

#### Scenario: Service dies after prompt admission

- **WHEN** attention reaches the Supervisor but the service dies before recording admission success
- **THEN** recovery reuses the retained prompt identity and does not create a second independent message for the incident

#### Scenario: Supervisor has not acted on admitted attention

- **WHEN** a prompt was admitted but no matching action or disposition was retained
- **THEN** the incident remains open and visible without repeatedly admitting fresh prompts

### Requirement: Autonomous corrective work is scoped and bounded

Corrective action SHALL follow an explicit per-execution policy with a finite turn/round budget. Defaults MUST preserve existing approval requirements and disable automatic repair unless configured. Changes outside the accepted scope, missing authorization, exhausted budgets and uncertain ownership MUST return control to the user with retained evidence. Model or provider substitution MUST remain explicitly configured.

#### Scenario: Repair budget is exhausted

- **WHEN** configured corrective rounds are consumed without successful verification
- **THEN** the system retains the execution and findings, stops automatic retries and presents a concrete next decision

#### Scenario: Proposed repair changes approved scope

- **WHEN** a proposed corrective action changes accepted requirements or constraints
- **THEN** execution requests revised planning authorization rather than treating the incident as standing permission

#### Scenario: User intentionally pauses work

- **WHEN** a user pauses an execution with unresolved attention
- **THEN** supervisory delivery does not restart the worker and the pause remains effective until explicitly resumed
