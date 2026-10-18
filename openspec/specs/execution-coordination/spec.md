# execution-coordination Specification

## Purpose

Coordinate independent tickets safely while slow operations, routine waits, cancellation and service restarts occur on a single orchestration host.

## Requirements

### Requirement: Slow work does not monopolize shared coordination

Repository checks, network calls, provisioning, process shutdown and resource retirement MUST execute without retaining a global coordination lock. Each slow mutating operation SHALL retain exclusive ownership of its execution until completion or confirmed interruption. Claims and capacity reservations SHALL remain atomic across independent controller processes.

#### Scenario: Unrelated work remains controllable during a long check

- **WHEN** one execution is running a check that remains active for several minutes
- **THEN** another execution can request approval, pause or retry without waiting for that check to finish

#### Scenario: Duplicate advancement is attempted

- **WHEN** two controller calls try to advance the same execution concurrently
- **THEN** at most one owns its external operation and the other observes the existing operation or a bounded busy result

### Requirement: Persist operation identity before side effects

The system SHALL retain each operation's identity, execution generation, expected input evidence and status before external submission. It MUST compare these values again before committing results. Recovery SHALL inspect postconditions before repeating a mutation whose outcome is uncertain.

#### Scenario: Result arrives after a pause or revision

- **WHEN** an operation completes after the execution generation or approved input has changed
- **THEN** its result cannot advance the execution or create a valid verification receipt

#### Scenario: Crash after a successful external push

- **WHEN** a process dies after pushing the intended commit but before storing success
- **THEN** recovery recognizes the exact remote ref and records success without pushing a different commit or creating another PR

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

### Requirement: Separate compute capacity from retained resources

The system SHALL expose independent global and repository limits for active native worker turns and retained incomplete executions. Idle approval, external wait and blocked work SHALL release active-worker capacity while retaining issue claims and counting toward retained-resource limits. Role-specific limits and uncertain admitted-worker reservations SHALL remain conservative.

#### Scenario: Held PR frees a worker slot

- **WHEN** an execution is idle awaiting merge approval and retained-resource capacity remains available
- **THEN** another eligible ticket can start within active-worker limits without releasing the held ticket's claim

#### Scenario: Retained-resource limit is exhausted

- **WHEN** incomplete executions reach the configured retained-resource limit
- **THEN** readiness reports that specific blocker even when active-worker slots are available

#### Scenario: Upgrade preserves the previous resource ceiling

- **WHEN** an old configuration has only max_workers and no retained limit
- **THEN** the migrated effective retained limit preserves the old ceiling until explicitly reconfigured

### Requirement: Cancellation finishes resource release safely

Process execution SHALL honor configurable command deadlines and bounded output retention. On cancellation or timeout, the execution MUST retain ownership until its child process group has stopped or an unresolved termination is explicitly reported. A paused or interrupted native worker MUST be confirmed stopped before another writer is admitted. Raw output requests SHALL preserve meaningful whitespace.

#### Scenario: Child ignores graceful termination

- **WHEN** a check and its descendant ignore the initial termination signal
- **THEN** cleanup escalates, waits for termination and releases execution ownership only after verifying the stopped result

#### Scenario: Repository check exceeds the former blanket deadline

- **WHEN** a configured check has an explicitly longer deadline than ordinary Git or discovery commands
- **THEN** the check uses its configured deadline and remains observable without blocking other executions

#### Scenario: Output limit is reached

- **WHEN** a command exceeds the retained output budget
- **THEN** the system terminates or safely bounds the operation according to its command contract and reports the limit without allocating unbounded memory

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

### Requirement: Admit ready work fairly through the existing scheduler

Configurable automatic scheduling SHALL use authoritative dependency readiness, claims, global/repository/role worker limits and retained-resource limits. It SHALL preserve priority while rotating among eligible repositories within an equal-priority group so one continuously busy repository cannot starve another. Paused work, missing authority, uncertain admission and conflicting ownership MUST prevent unsafe dispatch. One failed admission MUST NOT prevent unrelated eligible work. Cleared dependencies and released capacity SHALL be rechecked through normal reconciliation without another user prompt. Upgrades MUST preserve existing conservative automatic-scheduling settings.

#### Scenario: Three independent tasks share two worker slots

- **WHEN** automatic scheduling is authorized for three independent tasks with active worker capacity two and sufficient retained-resource capacity
- **THEN** two tasks start, the third reports its capacity reason, and releasing a slot permits the third to start automatically

#### Scenario: Dependency is not complete

- **WHEN** a task depends on an issue whose authoritative status is not closed
- **THEN** it remains dependency-blocked even if a worker claims completion

#### Scenario: Admission fails in another repository

- **WHEN** one repository's eligible task encounters a provider/configuration failure
- **THEN** eligible work in another repository can still be admitted within capacity and policy

#### Scenario: Restart occurs after native admission

- **WHEN** a retained capacity reservation has an uncertain native submission result
- **THEN** reconciliation preserves its claim/session/worktree identity and reservation until native evidence establishes the outcome

#### Scenario: Equal-priority repositories remain busy

- **WHEN** two repositories continuously offer eligible tasks at the same priority
- **THEN** successive available admissions rotate among those repositories rather than repeatedly selecting only the first one

### Requirement: Additional message turns obey execution capacity

A message admitted to an already running worker SHALL reuse that worker's existing capacity ownership. A message that would start an idle eligible worker SHALL obtain the existing role/repository/global capacity reservation before native admission. Queued or uncertain messages that can activate a worker SHALL remain conservatively counted until quiescence or cancellation is confirmed. Messaging MUST NOT revive an inactive phase, override a pause or create a second writer for the same execution. Completion observations SHALL distinguish the original assignment from outstanding message work before advancing checkpoints.

#### Scenario: Worker is busy when a message is queued

- **WHEN** an eligible running worker receives an authorized queued message
- **THEN** native queueing handles delivery without creating another worker or doubling its active slot

#### Scenario: Idle message recipient has no capacity

- **WHEN** a message would start an eligible idle worker and all worker slots are reserved
- **THEN** the intent stays pending with an accurate capacity reason instead of starting uncounted work

#### Scenario: Initial turn ends while a message is queued

- **WHEN** the assignment turn completes but an authorized message can still activate the session
- **THEN** the controller reconciles that message before releasing its capacity or admitting a conflicting lifecycle writer
