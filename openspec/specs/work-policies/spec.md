# work-policies Specification

## Purpose

Let users request research, bounded changes or full specification work through one work graph while retaining the evidence appropriate to each outcome.

## Requirements

### Requirement: Select and retain a workflow explicitly

Intake SHALL accept full-openspec, research-only and lightweight-fix, using the configured default when omitted and retaining full-openspec as the shipped default. Request identity SHALL include the selected policy and scope. Existing executions MUST retain their policy through restart and retry; no automatic downgrade or in-place research-to-shipping conversion is permitted.

#### Scenario: Existing request is retried with a different policy

- **WHEN** a caller reuses a request ID with a changed workflow or scope
- **THEN** creation rejects the rebinding without modifying the original issue

#### Scenario: Default workflow remains full OpenSpec

- **WHEN** no policy is supplied and configuration has not changed the default
- **THEN** the issue executes the full-openspec workflow

### Requirement: Full specification work retains its gates

Full-openspec SHALL retain repository-local OpenSpec planning and task authority, strict validation, configured plan approval, independent review, verification, archive, delivery authorization and preservation before cleanup. A worker completion statement MUST NOT substitute for any gate.

#### Scenario: Tasks remain unfinished

- **WHEN** Apply reports success but real OpenSpec implementation tasks remain incomplete
- **THEN** the controller refuses delivery and retains the unfinished task evidence

### Requirement: Full specification work refreshes OpenSpec instructions

Before creating a full-openspec change or launching Explore, the controller SHALL run `openspec update` in the owned worktree. It SHALL retain successful completion and generated changes as a preparation commit separately from the fetched base, reusing it after retries or restarts. Explore MUST remain limited to its assigned change. Research-only and lightweight-fix MUST NOT require this step.

#### Scenario: Instructions need updating

- **WHEN** a full-openspec execution starts with outdated generated instructions
- **THEN** the controller refreshes them before Explore, retains their preparation commit and preserves the original fetched base
- **AND** controller-generated changes do not count as Explore source edits

#### Scenario: Refresh fails before worker admission

- **WHEN** the update command fails during provisioning
- **THEN** no worker launches and the execution retains its worktree and provisioning recovery checkpoint
- **AND** a partial update remains preserved and cannot be silently committed on retry

#### Scenario: Provisioning retries after a successful refresh

- **WHEN** refresh succeeded but later provisioning was interrupted or failed
- **THEN** retry reuses the retained refresh baseline without updating instructions again

### Requirement: Research produces an independently retained report

Research-only SHALL run an assigned worker in a native worktree at a retained base with read-only repository scope. Its question, scope, acceptance criteria and configured approval policy SHALL be recorded before launch. The worker SHALL be permitted to use agent-browser through the native shell tool for browser investigation within the assigned scope and to produce screenshots in its assigned scratch evidence directory; other shell commands and repository source mutation SHALL remain forbidden. Completion SHALL require a validated report bound to the issue, base and worker, with findings, evidence references and limitations. The report MUST remain accessible after native worktree retirement; research MUST NOT create a code-delivery PR or require OpenSpec implementation tasks. Scratch browser files MUST NOT be presented as durable report attachments unless separately preserved.

#### Scenario: Report remains after cleanup and restart

- **WHEN** research completes, its worktree retires and the service restarts
- **THEN** the ticket still exposes the retained report and its base/evidence identity

#### Scenario: Research repository lacks OpenSpec

- **WHEN** an explicitly selected research task targets a registered repository without OpenSpec setup
- **THEN** it can run without initializing OpenSpec or requiring code-verification commands

#### Scenario: Worker attempts source mutation

- **WHEN** a research worker attempts a native repository write, an unrelated shell command or a management operation
- **THEN** native tool policy rejects it and the controller does not treat the attempt as report preservation

#### Scenario: Research uses browser evidence

- **WHEN** a research worker uses agent-browser to inspect an in-scope website and capture a screenshot
- **THEN** it can use the native shell tool and assigned screenshot directory
- **AND** its retained report describes the observed evidence and any scratch-file availability limits without modifying repository source

#### Scenario: Native research outcome succeeds without a report

- **WHEN** a research worker becomes successful or idle without a retained valid report
- **THEN** the issue does not close and its resources remain available for inspection

### Requirement: Lightweight changes use a short approved scope

Lightweight-fix SHALL capture a concise goal, acceptance criteria and constraints without requiring a full OpenSpec artifact package. It SHALL honor configured scope approval and retain verification, independent review, exact-content delivery authorization and safe retirement. Missing scope or acceptance criteria MUST be resolved before Apply starts.

#### Scenario: Lightweight fix uses no OpenSpec setup

- **WHEN** a registered repository has configured verification and an explicitly selected lightweight fix with accepted scope
- **THEN** Apply can start without generating or archiving full OpenSpec planning artifacts

#### Scenario: Scope changes during implementation

- **WHEN** the lightweight implementation requires materially different acceptance criteria or constraints
- **THEN** the controller invalidates the scope receipt and requires the configured replanning authorization

### Requirement: Research handoff creates linked implementation work

A user-authorized research follow-on SHALL create a new implementation issue with its own policy and request identity, referencing the completed report and depending on the research issue. The original report and research history MUST remain unchanged. Successful research MUST NOT automatically authorize implementation.

#### Scenario: Authorized follow-on work

- **WHEN** the user requests implementation based on a completed research report
- **THEN** intake creates linked full-openspec or lightweight-fix work with the report reference and independently enforced gates

#### Scenario: Research only recommends implementation

- **WHEN** a report recommends a change but no implementation was requested
- **THEN** the system retains the recommendation without launching coding work
