# Spec Delta

## ADDED Requirements

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
