# Spec Delta

## ADDED Requirements

### Requirement: Present PR feedback and corrective progress

The existing native ticket views and status tools SHALL expose PR observation freshness/completeness, CI and discussion findings with source links, original versus assessed head, handling disposition, diagnostic state, consumed/remaining repair budget and the next clearing action. Waiting for CI, diagnosing feedback, repairing, waiting for reviewer and needing a user decision SHALL remain distinguishable. Retained feedback and correction history SHALL remain inspectable after restart and retirement. Opening or refreshing feedback MUST remain read-only; disposition, correction and approval actions SHALL use authorized controller routes with current identities.

#### Scenario: Ticket is repairing its first round

- **WHEN** a correction is active with one round consumed from a two-round budget
- **THEN** ticket detail identifies round 1/2, the selected findings and whether verification and independent review are pending

#### Scenario: Last observation cannot be refreshed

- **WHEN** the latest observation failed or is incomplete
- **THEN** the ticket shows the last observation as stale or unconfirmed without presenting cached feedback clearance as current merge readiness

#### Scenario: User opens the feedback view

- **WHEN** an operator opens a finding or follows its source link
- **THEN** no diagnostic budget is consumed and no finding is accepted, repaired, resolved or authorized by navigation

### Requirement: Explain effective quality separately from autonomy

Project and execution policy views SHALL show the selected quality profile or legacy/custom policy, workflow, effective CI and plan approval, independent Review, merge authority, diagnostic budget and repair budget separately. Active execution views SHALL display their retained snapshot rather than implying that newly edited repository policy already applies. Policy-changing controls SHALL use validated central registration/intake routes and MUST NOT grant authorization through read-only observer RPCs.

#### Scenario: Quality profile is customized

- **WHEN** an execution uses standard with an explicit CI override and human merge approval
- **THEN** its view identifies the custom override and required human merge decision separately

#### Scenario: Project settings change after admission

- **WHEN** a registered project has newer settings than an active execution
- **THEN** the execution view shows its original effective snapshot and the policy source without claiming it adopted the newer settings

### Requirement: Present automation and external custody explicitly

Ticket views and status tools SHALL expose provisional versus final published head, draft/ready state, reviewer suggestions and request receipts, prepared/sent/uncertain public actions, CI rerun attempts and remaining budget, and external validation run/gate/custody state. Controls for these actions SHALL use explicit central controller routes and show the applicable authority and exact target before admission. A pause SHALL distinguish suppression of future controller actions from confirmation that an external process has stopped. External success MUST NOT be displayed as completed native verification, merge or cleanup.

#### Scenario: A public action has an uncertain result

- **WHEN** a reply, reviewer request or rerun may have reached GitHub without a confirmed result
- **THEN** the ticket displays the exact pending action and reconciliation requirement rather than inviting an unguarded duplicate send

#### Scenario: External validation is parked

- **WHEN** the external engine owns the branch and waits at a decision gate
- **THEN** the operator sees the retained run, finding, answer owner and supported next action without being offered a concurrent native writer
