# Spec Delta

## MODIFIED Requirements

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
