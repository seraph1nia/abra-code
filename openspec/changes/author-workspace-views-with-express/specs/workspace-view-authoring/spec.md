# Workspace view authoring

## Purpose

Let Abra compose a workspace view in Express, check a draft, and publish a validated revision from the conversation that requested it.

## ADDED Requirements

### Requirement: The Supervisor can author a view in Express

The central Supervisor SHALL have an on-demand `abra-express` skill with signatures derived from the active work catalog and examples of supported live and snapshot layouts. Only the authorized Supervisor SHALL be able to check or publish a view through `abra_render_ui`.

#### Scenario: Compose a comparison in the current conversation

- **WHEN** the Supervisor loads the skill to compare two known issues
- **THEN** it can use the supplied signatures and examples to author a view with both issue IDs and an explicit data mode in its own turn.

#### Scenario: Worker attempts a dry run

- **WHEN** a managed worker submits an Express draft through the tool with validation only requested
- **THEN** the tool refuses the call before resolving workspace references or publishing a view.

### Requirement: Publish one complete workspace view

The tool SHALL accept a surface ID, bounded untagged Express source, and an optional `validate_only` boolean. Omitting the flag SHALL publish one complete, validated A2UI 1.0 work-catalog surface with the requested ID, through the existing revision and message association mechanism. Each new publication SHALL check work and owned resource bindings and embedded diagrams.

#### Scenario: Publish directly

- **WHEN** an authorized call supplies valid Express for a named view containing a nested layout, literal text and a custom work widget
- **THEN** a single call returns a revision and the workspace can open its compiled JSON surface from the producing message with the requested widget bindings.

#### Scenario: Recover an already committed call

- **WHEN** the same native call retries identical input after its publication response was lost
- **THEN** it returns the committed revision and original association without capturing fresh work or publishing a duplicate.

#### Scenario: Request exceeds the authoring contract

- **WHEN** a call supplies the former raw JSON surface argument, or its source compiles to multiple surfaces, an update, a deletion, a foreign catalog or a different surface ID
- **THEN** the call fails before it can alter the selected view.

### Requirement: Validate a draft without publishing

With `validate_only: true`, the tool SHALL run the same compilation, catalog, layout, binding, resource and diagram checks used for new publications. A successful check SHALL return a distinct validation result with the surface ID. It MUST NOT consume a revision, issue a publication receipt, attach a surface to a message or reserve the right to publish.

#### Scenario: Check then publish a draft

- **WHEN** the Supervisor checks a valid draft twice and then publishes it under the same surface ID
- **THEN** both checks report validation success and only the publish call produces the next revision and its workspace attachment.

#### Scenario: A referenced resource changes after validation

- **WHEN** a checked draft is later submitted for publication and its referenced resource is no longer available to that session
- **THEN** publication checks the current resource, reports the failure, and preserves the latest committed view.

### Requirement: Return repairable authoring failures

For rejected drafts the tool SHALL return a bounded native failure that identifies the failed check, the offending location, property or reference when known, and a relevant correction. Both modes SHALL preserve the last committed revision and distinguish invalid content from an unavailable verification service.

#### Scenario: Fix a syntax or catalog error

- **WHEN** a draft contains malformed Express or an unsupported component property
- **THEN** the failure identifies the syntax or catalog problem and includes the source position when available, so the Supervisor can correct and resubmit the draft.

#### Scenario: A well-formed draft fails a domain check

- **WHEN** a draft uses an unavailable issue ID, exceeds a layout limit, or contains Mermaid that fails verification
- **THEN** either mode identifies the failing reference, limit or diagram and produces no publication.

#### Scenario: Diagram verification cannot run

- **WHEN** a draft contains a diagram and the diagram verifier is unavailable
- **THEN** the tool identifies the unavailable check and publishes no revision.
