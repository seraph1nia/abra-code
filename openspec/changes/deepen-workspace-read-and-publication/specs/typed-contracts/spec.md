# Spec Delta

## ADDED Requirements

### Requirement: Interactive reviews expose only committed revisions

Review observations SHALL distinguish committed revisions, pending publication and unavailable evidence. A reserved revision MUST NOT be presented by the list, direct reads or transcript attachments as committed until its record, referenced assets and required association are durable. Publication SHALL preserve the prior committed revision until that point.

#### Scenario: A replacement publishes while a user reads the review

- **WHEN** an existing review has a committed revision and a replacement awaits its required association or final commit
- **THEN** a default read still selects the prior committed revision subject to its normal source checks
- **AND** an explicit read of the reserved revision identifies pending or unavailable publication without disclosing it as committed

#### Scenario: The first review publication is interrupted

- **WHEN** a review has a durable reservation and no committed revision
- **THEN** observers have no new committed review until publication completes, and any explicit pending observation carries the corresponding status

### Requirement: Interactive review publication reconciles the original identity

Retry and restart SHALL reconcile compatible pending review publications using the same session, native call, source, revision and content identities. Stale retries and corrupt evidence MUST NOT overwrite a newer commit. Failure to reconcile SHALL retain a scoped diagnostic and preserve independently readable reviews.

#### Scenario: Restart follows a partial publication

- **WHEN** the owner stops after reservation or after an immutable write before the commit becomes visible
- **THEN** recovery publishes the same revision once or exposes the unresolved evidence and preserves its identity for retry
- **AND** existing feedback drafts, response reservations and native admission receipts keep their original identities

#### Scenario: A supported earlier record contains a pending head

- **WHEN** the service reads a supported retained head from an earlier installation after an interrupted publication
- **THEN** it recovers proven committed evidence or reports it unavailable without inventing a commit, reusing another native call or downgrading the current revision

#### Scenario: A pending review cannot be reconciled

- **WHEN** a retained pending review has inconsistent identity or required evidence is unavailable
- **THEN** recovery retains a diagnostic for that review and permits independent reviews to remain readable and recoverable

### Requirement: Lifecycle filesystem checks distinguish absence from failure

OpenSpec archive and owned worktree provisioning SHALL interpret only confirmed absence as missing. Failed observation of a required path or directory listing MUST preserve its failure classification and stop the dependent creation, archive or success decision until the evidence can be read.

#### Scenario: A directory is genuinely absent

- **WHEN** an expected first-use archive or worktree directory is confirmed missing and all other preconditions are satisfied
- **THEN** the operation follows the supported missing-directory path

#### Scenario: A listing cannot be read

- **WHEN** permission or I/O failure prevents checking for existing archives or orphan worktrees
- **THEN** the operation reports the failing observation and performs no dependent archive or worktree creation

#### Scenario: Archive completion cannot be observed

- **WHEN** checking the active change after an archive operation fails for a reason other than confirmed absence
- **THEN** the controller retains an unresolved archive result and does not record successful completion
