# worker-policy Specification

## Purpose

Keep OpenCrew's managed role permissions consistent across native sessions, visible tools and execution guards while preserving controller-owned lifecycle authority.

## Requirements

### Requirement: Managed roles have one authoritative permission policy

The system SHALL derive native permissions, visible tool filtering and execution-time authorization for managed Supervisor, Explore, Apply, Review and Research sessions from one authoritative role policy. Role Markdown SHALL supply behavior and procedure guidance; Markdown text or frontmatter injected as context MUST NOT independently grant authority. Missing tools or conflicting instructions MUST NOT widen the policy.

#### Scenario: Native profile and request tool visibility disagree

- **WHEN** a native agent profile exposes a tool forbidden by its assigned OpenCrew role
- **THEN** the tool is excluded from the managed request and a direct invocation is rejected by execution-time authorization

#### Scenario: Role guidance claims additional authority

- **WHEN** role Markdown, a project instruction or a selected skill asks a managed worker to invoke a forbidden tool
- **THEN** the request does not grant permission and the existing role restriction remains effective

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

### Requirement: Capability requirements never grant permissions

Worker configuration SHALL accept optional required skill identifiers and required tool groups, where every tool group requires at least one listed alternative. Omitted declarations SHALL preserve compatibility with existing configuration. Requirements SHALL be combined with policy-required prerequisites and MUST NOT remove them, create a new role, install a skill, register a tool or expand the role's authority. Invalid declarations, including forbidden tool alternatives, SHALL produce a source-specific configuration diagnostic.

#### Scenario: Existing configuration has no additional requirements

- **WHEN** a role profile contains only its existing agent and model selection
- **THEN** the configuration remains valid and the role receives its policy-required prerequisites without additional configured requirements

#### Scenario: Native editing uses a model-specific alternative

- **WHEN** a writing role requires an editing capability represented by an alternative group and the model exposes only an allowed patch tool from that group
- **THEN** the group is satisfied without requiring tools the native runtime intentionally replaced

#### Scenario: Skill mentions a browser capability

- **WHEN** a required skill describes a browser workflow but browser tools are not allowed for the role
- **THEN** loading the skill does not enable a browser tool and an explicit forbidden tool requirement is rejected
