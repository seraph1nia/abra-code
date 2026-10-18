# Spec Delta

## MODIFIED Requirements

### Requirement: Reuse correlated communication and central scheduling

Lead messages SHALL use the same retained identity, admission, acknowledgement and recovery contract as other controller-routed communication. Completion/blocker notices SHALL be durably routed to the registered lead and Abra as appropriate without competing schedulers or work graphs. Disabling a lead SHALL revoke new management work and message admission, reconcile queued instructions and preserve existing tasks and unresolved obligations. Scope/model/session revision SHALL revoke old new-admission authority while retaining historical requests, accepted replies and proposal provenance under their original revision. Parent notification loss SHALL NOT cause repeated management instructions or loss of accepted replies. Required lead responses SHALL follow the same bounded recovery/uncertainty/escalation contract without bypassing management capacity or diagnostic budgets. Already admitted automatic lead turns SHALL retain finite configured diagnostic authority rather than inheriting a user's explicit authority from their parent session.

#### Scenario: Assigned worker reports a blocker

- **WHEN** a worker opens an applicable obligation for work monitored by a lead
- **THEN** the lead receives a correlated scoped notice while human-owned approval remains routed to Abra

#### Scenario: Lead is disabled with queued work

- **WHEN** Abra disables the lead before another management request is admitted
- **THEN** the lead cannot create or admit new work, queued messages are reconciled, and existing controller-owned executions and obligations remain intact

#### Scenario: Single-supervisor installation upgrades

- **WHEN** no project leads are configured
- **THEN** the existing Abra workflow continues with no additional management sessions or authority changes

#### Scenario: Scope revision has historical requests

- **WHEN** a lead's repository scope changes with answered and unanswered historical requests
- **THEN** history retains original scope/revision provenance, old instructions gain no new authority and unresolved work receives explicit supersession or escalation

#### Scenario: Lead creation or parent notice response is lost

- **WHEN** native session creation or a committed reply notification loses its receipt across restart
- **THEN** reconciliation reuses retained session/message identities without duplicate task intake or fabricated response completion
