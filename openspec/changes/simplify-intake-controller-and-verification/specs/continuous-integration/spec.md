# Spec Delta

## ADDED Requirements

### Requirement: Controller graph scenarios exercise production semantics

The default controller test fixture SHALL enforce the shipped graph's dependency, ownership, idempotency and history behavior. Tests SHALL run with private graph state and release it on failure and success.

#### Scenario: Claim with an open prerequisite

- **WHEN** a test creates a parent and dependent child and attempts to claim the child while the parent is open
- **THEN** the graph returns `NOT_READY`, preserves the child's previous status and records zero claim events
- **AND** after the parent's owner closes it, an eligible claim by the child’s owner succeeds and its history records one claim across an identical retry

### Requirement: Build checkout web assets once in routine Linux CI

Routine Linux CI SHALL build the checkout's production web assets once and use that output for tests of the built workspace. The job SHALL also verify plugin packaging and offline renderer preparation. Local full-test and full-build commands SHALL each prepare their prerequisites when run independently.

#### Scenario: Fresh Linux job

- **WHEN** routine CI runs against a clean checkout
- **THEN** the job builds the checkout web assets once, runs every routine test project, packages the plugin and prepares the offline renderer, with an identifiable failure if any step fails
- **AND** disposable installation journeys continue to build in their own installation roots when the journey verifies that behavior

#### Scenario: Standalone contributor commands

- **WHEN** a contributor invokes either the full test command or the full build command with the checkout's web output absent
- **THEN** the selected command builds the assets required for its own work
