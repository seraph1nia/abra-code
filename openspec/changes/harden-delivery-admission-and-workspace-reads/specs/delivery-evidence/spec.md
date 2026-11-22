# Spec Delta

## ADDED Requirements

### Requirement: Publish the commit bound to final review

Final delivery SHALL bind a commit whose Git tree matches the controller’s retained tree before a remote write. Each publication attempt SHALL use that immutable commit and the owned destination. Success SHALL require confirmation of the exact remote branch head and, for PR delivery, the matching owned PR, target and head.

#### Scenario: Work changes after review

- **WHEN** the prepared commit's tree differs from the retained tree
- **THEN** delivery refuses publication before changing the remote branch or PR.
- **WHEN** the local branch moves or the worktree changes after a valid commit is bound
- **THEN** the attempt can publish only the bound commit and preserves the later work for inspection.

#### Scenario: Retry after a lost push or PR creation response

- **WHEN** a final delivery restarts with a retained publication binding and the owned remote branch already points to that SHA
- **THEN** recovery uses the original binding, reconciles the existing branch and PR, and avoids a duplicate push or PR.
- **AND** a conflicting remote head or mismatched PR results in a diagnostic and preserves the conflicting state for inspection.

#### Scenario: A newly created PR points elsewhere

- **WHEN** the forge reports PR creation but subsequent observation identifies a different head or target
- **THEN** delivery withholds successful publication evidence and the transition to awaiting merge.

#### Scenario: Branch-only publication

- **WHEN** the project uses preserved-branch delivery
- **THEN** final delivery confirms the exact SHA at the intended remote ref before recording success without requiring a PR.
