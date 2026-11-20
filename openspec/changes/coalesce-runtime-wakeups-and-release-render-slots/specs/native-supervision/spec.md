# Spec Delta

## ADDED Requirements

### Requirement: Bound background report recovery per central monitor

Each successful reconciliation and scheduler tick SHALL request background report recovery. Each central monitor SHALL allow at most one active recovery pass and one pending follow-up. Scheduling SHALL continue while recovery runs. Each pass SHALL read current durable report state and respect cross-process recovery ownership.

#### Scenario: Several ticks complete during a slow recovery pass

- **WHEN** several ticks complete while a recovery pass is still active
- **THEN** those ticks can finish and exactly one follow-up pass starts after the active pass ends
- **AND** the follow-up reads the current state, including report work recorded during the first pass

#### Scenario: A recovery pass fails

- **WHEN** a recovery pass reports an error and a further wakeup is pending or arrives later
- **THEN** the monitor records the failure and processes the wakeup while its scope is open

#### Scenario: The central monitor shuts down

- **WHEN** the monitor closes with one recovery pass active and another pending
- **THEN** it interrupts the active pass and discards the pending wakeup
- **AND** a restarted monitor can rediscover unfinished work from durable report records
