# Spec Delta

## Purpose

Keep the repositories AbraCode intends to manage in its personal YAML while retaining native registration, inspection and active execution evidence as separate runtime responsibilities.

## ADDED Requirements

### Requirement: Declare intended repository settings in the personal configuration

The personal configuration SHALL hold repository declarations with stable IDs, remote URLs or supported existing checkout paths, target selection, verification commands and optional execution policies. Runtime registrations SHALL retain inspected identity, resolved local paths, native project IDs and setup/readiness evidence. A valid declaration alone MUST NOT be represented as an inspected or ready registration and MUST NOT authorize project initialization, verification command execution or delivery.

#### Scenario: User adds a remote to YAML

- **WHEN** a valid repository declaration exists but has not been reconciled
- **THEN** configuration inspection identifies it as declared/pending and work admission does not assume registration or readiness

#### Scenario: Repository needs setup

- **WHEN** explicit reconciliation inspects a declared repository lacking OpenSpec or verification setup
- **THEN** its registration exposes the existing setup blockers without initializing or modifying the target branch implicitly

### Requirement: Save repositories added through Abra to configuration

An explicitly requested repository add or settings update through Abra SHALL persist the intended declaration in the selected YAML and apply it through the existing inspected registration route. Successful results SHALL distinguish declaration persistence from registration/readiness and identify any remaining blocker. Unrelated configuration and comments SHALL be preserved. Writes SHALL be atomic and serialized, detect conflicting external edits, and reuse stable operation identity on retry.

#### Scenario: Abra adds a requested repository

- **WHEN** the user asks Abra to add a repository and its declaration and inspected registration succeed
- **THEN** the repository remains declared after restart and no second personal registry file must be edited

#### Scenario: User edits YAML while Abra prepares an update

- **WHEN** the file changes after it was read for a pending update
- **THEN** the update detects the conflict and preserves the user's changes rather than overwriting the file

#### Scenario: Configuration cannot be written

- **WHEN** the declaration file is read-only or atomic replacement fails
- **THEN** the action reports an unpersisted declaration and does not claim a completed add backed only by a hidden runtime registration

### Requirement: Reconcile declarations explicitly and recover partial work

A documented apply route and Abra's repository tools SHALL reconcile desired declarations through identity validation and existing onboarding inspection, with bounded per-repository outcomes. Static validation and ordinary startup MUST NOT clone, fetch or register declarations automatically. Repeated apply of unchanged declarations SHALL preserve registration identity and MUST NOT create duplicate clones or registrations. Partial configuration/registration progress SHALL remain inspectable and retryable without pretending that YAML and native storage committed atomically.

#### Scenario: YAML persists but remote inspection fails

- **WHEN** the declaration has been saved and the remote cannot be inspected
- **THEN** the action reports saved configuration with a pending/failed registration and retry reuses that declaration

#### Scenario: Apply is interrupted after registration

- **WHEN** registration may have succeeded before the response was lost
- **THEN** a retry reconciles the existing stable identity before attempting another registration

#### Scenario: Static inspection is requested

- **WHEN** the user validates or displays configuration
- **THEN** the command reports declaration status without running the apply route

### Requirement: Configuration changes do not silently retarget active work

Applying declaration changes SHALL update settings for subsequent work while preserving active executions' captured remote/base, target, verification, approval and delivery evidence. Equivalent remotes SHALL be normalized for duplicate detection. A stable ID MUST NOT be silently rebound to another repository. Changes requiring a repair of active work SHALL be surfaced through existing controller gates.

#### Scenario: Target branch changes while a PR is active

- **WHEN** the declaration is changed and applied during an active execution
- **THEN** new work uses the new target selection and the active execution retains its recorded delivery target

#### Scenario: Same repository is declared through equivalent URLs

- **WHEN** declarations use equivalent SSH and HTTPS identities under different IDs
- **THEN** validation/reconciliation reports the duplicate rather than registering separate repositories

### Requirement: Removing a declaration never implicitly removes resources

Removing a repository declaration SHALL prevent new work for that undeclared registration and SHALL expose any retained registration and owned work as no longer declared. Existing work and history SHALL remain inspectable and retain their existing recovery/lifecycle routes. Configuration application MUST NOT delete clones, worktrees, sessions or issues, close active work, revoke a recorded receipt or rebind an ID to simulate removal.

#### Scenario: User removes an active repository from YAML

- **WHEN** the changed configuration is applied
- **THEN** new starts are blocked for that registration, active resources and history remain preserved, and the result explains their retained status

#### Scenario: User restores the same declaration

- **WHEN** a previously omitted repository is declared again with the same verified identity
- **THEN** reconciliation reuses its existing registration and history without creating a second resource set
