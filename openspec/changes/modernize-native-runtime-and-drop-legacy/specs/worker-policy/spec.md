# Spec Delta

## ADDED Requirements

### Requirement: Require explicit agent catalog and isolated startup profile loading

Configured execution creation SHALL require the agent catalog dependency explicitly without silent legacy fallbacks. Plugin startup profile registration SHALL isolate corrupt or incompatible retained context records as diagnostics without failing plugin activation for valid work.

#### Scenario: Configured execution is constructed without an agent catalog

- **WHEN** a caller constructs a configured execution without supplying the agent catalog service
- **THEN** the requirement is enforced at the typed service boundary rather than falling back to legacy selection

#### Scenario: One retained context record is corrupt at startup

- **WHEN** the plugin activates in a location where a single retained context record is unreadable or incompatible
- **THEN** startup isolates that record as a diagnostic and completes plugin registration for valid work

## MODIFIED Requirements

### Requirement: Managed roles have one authoritative permission policy

The system SHALL derive native permissions, visible tool filtering and execution-time authorization for managed Supervisor, Explore, Apply, Review and Research sessions from one authoritative role policy. Worker-only and lead-only tools MUST be excluded from the central Supervisor's advertised tool list. Built-in and custom agent tools SHALL share strict excess-property validation and redacted tool-error reporting with stable error codes. Role Markdown SHALL supply behavior and procedure guidance; Markdown text or frontmatter injected as context MUST NOT independently grant authority. Missing tools or conflicting instructions MUST NOT widen the policy.

#### Scenario: Native profile and request tool visibility disagree

- **WHEN** a native agent profile exposes a tool forbidden by its assigned OpenCrew role
- **THEN** the tool is excluded from the managed request and a direct invocation is rejected by execution-time authorization

#### Scenario: Central Supervisor inspects its available tools

- **WHEN** a model request is shaped for the central Supervisor session
- **THEN** worker-only and lead-only tools are excluded from the advertised tool set

#### Scenario: Role guidance claims additional authority

- **WHEN** role Markdown, a project instruction or a selected skill asks a managed worker to invoke a forbidden tool
- **THEN** the request does not grant permission and the existing role restriction remains effective

### Requirement: Preserve role boundaries and controller checkpoints

Explore SHALL edit only its assigned planning change and SHALL have no delegation authority. Explore, Review and Research SHALL be permitted to invoke agent-browser through native shell tooling under the browser command exception, while unrelated shell commands remain denied. Review and Research SHALL retain read-only repository scope with role-specific report submission; browser screenshots SHALL use their assigned scratch evidence directory. Apply SHALL retain development shell and owned-worktree file editing under the documented trusted-process boundary. Protected control-path checks (`.git`, `.opencode`, `AGENTS.md`) MUST evaluate both the requested path and its symlink-resolved realpath case-insensitively. The Supervisor SHALL retain central management authority without native implementation or shell tools. Approval and obligation-resolution endpoints MUST enforce central Supervisor identity and reject cross-execution workers and project leads. Missing external-custody worktrees MUST NOT break shell commands in unrelated directories. Workers MUST NOT authorize plans or merges, deliver changes, remove execution resources or close issues. Closing a worker's own named browser through the CLI SHALL NOT authorize removing native sessions, worktrees or execution resources. Inactive, replaced or wrong-role sessions MUST NOT acquire execution authority from retained context.

#### Scenario: Planning edit escapes through a path or move

- **WHEN** Explore attempts to edit source, follow an escaping symlink or move a file outside its assigned change
- **THEN** authorization rejects every affected path before mutation

#### Scenario: Worker edits a protected file through an in-worktree symlink

- **WHEN** an Apply worker attempts to write through a symlink inside the worktree pointing to `.git/config` or `.opencode/opencode.json`
- **THEN** realpath-resolved control-path validation rejects the edit before mutation

#### Scenario: Cross-execution worker or lead attempts approval or obligation resolution

- **WHEN** a worker assigned to a different issue or a project lead invokes plan/merge approval or obligation resolution
- **THEN** the controller rejects the caller before mutating approval or decision state

#### Scenario: External-custody worktree was removed on disk

- **WHEN** a shell command runs in an unrelated directory while an execution with external custody references a missing worktree path
- **THEN** the shell hook handles the missing path gracefully without failing the unrelated command

#### Scenario: Historical worker submits a tool call

- **WHEN** a previously assigned session invokes a tool after another session owns the active role
- **THEN** the invocation is rejected even if the historical session retains valid context records

#### Scenario: Apply updates repository guidance

- **WHEN** the current Apply worker edits a repository `AGENTS.md` within its owned worktree and approved scope
- **THEN** native file tools permit the edit without granting controller authority
- **AND** worktree containment, `.git` and `.opencode` protection, planning-only Explore writes and read-only Review/Research restrictions remain effective

#### Scenario: Worker ownership checks agree across entry points

- **WHEN** a prompt, native tool call, context observation or worker report identifies a stopped, replaced, wrong-role or wrong-phase worker, or supplies a stale generation
- **THEN** the shared assignment policy rejects that operation at its existing validation point

#### Scenario: Worker requests delivery through a capability declaration

- **WHEN** a worker profile declares a required management or delivery tool
- **THEN** the prerequisite is rejected as outside the role policy and no controller checkpoint is bypassed

#### Scenario: Browser access does not grant general development access

- **WHEN** Explore, Review or Research uses the native shell tool for an allowed agent-browser command and then attempts an unrelated development command
- **THEN** the browser command is permitted and the unrelated command is denied
- **AND** the role's native editing and management restrictions remain effective

## REMOVED Requirements

### Requirement: Instruction cleanup preserves captured admission authority

**Reason**: Greenfield fresh-start drops legacy uncaptured-context compatibility; mandatory catalog wiring and isolated startup profile loading are specified in `Require explicit agent catalog and isolated startup profile loading`.
**Migration**: Start with a fresh `.abracode/` state directory; all executions use configured catalog-backed admissions.
