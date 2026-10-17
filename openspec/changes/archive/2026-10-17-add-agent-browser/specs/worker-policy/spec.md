# Spec Delta

This dependent delta modifies the requirement introduced by `unify-worker-policy-and-context`. That capability is not yet in the canonical inventory at proposal time; sync that predecessor before applying or archiving this delta. The complete source requirement was read from its tracked delta, and this change does not modify the predecessor's artifacts.

## MODIFIED Requirements

### Requirement: Preserve role boundaries and controller checkpoints

Explore SHALL edit only its assigned planning change and SHALL have no delegation authority. Explore, Review and Research SHALL be permitted to invoke agent-browser through native shell tooling under the browser command exception, while unrelated shell commands remain denied. Review and Research SHALL retain read-only repository scope with role-specific report submission; browser screenshots SHALL use their assigned scratch evidence directory. Apply SHALL retain development shell and owned-worktree file editing under the documented trusted-process boundary. The Supervisor SHALL retain central management authority without native implementation or shell tools. Workers MUST NOT authorize plans or merges, deliver changes, remove execution resources or close issues. Closing a worker's own named browser through the CLI SHALL NOT authorize removing native sessions, worktrees or execution resources. Inactive, replaced or wrong-role sessions MUST NOT acquire execution authority from retained context.

#### Scenario: Planning edit escapes through a path or move

- **WHEN** Explore attempts to edit source, follow an escaping symlink or move a file outside its assigned change
- **THEN** authorization rejects every affected path before mutation

#### Scenario: Historical worker submits a tool call

- **WHEN** a previously assigned session invokes a tool after another session owns the active role
- **THEN** the invocation is rejected even if the historical session retains valid context records

#### Scenario: Worker requests delivery through a capability declaration

- **WHEN** a worker profile declares a required management or delivery tool
- **THEN** the prerequisite is rejected as outside the role policy and no controller checkpoint is bypassed

#### Scenario: Browser access does not grant general development access

- **WHEN** Explore, Review or Research uses the native shell tool for an allowed agent-browser command and then attempts an unrelated development command
- **THEN** the browser command is permitted and the unrelated command is denied
- **AND** the role's native editing and management restrictions remain effective
