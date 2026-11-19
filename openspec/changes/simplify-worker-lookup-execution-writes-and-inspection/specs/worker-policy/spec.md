# Spec Delta

## ADDED Requirements

### Requirement: Resolve a known worker session from current assignment evidence

For a known worker session with a valid candidate ticket, the controller SHALL resolve membership from that ticket’s current execution without scanning unrelated executions. A lookup hint SHALL confer no authority. Each caller SHALL apply its current membership or active-worker rules, including any required role, phase, generation and stop checks. Missing or stale hints SHALL allow authoritative discovery of previously retained assignments.

#### Scenario: A known worker emits repeated progress events or invokes a guarded tool

- **WHEN** a worker with a valid candidate emits progress events or invokes a tool among 100 retained executions
- **THEN** each assignment lookup reads only the candidate execution with zero execution collection scans
- **AND** each operation applies its own existing checks before observing or acting

#### Scenario: A previous worker is still in the ticket’s history

- **WHEN** a session is retained in a correction or finishing round and a different worker owns the active role
- **THEN** historical membership remains discoverable and a command requiring active ownership is refused

#### Scenario: A peer changes or creates an assignment

- **WHEN** a candidate is stale, missing after restart, or predates an assignment committed by another controller
- **THEN** the controller resolves the session against authoritative retained evidence and can recover the lookup for later requests
- **AND** an absent hint cannot classify a managed worker as unmanaged or authorize a prompt or tool

#### Scenario: A worker loses authority between operations

- **WHEN** a pause, replacement or generation change commits after a successful lookup and before a later guarded operation
- **THEN** the later operation checks the current execution and enforces the applicable refusal
