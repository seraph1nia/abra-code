# Spec Delta

## Purpose

Allow Abra to retain project-specific management context in optional native sessions while one controller and explicit repository scopes govern all work and approvals.

## ADDED Requirements

### Requirement: Register persistent scoped management sessions

Abra SHALL be able to register an optional project lead with stable identity, exact allowed repositories, one native session identity, captured model/profile, parent Abra identity and enabled state. The lead SHALL be a management identity distinct from implementation-phase worker roles. Registration and restart reconciliation SHALL validate native session ownership, location and profile without silently rebinding an existing lead to another session. Abra SHALL remain the sole normal user conversation and human-form destination.

#### Scenario: Lead survives service restart

- **WHEN** the controller restarts with an enabled retained lead
- **THEN** it validates and reuses that lead's native session and scope without creating another orchestrator or session

#### Scenario: Registration names an unrelated session

- **WHEN** a stale or conflicting registration attempts to adopt a different session
- **THEN** the controller refuses ownership reassignment and preserves the existing registration

### Requirement: Enforce narrow project-management authority

A lead SHALL be able to inspect authorized project evidence, propose tasks, monitor assigned issues, route findings and answer supervisor-owned routine questions within its registered repositories. Every mutation and query SHALL validate enabled native caller identity and exact repository scope at invocation. Leads MUST NOT write project code, admit unmanaged writing sessions, change capacity or policy, approve protected checkpoints, merge, discard resources, close issues or delegate outside scope. Leads MUST NOT create other leads; only one management level beneath Abra SHALL be supported.

#### Scenario: Lead submits a task proposal

- **WHEN** an enabled lead proposes a task in an authorized repository
- **THEN** the proposal is retained for Abra's authorized intake/dispatch path without starting execution by itself

#### Scenario: Lead requests another project's work

- **WHEN** a lead queries or controls an issue outside its exact repository set
- **THEN** the controller refuses the action and discloses no unauthorized project evidence

#### Scenario: Lead attempts self-approval or recursive delegation

- **WHEN** a lead invokes protected approval, delivery, code-writing or lead-registration behavior
- **THEN** role and controller checks refuse it regardless of prompt text or profile

### Requirement: Reuse correlated communication and central scheduling

Lead messages SHALL use the same retained identity, admission, acknowledgement and recovery contract as other controller-routed communication. Completion/blocker notices SHALL be durably routed to the registered lead and Abra as appropriate without competing schedulers or work graphs. Disabling a lead SHALL revoke new management work and message admission, reconcile queued instructions and preserve existing tasks and unresolved obligations. Already admitted automatic lead turns SHALL retain finite configured diagnostic authority rather than inheriting a user's explicit authority from their parent session.

#### Scenario: Assigned worker reports a blocker

- **WHEN** a worker opens an applicable obligation for work monitored by a lead
- **THEN** the lead receives a correlated scoped notice while human-owned approval remains routed to Abra

#### Scenario: Lead is disabled with queued work

- **WHEN** Abra disables the lead before another management request is admitted
- **THEN** the lead cannot create or admit new work, queued messages are reconciled, and existing controller-owned executions and obligations remain intact

#### Scenario: Single-supervisor installation upgrades

- **WHEN** no project leads are configured
- **THEN** the existing Abra workflow continues with no additional management sessions or authority changes
