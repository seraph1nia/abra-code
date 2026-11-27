# Spec Delta

## ADDED Requirements

### Requirement: Deliver a required plan decision at the checkpoint

For every captured policy requiring plan or scope approval, the controller SHALL deliver a native decision for the validated revision to the retained Supervisor session as part of entering or reconciling the gate. If delivery is pending or unavailable, work SHALL remain held and expose the delivery owner and recovery action.

#### Scenario: Service stops between retention and delivery

- **WHEN** a validated plan enters its required gate and the service stops before the native form is observed
- **THEN** reconciliation resumes the same form identity for that revision, including after loss of a successful creation response
- **AND** the operator is asked to act once that form is answerable, without having to prompt Abra to create it

#### Scenario: Policy permits automatic progression

- **WHEN** the accepted policy permits work to continue without a human plan decision
- **THEN** planning advances through its existing prerequisite checks without raising a human approval item

### Requirement: Make each checkpoint response deliberate

The workspace SHALL offer explicit approval and request-changes actions for the bound plan revision or merge head. A revision request SHALL durably associate the person's feedback with that target, hold dependent work and enter the applicable correction or replan path. Only affirmative authorization for the current target may satisfy the gate.

#### Scenario: Read and dismiss an approval

- **WHEN** the person opens, inspects or dismisses the decision without choosing an action
- **THEN** no approval, rejection or feedback is recorded, including for a pending legacy boolean form

#### Scenario: Submit feedback while the response is lost or the revision changes

- **WHEN** the person requests changes and retries after losing the response
- **THEN** the original decision and feedback are recoverable once for that target, and any replacement requiring approval receives a fresh binding
- **AND** a first submission against an already superseded binding cannot affect the replacement

#### Scenario: Approve the proposed merge

- **WHEN** the authorized person explicitly approves the current head after inspecting its evidence
- **THEN** the controller records authorization for that head and rechecks the applicable delivery gates before merge, and the workspace reports delivery only on confirming evidence
