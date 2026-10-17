# Spec Delta

## Purpose

Let agents quickly author interactive reports that users can read in an existing HTML preview or open as a standalone local page, using one portable build output.

## ADDED Requirements

### Requirement: Provide a directly editable report template

The project SHALL provide a report template with a documented primary authoring file, a complete example, and commands for development, type checking and building. An author MUST be able to change report content and add ordinary local interactions without configuring a new application, installing a UI component library or defining a separate report protocol.

#### Scenario: Author customizes the example

- **WHEN** an author edits the documented report file and runs the report check and build commands after the repository's normal dependency installation
- **THEN** those commands validate and build the customized report without requiring per-report scaffolding or installation

#### Scenario: Reader uses the example on a narrow screen

- **WHEN** a reader views the example at a 375-pixel-wide viewport
- **THEN** headings, findings, evidence and controls remain readable and reachable without page-wide horizontal overflow

### Requirement: Produce a portable interactive HTML artifact

The report build SHALL produce one HTML artifact containing the application code, styles and supported local assets needed by the report. The shipped example SHALL render and retain its local filtering and evidence-expansion interactions without sibling files, a running development server, network access, host credentials or same-origin storage privileges. The authoring documentation MUST identify asset patterns outside this supported portable format.

#### Scenario: Native viewer loads a built report

- **WHEN** the built HTML is opened in an existing sandboxed viewer that permits scripts and withholds same-origin privileges
- **THEN** the report content, filtering and evidence expansion work without loading sibling application bundles or obtaining privileges from the host

#### Scenario: Reader moves the artifact

- **WHEN** a reader copies the built HTML to another directory and opens it directly in a browser with network access unavailable
- **THEN** the report content, styling and local interactions remain usable

### Requirement: Hand off to the existing native HTML preview

The report workflow SHALL document a chat handoff containing a file link to the completed HTML artifact that the pinned OpenCode client can resolve and open in its existing HTML preview. The workflow MUST distinguish this preview from HTML embedded directly inside a message and MUST NOT require a custom chat renderer or messaging bridge.

#### Scenario: User opens a report from chat

- **WHEN** the agent returns the documented file link for an existing built report and the user opens it in the pinned OpenCode graphical client
- **THEN** the client opens its existing HTML preview beside the conversation or its native desktop HTML browser pane

#### Scenario: Chat client cannot preview HTML

- **WHEN** the report is shared in a client without an HTML viewer
- **THEN** the handoff still identifies the built file and documents opening it in a browser without claiming that inline rendering is available

### Requirement: Offer an explicit local page preview

The project SHALL provide an explicit command to serve the completed report locally and expose its actual browser URL. The default listener MUST be loopback-only. A handoff MUST present the HTTP URL as available only while the preview process is running and MUST identify that it is local to the machine serving it. Starting a build or opening the HTML artifact MUST NOT implicitly start a detached server or publish the report externally.

#### Scenario: User requests a browser page link

- **WHEN** the local preview command is running successfully
- **THEN** its output identifies the listening URL and the agent can return that URL alongside the native file-preview link

#### Scenario: Preview port is occupied

- **WHEN** the configured preview port is unavailable
- **THEN** the command fails clearly rather than advertising a different process's page at that URL

#### Scenario: Preview process is stopped

- **WHEN** the local preview process ends
- **THEN** the built HTML remains available for native preview and direct browser opening independently of the stopped HTTP URL

### Requirement: Keep report presentation independent of orchestration authority

The template and its local preview SHALL run without connecting to OpenCrew's controller or an agent session. Report interactions MUST NOT submit agent prompts, approve work, change issue status or replace the retained research-report contract. Documentation MUST make clear that the template grants no additional authoring or shell permissions to managed research or Supervisor sessions.

#### Scenario: Reader interacts with a report

- **WHEN** the reader filters findings or expands evidence
- **THEN** only the page's local presentation changes and no controller or native chat mutation occurs

#### Scenario: Agent is assigned read-only research

- **WHEN** a read-only research worker needs to communicate findings
- **THEN** its existing retained-report submission path and permissions remain authoritative and the template does not authorize editing files or running a build
