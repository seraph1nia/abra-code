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

Tracked changes, unexpected untracked files and unapproved ignored paths SHALL prevent worktree disposal. An empty generated-path policy SHALL preserve the existing refusal behavior. Cleanup MUST never treat all ignored content as disposable. After deliverable preservation is verified, ordinary file blockers SHALL be retained as structured cleanup diagnostics containing the owned worktree reference, blocker category, bounded worktree-relative path samples, explicit truncation/completeness information, observation time, the execution's effective generated-path policy and a concrete disposition action. Paths SHALL be represented safely as data, including whitespace and control characters, without reading file contents or following links. Diagnostics MUST NOT grant deletion authority or claim a path is disposable based on its name or ignore status. Failed or incomplete inspection MUST remain distinguishable from an empty blocker set.

#### Scenario: Unapproved ignored file remains

- **WHEN** an ignored local note exists outside configured disposable generated paths
- **THEN** cleanup names the retained file and requests explicit disposition

#### Scenario: Mixed generated and unknown residue remains

- **WHEN** authorized generated directories are removed but unapproved caches and an exported archive remain
- **THEN** diagnostics identify the remaining ignored paths, preserve them and explain that the operator must inspect and preserve or explicitly remove known disposable files before retrying finish

#### Scenario: Blocker inventory exceeds the output budget

- **WHEN** the remaining paths exceed a bounded sample or byte limit
- **THEN** diagnostics mark the sample truncated, avoid claiming an exhaustive inventory and provide a read-only inspection action for the owned worktree

#### Scenario: A path contains shell syntax or newlines

- **WHEN** a remaining filename contains whitespace, newlines or shell metacharacters
- **THEN** the path remains a distinct safely encoded data item and no executable cleanup command is constructed from it

#### Scenario: Inspection fails

- **WHEN** a path inspection cannot complete because a read fails or its resource identity is no longer valid
- **THEN** no clean-worktree result or disposal permission is inferred, and unavailable inspection or unsafe identity is reported with its actual classification

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

Retirement progress and preservation receipts SHALL remain retained until closure is confirmed. Restart reconciliation SHALL distinguish already removed owned resources from uncertain or foreign resources and MUST never repeat disposal against a replacement worktree. Ordinary file blockers SHALL remain readable after restart. Cleanup-only retry SHALL revalidate deliverable preservation, worker quiescence and owned resource identity, refresh or clear stale file diagnostics, and retire only through the non-force native interface. It MUST NOT repeat merge, require a new approval for unchanged preserved content or broaden the retained generated-path policy. Older records without structured diagnostics SHALL remain readable without fabricated path evidence.

#### Scenario: Crash after native removal

- **WHEN** the worktree is removed but the process dies before recording closure
- **THEN** recovery verifies its absence against retained identity, closes the claimed issue and retains the session/report history

#### Scenario: Files are disposed of after restart

- **WHEN** a preserved execution restarts with a retained cleanup blocker and the operator has explicitly moved or removed the remaining files
- **THEN** finish or eligible reconciliation revalidates preservation and resource identity, clears the resolved diagnostics, retires the exact worktree without another merge and closes the issue only after confirmed retirement

#### Scenario: New files appear before retirement

- **WHEN** files change after a previous blocker snapshot but before cleanup-only retry
- **THEN** fresh inspection governs disposal and the previous snapshot cannot authorize removing newly discovered content

#### Scenario: An older cleanup record has no path sample

- **WHEN** a supported retained execution has only a legacy cleanup error
- **THEN** status labels path details unavailable until authorized cleanup inspection records them, without converting an unsafe legacy recovery state into automatic cleanup
