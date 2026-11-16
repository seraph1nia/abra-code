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

### Requirement: Tool definitions declare diagnostic eligibility

Management tool definitions SHALL own their diagnostic eligibility, defaulting to denied and permitting action-specific predicates. Attention provenance SHALL continue to distinguish automatic diagnostic turns from explicit user requests. The registration wrapper MUST enforce diagnostic eligibility and central Supervisor identity before invoking a tool handler. Diagnostic eligibility MUST NOT authorize lifecycle checkpoints or bypass endpoint-specific correction, approval or delivery gates.

#### Scenario: Diagnostic turn inspects configuration

- **WHEN** an automatic diagnostic turn invokes configuration status inspection
- **THEN** the tool definition permits inspection
- **AND** applying configuration or invoking ordinary lifecycle controls is rejected before its handler runs

### Requirement: Reusable procedures have one owned source

Managed role guidance SHALL state identity, responsibility and authority boundaries; reusable procedures SHALL have a project-owned skill source. Assignment context SHALL supply task-specific facts and reference applicable procedures. Repeated summaries MUST agree with their owner, and active guidance MUST describe supported behavior rather than retired implementations.

#### Scenario: Research requests a visual report

- **WHEN** a Research worker reads its role and relevant report guidance
- **THEN** the guidance describes the current captured-document and optional-export route without claiming that the retired Solid authoring template is active
- **AND** its read-only repository scope and controller-owned publication route remain explicit

#### Scenario: A procedure is revised

- **WHEN** an owned engineering or execution procedure changes
- **THEN** its role references and generated assignment context remain consistent without maintaining independent full copies of the procedure

#### Scenario: Upstream instructions refresh

- **WHEN** the pinned OpenSpec CLI refreshes generated workflows
- **THEN** the generated bodies remain upstream-owned and custom procedures remain in project-owned sources without restoring duplicate tool-specific workflow copies

### Requirement: Instruction cleanup preserves captured admission authority

Instruction and package restructuring SHALL preserve native skill identifiers, role permissions, mandatory capability prerequisites, conditional skill use and captured assignment evidence. Guidance availability or loading MUST NOT become approval, implementation, delivery or recovery authority. Existing retained contexts MUST NOT be rewritten to appear captured under new instructions.

#### Scenario: Small task does not need every procedure

- **WHEN** a worker receives a bounded task with all mandatory admission prerequisites available
- **THEN** it uses only applicable procedures without a new requirement to perform or report every available skill

#### Scenario: Required capability is unavailable

- **WHEN** a current mandatory skill or tool prerequisite is missing after restructuring
- **THEN** admission retains the existing diagnostic and repair route without weakening permissions or silently substituting another role or provider

#### Scenario: Retained work predates instruction cleanup

- **WHEN** an existing execution resumes after installed guidance changes
- **THEN** its captured model, assignment identities, skill evidence and checkpoint requirements remain retained under their supported compatibility rules
- **AND** current instruction text is not fabricated as historical capture evidence

#### Scenario: Skill suggests a conflicting action

- **WHEN** procedure guidance conflicts with approved scope or an enforced role boundary
- **THEN** the existing decision and controller validation routes remain authoritative and the instruction cannot grant the conflicting action
