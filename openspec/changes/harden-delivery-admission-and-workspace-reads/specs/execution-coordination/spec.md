# Spec Delta

## ADDED Requirements

### Requirement: Preserve setup approval answers on their original form

The controller SHALL retain the setup merge form identity and delivered commit before requesting approval. An approved or rejected answer SHALL be persisted on the retained receipt for that form, including when the first request observes the answer. The merge decision SHALL use current eligibility and exact-commit authorization.

#### Scenario: Immediate approval or rejection

- **WHEN** the first request observes approval for the setup PR head
- **THEN** reloading setup shows an authorized receipt for that form and commit even if another merge prerequisite still blocks progress.
- **WHEN** the first request instead observes rejection
- **THEN** reloading setup shows the rejected receipt and no merge has been submitted.

#### Scenario: Recollect an answer after restart

- **WHEN** the answer is available natively but the caller lost the response or receipt save was interrupted
- **THEN** retry observes the same session and form, records the decision once and rechecks the owned PR head before merge.
- **AND** a pending form stays pending and its answer cannot authorize a different commit.

### Requirement: Reserve capacity only from a complete count

Every decision to consume new capacity SHALL use a complete current count of issue and setup executions under reservation coordination. Unreadable records SHALL make free capacity unknown. An unknown count SHALL prevent a new reservation or native submission and preserve existing ownership for retry.

#### Scenario: A peer becomes unreadable during a capacity wait

- **WHEN** a worker becomes eligible to retry but an issue or setup record cannot be read at reservation time
- **THEN** the operator can see that capacity is unknown and the controller retains the waiting work without submitting its prompt.
- **WHEN** the record is repaired and the applicable global, repository and role limits permit admission
- **THEN** reconciliation admits the waiting turn once with its required evidence rechecked.

#### Scenario: Setup and worker capacity have different limits

- **WHEN** all records are readable and setup requests retained capacity while a worker requests an active slot
- **THEN** each decision counts current owners against the limits applicable to that request and preserves existing uncertain reservations.
