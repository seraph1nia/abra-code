# safe-retirement Specification

## Purpose

Retire native worktrees only after their deliverables are preserved and keep ordinary generated files from requiring broad or implicit deletion authority.

## Requirements

### Requirement: Preserve deliverables before native retirement

Retirement SHALL verify the execution's resource identity, all worker/operation quiescence and current deliverable receipt before removing its exact native worktree without force. Research SHALL use its independently retained report receipt; coding SHALL use verified delivery preservation. Issue closure MUST follow verified resource retirement.

#### Scenario: Cleanup fails after delivery

- **WHEN** native retirement fails or the directory remains present
- **THEN** the issue stays incomplete and retains delivery evidence and the worktree reference for retry

#### Scenario: Resource identity is ambiguous

- **WHEN** a recorded directory no longer matches the native inventory or repository identity
- **THEN** the controller preserves the directory and requests recovery without substitute direct Git removal

### Requirement: Unexpected files prevent disposal

Tracked changes, unexpected untracked files and unapproved ignored paths SHALL prevent worktree disposal. An empty generated-path policy SHALL preserve the existing refusal behavior. Cleanup MUST never treat all ignored content as disposable.

#### Scenario: Unapproved ignored file remains

- **WHEN** an ignored local note exists outside configured disposable generated paths
- **THEN** cleanup names the retained file and requests explicit disposition

### Requirement: Generated-path disposal requires narrow authorization

Projects SHALL be able to explicitly configure exact worktree-relative generated-directory paths for disposal after deliverable preservation. Cleanup MUST reject unsafe, broad, escaping, tracked-containing or symlink-traversing selections, retain unknown content elsewhere and recheck ownership immediately before deletion. Effective cleanup policy SHALL be retained per execution and MUST NOT broaden through a later configuration edit.

#### Scenario: Approved dependency directory is the only remainder

- **WHEN** a preserved execution has only an explicitly configured owned dependency directory remaining
- **THEN** cleanup removes that directory, rechecks the worktree and retires it through the native interface

#### Scenario: Generated path contains an escaping link or tracked file

- **WHEN** an allowed-looking path traverses outside the worktree or contains versioned content
- **THEN** cleanup refuses deletion and preserves the affected execution for inspection

#### Scenario: Policy changes after work starts

- **WHEN** the project adds a disposable path while an execution is waiting for cleanup
- **THEN** that execution retains its original cleanup policy until an explicit policy revision is authorized

### Requirement: Interrupted cleanup is recoverable

Retirement progress and preservation receipts SHALL remain retained until closure is confirmed. Restart reconciliation SHALL distinguish already removed owned resources from uncertain or foreign resources and MUST never repeat disposal against a replacement worktree.

#### Scenario: Crash after native removal

- **WHEN** the worktree is removed but the process dies before recording closure
- **THEN** recovery verifies its absence against retained identity, closes the claimed issue and retains the session/report history
