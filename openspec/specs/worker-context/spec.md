# worker-context Specification

## Purpose

Make each managed worker's supplied context and required capabilities explicit, inspectable and recoverable when it operates in another repository's worktree.

## Requirements

### Requirement: Assemble an explicit worker assignment context

For every new managed worker prompt admission, the system SHALL assemble context identifying the issue, execution, generation, role, owned worktree, retained base, workflow policy, applicable accepted scope or planning references, role guidance, selected native agent/model and relevant retained decisions. It SHALL identify relevant repository instruction and artifact references and required skills/tools with their provenance. Workers SHALL remain independent sessions; the system MUST NOT implicitly copy the Supervisor conversation, all central skills, or the capabilities of another harness. Existing project instructions and configuration MUST NOT be overwritten to propagate OpenCrew context.

#### Scenario: Worker starts in another repository

- **WHEN** a managed worker starts in a target repository whose native registry lacks the centrally named OpenCrew role
- **THEN** the configured or native-default agent receives the assigned role guidance and explicit context through OpenCrew's supported integration without copying central agent files into the target repository

#### Scenario: Research and lightweight work have no OpenSpec change

- **WHEN** context is assembled for research-only or lightweight-fix work
- **THEN** it references the retained short contract without inventing OpenSpec artifact prerequisites or implementation tasks

#### Scenario: Project instructions are present

- **WHEN** the target worktree contains repository instructions and locally discoverable skills
- **THEN** OpenCrew preserves them, identifies relevant references and does not present the Supervisor's instructions as the target project's conventions

### Requirement: Retain supplied context before uncertain submission

The system SHALL persist the assembled OpenCrew context and its versioned identity before submitting a new native worker prompt, bound to the execution generation, role, session intent or session, and prompt identity. An uncertain-submission retry SHALL inspect native inbox/transcript evidence first and SHALL reuse the retained prompt identity and supplied context when resubmission is necessary. A deliberate new turn SHALL receive a new context identity. Historical or legacy admissions without retained manifests SHALL remain readable and be reported as lacking captured provenance; the system MUST NOT fabricate their original context.

#### Scenario: Submission succeeds but its response is lost

- **WHEN** the native inbox already contains the retained prompt after a service restart
- **THEN** recovery recognizes the admission without submitting another prompt or replacing its context with current file contents

#### Scenario: Submission was not admitted and context sources changed

- **WHEN** a retained prompt is absent from native evidence and role guidance or issue text changed after its context was persisted
- **THEN** recovery reuses its retained supplied context or reports an explicit policy incompatibility rather than silently rebuilding a different prompt under the old identity

#### Scenario: Existing execution predates context capture

- **WHEN** diagnostics reads a historical execution without a context manifest
- **THEN** it preserves the execution and labels context provenance unavailable without reconstructing an authoritative manifest from current files

### Requirement: Resolve required skills at the worker location

Required skills SHALL resolve against the assigned worktree's native skill inventory, including deliberately registered portable OpenCrew skills. The system SHALL verify that each required skill has usable content and a supported loading route before new admission. A missing, ambiguous or unreadable requirement SHALL name the worker location, requirement source and clearing action. Central-only discoverability MUST NOT count as worker availability, and resolution MUST NOT automatically install skills, search unrelated homes or copy instruction files into managed repositories. Availability SHALL remain distinct from confirmed skill loading.

#### Scenario: Required skill exists only centrally

- **WHEN** a configured skill is available in the Supervisor location but absent from the worker's native inventory
- **THEN** new admission is blocked with a location-specific diagnostic and owned resources remain retained

#### Scenario: Portable execution guidance is registered

- **WHEN** a full-spec worker requires the portable OpenCrew execution skill and that skill is registered with usable content at its worktree location
- **THEN** the requirement resolves without copying a skill into the target repository or loading unrelated orchestration procedures

#### Scenario: Available skill has not been invoked

- **WHEN** diagnostics observes a resolved skill without native evidence that the worker loaded it
- **THEN** it reports the skill as available and does not claim its instructions were consumed

### Requirement: Validate actual tools before a managed model request

Before a managed worker's provider request, the system SHALL validate every required tool group against the actual model-visible tool set after native model shaping and OpenCrew role filtering. Failure SHALL stop that request before the provider call, retain a bounded capability diagnostic and leave the assignment and controller gates unchanged. Inventory or configuration checks alone MUST NOT be presented as proof of effective tool availability.

#### Scenario: Allowed required tool is unavailable

- **WHEN** a tool group is permitted by the role but none of its alternatives is present in the effective request
- **THEN** the model request is refused and diagnostics identifies the unsatisfied group and observed available tools

#### Scenario: Native tool shaping supplies patch

- **WHEN** a GPT-family writing request contains patch instead of edit/write and patch satisfies the editing group
- **THEN** validation succeeds without restoring removed tools or broadening permissions

### Requirement: Expose bounded context diagnostics without creating authority

The existing worker diagnostics tool SHALL report context identity and provenance, role/policy identity, effective agent/model selection, relevant instruction/artifact references, required skill/tool resolution, request-time tool observations with freshness, and concrete blockers. A failure before native session creation SHALL remain inspectable by issue and role. Diagnostics SHALL distinguish retained supplied context, current inventory and observed native context; it MUST NOT claim to reproduce all native system instructions or current model memory. Responses MUST remain bounded and MUST NOT expose raw environments, credentials or provider response bodies. Reads MUST NOT authorize, resume or mutate work.

#### Scenario: Skill validation fails before session creation

- **WHEN** an issue has a retained required-skill failure and no worker session yet
- **THEN** diagnostics still shows the role, location, missing skill and clearing action rather than returning only an empty session list

#### Scenario: Worktree has retired

- **WHEN** diagnostics inspects retained context after worktree retirement or native inventory is unavailable
- **THEN** retained provenance remains readable and current availability is marked unavailable rather than inferred from old observations

#### Scenario: User inspects context

- **WHEN** an operator reads context diagnostics with an unresolved approval or capability blocker
- **THEN** the read preserves the blocker and grants no execution or checkpoint authority
