# Sandboxed lightweight execution

## Purpose

Let developers run a bounded fix in an isolated checkout and review its evidence through the existing AbraCode issue.

## ADDED Requirements

### Requirement: Reuse the local sandbox installation during development

A developer SHALL be able to bootstrap a named local cluster from versioned configuration and deploy a worker revision once or continuously during editing. Repeated setup, image rebuilds and stopping the development loop SHALL preserve existing actor identity, workspace snapshots and controller ownership. A running or suspended execution MUST retain its assigned worker revision.

#### Scenario: Developer rebuilds the worker with an outstanding issue

- **WHEN** the developer bootstraps again, deploys a new worker revision and stops the watch loop while a task is suspended
- **THEN** that task can resume on its original revision with its workspace, and the next execution can use the new revision without a cluster reset

### Requirement: Retain the execution environment at claim time

The controller SHALL support repository opt-in for sandboxed lightweight Apply and configured checks. It SHALL retain the selected mode for the execution. Omitted settings and previously retained executions without a selection SHALL use local execution.

#### Scenario: Repository opts in for future fixes

- **WHEN** a repository enables sandbox execution while a local fix is in progress
- **THEN** that fix continues locally and the next claimed lightweight fix uses the sandbox
- **AND** full OpenSpec and research work retain their existing behavior

#### Scenario: Selected sandbox is unavailable

- **WHEN** a sandboxed assignment cannot reach or authenticate its runtime
- **THEN** Work shows the blocker and preserves the assignment for recovery without starting a local worker

### Requirement: Admit one isolated writer for the approved assignment

The remote worker SHALL receive the pinned checkout and controller-authorized scope under the existing Apply role. It MUST lack access to the host worktree, controller records and publishing credentials. Admission, observation, pause and recovery SHALL use the retained execution generation, actor, worker session and prompt identities.

#### Scenario: Submission succeeds before its reply is lost

- **WHEN** the controller restarts after the remote server accepted a prompt but before it received confirmation
- **THEN** it reconciles the same prompt in the same actor and session, with at most one writer
- **AND** an unconfirmed admission keeps its reservation and exposes the uncertainty in Work

#### Scenario: Pause during remote Apply

- **WHEN** the developer pauses an admitted remote Apply turn
- **THEN** the controller targets the owned turn and releases its reservation only after confirming the worker stopped
- **AND** results from the superseded generation cannot advance the issue

### Requirement: Adopt only the candidate belonging to the current execution

The controller SHALL validate the returned Git content against the assigned base, current scope and workspace ownership before updating the owned local worktree. Recovery from a partial adoption MUST reconcile the actual local state before retrying. Only the adopted content may supply Apply attribution and the reviewable diff.

#### Scenario: Valid candidate

- **WHEN** the authorized worker finishes and the controller receives a candidate descended from the assigned base with the expected identities
- **THEN** the adopted content and its Apply attribution identify the same candidate and Work shows its diff

#### Scenario: Conflicting candidate or local edits

- **WHEN** a bundle belongs to another assignment, uses the wrong base, arrives after scope revision, or would overwrite unexpected local edits
- **THEN** adoption stops, preserves the local worktree and reports the reason without recording successful Apply attribution

### Requirement: Verify and deliver the same content

The controller SHALL obtain check results from a fresh isolated checkout of the adopted candidate using the captured verification commands. It SHALL bind success to the verified content and require matching independent Review and existing delivery authorization before branch preservation. The developer SHALL be able to inspect progress, blockers, diff and results through the existing Work view.

#### Scenario: A single slot completes a fix

- **WHEN** Apply has released its slot and its adopted fix passes the captured checks in a clean verifier
- **THEN** independent Review assesses that content and authorized delivery preserves it on the owned branch
- **AND** the controller retains evidence and retires only its owned resources

#### Scenario: Failed or stale checks

- **WHEN** a command fails, mutates checked content under existing verification rules, or the verifier result no longer matches the local candidate
- **THEN** the controller exposes the failure or mismatch and withholds a passing receipt and delivery
