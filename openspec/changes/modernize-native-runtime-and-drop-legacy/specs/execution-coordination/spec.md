# Spec Delta

## ADDED Requirements

### Requirement: Guard concurrent pause, retry, attention and inbox state transitions

Pause stop-confirmation SHALL verify the paused control generation before clearing active worker state. Retry instructions SHALL be persisted across all resumable worker phases. Attention retries SHALL acquire the per-execution attention lock, Memos saves SHALL retry uncreated reservations after verified absence, concurrent GitHub inbox refreshes SHALL serialize fiber registration atomically, and project identity updates MUST NOT overwrite global project verification commands.

#### Scenario: Pause races with resume

- **WHEN** an execution is paused, confirmed stopped and resumed before a delayed pause confirmation acquires quiescence
- **THEN** the stale pause confirmation observes the advanced control generation and does not clear active state on the resumed execution

#### Scenario: Operator retries a failed worker phase with instructions

- **WHEN** an operator issues a retry with instructions for an execution in exploring, planning, applying or researching
- **THEN** the retry persists those instructions for the resumed worker turn rather than discarding them

#### Scenario: Attention retry overlaps background scan

- **WHEN** an explicit attention retry runs concurrently with a background attention scan for the same execution
- **THEN** per-execution locking serializes dispatch so at most one attention prompt is admitted

#### Scenario: Memos create fails transiently before verification

- **WHEN** a Memos save reserves a request key, fails transiently during creation and is retried after verified 404 absence
- **THEN** the retry re-attempts creation under the same idempotent memo identity instead of permanently wedging the request key

#### Scenario: Provision persists a discovered project identifier

- **WHEN** provisioning writes a newly discovered native project identifier for a repository whose execution captured older verification commands
- **THEN** only the project identifier is updated on the global project record and current repository verification configuration remains intact

## MODIFIED Requirements

### Requirement: Slow work does not monopolize shared coordination

Repository checks, external network calls (including thought-reference verification during intake), provisioning, process shutdown and resource retirement MUST execute without retaining a global coordination lock. Record commits SHALL fail closed unless coordination is explicitly wired, perform single-read validated commits, and avoid unnecessary full-store scans or unchanged rewrites during routine reconciliation ticks. Each slow mutating operation SHALL retain exclusive ownership of its execution until completion or confirmed interruption. Claims and capacity reservations SHALL remain atomic across independent controller processes.

#### Scenario: Unrelated work remains controllable during a long check

- **WHEN** one execution is running a check that remains active for several minutes
- **THEN** another execution can request approval, pause or retry without waiting for that check to finish

#### Scenario: Intake references an external thought

- **WHEN** work creation verifies an external thought reference
- **THEN** the network verification completes before acquiring the global coordination lock so concurrent readers and commits are not stalled

#### Scenario: Duplicate advancement is attempted

- **WHEN** two controller calls try to advance the same execution concurrently
- **THEN** at most one owns its external operation and the other observes the existing operation or a bounded busy result

#### Scenario: Unchanged obligation or finishing wait is rechecked

- **WHEN** reconciliation rechecks active waits or pending decisions whose state has not changed
- **THEN** no record rewrite or cache invalidation occurs

### Requirement: Cancellation finishes resource release safely

Process execution SHALL honor configurable command deadlines and bounded output retention. On cancellation or timeout, the execution MUST retain ownership until its child process group has stopped or an unresolved termination is explicitly reported. Lock-holder child processes SHALL report fast startup failures deterministically without hanging or treating arbitrary output as lock acquisition. Owned operation interruption SHALL persist uncertain status uninterruptibly, and preparation, preflight or external-validation failures and interrupts SHALL release unsubmitted preparing capacity reservations. A paused or interrupted native worker MUST be confirmed stopped before another writer is admitted. Raw output requests SHALL preserve meaningful whitespace.

#### Scenario: Child ignores graceful termination

- **WHEN** a check and its descendant ignore the initial termination signal
- **THEN** cleanup escalates, waits for termination and releases execution ownership only after verifying the stopped result

#### Scenario: Lock-holder child exits immediately on contention or error

- **WHEN** a child lock-holder process fails or exits with contention immediately after spawn
- **THEN** acquisition observes the exit and returns a typed lock error without hanging

#### Scenario: Owned operation is interrupted mid-flight

- **WHEN** the fiber driving an owned operation is interrupted before completion
- **THEN** finalization completes uninterruptibly to mark the operation uncertain rather than leaving it running on disk

#### Scenario: Worker admission fails or is interrupted during preflight or setup

- **WHEN** preflight, session setup or external validation fails or is interrupted before prompt admission
- **THEN** the preparing capacity reservation is released so worker slots do not leak

#### Scenario: Repository check exceeds the former blanket deadline

- **WHEN** a configured check has an explicitly longer deadline than ordinary Git or discovery commands
- **THEN** the check uses its configured deadline and remains observable without blocking other executions

#### Scenario: Output limit is reached

- **WHEN** a command exceeds the retained output budget
- **THEN** the system terminates or safely bounds the operation according to its command contract and reports the limit without allocating unbounded memory
