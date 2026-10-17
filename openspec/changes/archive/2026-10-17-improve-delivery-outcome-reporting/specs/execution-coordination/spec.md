# Spec Delta

## ADDED Requirements

### Requirement: Merge approval collection has an independent outcome

Collecting a matching human merge approval SHALL commit and report its exact approval receipt independently of merge, retirement and closure. The approval request MUST NOT execute those downstream operations inline. An accepted receipt SHALL remain eligible for automatic deterministic reconciliation under the existing delivery gates without another user request or Supervisor model turn. Pending or rejected forms, changed content and manual pauses MUST retain their existing authorization semantics. A repeated collection of the same accepted receipt SHALL be idempotent even if reconciliation has already advanced the execution into cleanup or completion.

#### Scenario: Approval is collected while CI remains pending

- **WHEN** the user answers the merge form for the current delivered commit and collection commits that answer
- **THEN** the tool reports approval recorded separately from delivery waiting, and later eligible reconciliation continues after CI passes without requiring another approval for unchanged content

#### Scenario: Cleanup will be blocked

- **WHEN** a matching merge approval is collected and the worktree contains unapproved ignored files
- **THEN** approval collection succeeds without attempting cleanup, and any later cleanup blocker does not invalidate or relabel the recorded approval

#### Scenario: Reconciliation already consumed the approval

- **WHEN** approval collection is repeated after that exact accepted receipt has progressed into cleanup or completion
- **THEN** it reports the existing approval and current evidenced outcomes without creating a new form, merging again or failing solely because the phase advanced

#### Scenario: Approval target changes

- **WHEN** a pending or previously accepted form refers to a different delivered commit than the current approval target
- **THEN** the controller does not apply that authorization to the changed target and retains the applicable fresh-approval or stale-checkpoint behavior

### Requirement: Approval and finish contention is an observation

When an approval or finish request cannot acquire its execution's operation ownership because another operation holds it, the system SHALL promptly return a successful classified `operation_in_progress` observation. That observation SHALL distinguish the unexecuted requested action from independently evidenced progress, include a bounded next-observation action, and identify retained operation evidence only when available. It MUST NOT claim approval was recorded, merge is pending, another server exists or the requested action is queued solely because ownership is busy. The losing request MUST NOT overwrite operation intent, steal ownership, duplicate a form or mutate the execution. Other authorization, lock-system and unsafe recovery failures SHALL retain their native failure classification.

#### Scenario: Approval races with reconciliation

- **WHEN** background reconciliation owns an execution while a merge approval collection is requested
- **THEN** collection returns `operation_in_progress` with the latest available approval/delivery observations, performs no collection itself and directs the caller to observe again and recollect only if still needed

#### Scenario: Finish races with delivery

- **WHEN** a finish call encounters an owned merge operation whose external result has not yet been confirmed
- **THEN** it reports the operation in progress and delivery unconfirmed rather than asserting that the PR is still awaiting merge or that the merge failed

#### Scenario: Retained owner evidence is unavailable

- **WHEN** execution ownership is busy but a current retained operation cannot be read reliably
- **THEN** the response labels owner details unavailable and preserves the unexecuted request distinction without inventing controller or operation identity

## MODIFIED Requirements

### Requirement: Routine waits resume through reconciliation

Pending CI, required review, approval forms, declared dependencies, capacity and temporary transport failures SHALL retain an explicit reason and appropriate next observation. Routine waiting MUST NOT require manual recovery after the condition clears. Ordinary file blockers found after deliverable preservation SHALL retain `cleaning`, preservation evidence and a concrete file-disposition action; they MUST NOT be escalated to unsafe recovery solely because files remain. Repeated unchanged cleanup observations SHALL use bounded reinspection and deduplicated attention rather than repeated Supervisor model turns. An explicit finish or the next eligible reconciliation SHALL revalidate and continue cleanup after disposition. Unsafe identity conflicts and uncertain external effects SHALL remain distinct and blocked.

#### Scenario: Pending CI later succeeds

- **WHEN** an authorized exact-head delivery has pending CI and a later observation reports all required conditions satisfied
- **THEN** ordinary reconciliation continues delivery without a manual retry or new approval for unchanged content

#### Scenario: Required review arrives after restart

- **WHEN** the service restarts while an execution awaits required review and review subsequently passes
- **THEN** the next eligible reconciliation resumes using retained policy and exact-head evidence

#### Scenario: Ignored files block cleanup after merge

- **WHEN** delivery preservation is verified and an unapproved ignored path prevents worktree retirement
- **THEN** both explicit finish and background reconciliation retain `cleaning` with the same actionable cleanup blocker, keeping approval and delivery receipts intact

#### Scenario: Unchanged cleanup blocker is observed repeatedly

- **WHEN** several eligible observations find the same retained paths and preservation identity
- **THEN** the blocker remains visible with bounded next observation and one deduplicated attention incident rather than repeated diagnostic turns

#### Scenario: Worktree identity changes during cleanup

- **WHEN** the retained worktree identity no longer matches the actual owned resource
- **THEN** the controller reports unsafe recovery and does not convert the identity conflict into an ordinary file wait
