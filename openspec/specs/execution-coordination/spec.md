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

Pending CI, required review, approval forms, declared dependencies, capacity and temporary transport failures SHALL retain an explicit reason and appropriate next observation. Routine waiting MUST NOT require manual recovery after the condition clears. Unsafe identity conflicts SHALL remain distinct and blocked.

#### Scenario: Pending CI later succeeds

- **WHEN** an authorized exact-head delivery has pending CI and a later observation reports all required conditions satisfied
- **THEN** ordinary reconciliation continues delivery without a manual retry or new approval for unchanged content

#### Scenario: Required review arrives after restart

- **WHEN** the service restarts while an execution awaits required review and review subsequently passes
- **THEN** the next eligible reconciliation resumes using retained policy and exact-head evidence

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
