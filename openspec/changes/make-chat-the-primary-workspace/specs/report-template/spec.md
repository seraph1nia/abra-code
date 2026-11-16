# Spec Delta

## MODIFIED Requirements

### Requirement: Produce a portable interactive HTML artifact

The report workflow SHALL offer explicit self-contained HTML export from a saved snapshot. The export SHALL embed the exact captured document, compatible renderer, styles, supported assets and notices. Filtering and evidence expansion SHALL work without sibling files, a development server, network, credentials or same-origin privileges. Export failure MUST preserve the canonical snapshot. Documentation SHALL identify unsupported portable assets.

#### Scenario: Native viewer loads a built report

- **WHEN** exported HTML is opened in an existing sandboxed viewer that permits scripts and withholds same-origin privileges
- **THEN** report content, filtering and evidence expansion work without sibling bundles or host privileges

#### Scenario: Reader moves the artifact

- **WHEN** a reader copies exported HTML to another directory and opens it with network access unavailable
- **THEN** captured content, styling and local interactions remain usable

#### Scenario: Live work changes before export

- **WHEN** the user exports a saved report after its source tasks have changed
- **THEN** the HTML contains the report's captured values rather than newly queried work

### Requirement: Hand off to the existing native HTML preview

New report publication SHALL expose an artifact reference in the producing Abra conversation and task report history. The app SHALL open the saved document in its shared viewer, with optional inline preview and JSON download. Existing or explicitly exported HTML SHALL retain native file-preview/browser handoff and attachment download. Handoffs MUST distinguish app rendering, exported HTML and unavailable preview capabilities.

#### Scenario: User opens a report from chat

- **WHEN** an agent returns a file link to retained/exported HTML and the user opens it in the supported OpenCode graphical client
- **THEN** the client can use its existing HTML preview beside the conversation or native HTML browser pane

#### Scenario: Chat client cannot preview HTML

- **WHEN** an HTML report is shared in a client without an HTML viewer
- **THEN** the handoff identifies the built file and ordinary browser opening without claiming inline rendering

#### Scenario: New JSON report is published

- **WHEN** an authorized new report snapshot finishes publication
- **THEN** its chat artifact card opens the exact saved revision in the app and HTML compilation is not required for successful publication

### Requirement: Keep report presentation independent of orchestration authority

Snapshot viewing and portable exports SHALL require no controller or agent connection to render captured evidence. Local report interactions MUST NOT submit prompts, approve work, change issue status or replace research acceptance. Explicit app drill-down SHALL remain read-only and separate from frozen evidence. Report generation/viewing MUST NOT grant new worker authoring or shell permissions.

#### Scenario: Reader interacts with a report

- **WHEN** the reader filters findings or expands captured evidence
- **THEN** only local presentation changes and no controller/native chat mutation occurs

#### Scenario: Agent is assigned read-only research

- **WHEN** a read-only Research worker communicates findings or requests optional report presentation
- **THEN** its retained research submission and acceptance contract remain authoritative without template/source editing or build permission

### Requirement: Reuse small report primitives with accessible local interactions

Report snapshots SHALL use the same supported presentation catalog as in-app generated views. Exercised components SHALL support section navigation, filtering, evidence disclosure, code/diff excerpts, observed status/timelines and prepared diagrams. Keyboard access and a 375-pixel viewport SHALL remain usable. Portable exports MUST NOT fetch external framework/diagram runtimes or require an application backend.

#### Scenario: Author composes a report

- **WHEN** Abra composes a validated report surface with local interactions and prepared diagrams
- **THEN** the app and optional export render those components from the same captured document and catalog semantics

#### Scenario: Diagram is invalid

- **WHEN** supplied diagram data cannot be parsed or prepared safely
- **THEN** publication/export fails with a bounded source diagnostic instead of advertising a partially successful artifact

### Requirement: Generate read-only evidence snapshots safely

Report generation SHALL capture validated bounded issue/execution evidence, observation time, provenance, source references, checks, findings and limitations in a data-plus-A2UI document. Status SHALL be labeled a snapshot. Missing evidence MUST remain unavailable. Repository text/code/diffs SHALL be inert text and links validated. Generation MUST NOT mutate workflow truth or grant additional worker permissions.

#### Scenario: Report includes hostile repository text

- **WHEN** a finding or source excerpt contains markup, script delimiters or an unsafe URL
- **THEN** it renders as inert text or a refused link without executing supplied code or contacting an agent

#### Scenario: Research worker requests a visual report

- **WHEN** an authorized read-only Research worker submits retained findings
- **THEN** the authorized report owner can publish a validated presentation without granting the worker source editing rights or replacing accepted research Markdown

### Requirement: Publish concurrent reports with retained immutable identity

Each report SHALL retain issue/execution-bound request/revision identity, captured inputs and verified document digest/bytes/path. Concurrent publication/export SHALL use isolated owned destinations. Validation SHALL precede atomic publication. Retry/restart SHALL reconcile existing bytes before rebuilding. Conflicting requests or failures MUST preserve earlier artifacts; scratch cleanup MUST preserve retained reports and unrelated resources.

#### Scenario: Two workers request reports concurrently

- **WHEN** two authorized report requests publish concurrently
- **THEN** each retains its own captured document and revision without shared mutable source, cache or output collisions

#### Scenario: Publication response is lost

- **WHEN** a report document was published before a service interruption
- **THEN** recovery verifies its retained request/revision and digest and returns the same artifact without overwriting or recapturing it

#### Scenario: Later build fails

- **WHEN** a new document or optional HTML export fails validation or is interrupted
- **THEN** previous valid artifacts remain readable and a partial result is not advertised as published

#### Scenario: Request identity is reused with different inputs

- **WHEN** a retry changes the captured document or source surface revision under the same request identity
- **THEN** publication rejects the conflict without rebinding the original receipt

### Requirement: Preserve portable native preview and offline feedback export

Optional HTML exports SHALL remain one offline file including supported assets and notices, usable after relocation and in the native opaque sandbox. Local feedback controls SHALL display/export Markdown or JSON without network, storage privileges or a service. Feedback SHALL be labeled review input and MUST NOT authorize work, change controller state or silently submit a prompt.

#### Scenario: Artifact is moved and opened offline

- **WHEN** exported HTML is relocated and opened with network and same-origin privileges unavailable
- **THEN** diagrams, styling, local navigation/filtering, evidence disclosure and feedback export remain usable without sibling assets

#### Scenario: Reviewer exports feedback

- **WHEN** a reader records comments/findings and exports feedback
- **THEN** the result is local review data and no session, approval or workflow mutation occurs

## ADDED Requirements

### Requirement: Save frozen data with the A2UI document

The canonical format for new generated report artifacts SHALL be one versioned JSON document containing title, captured time, provenance, catalog compatibility, complete A2UI layout and all data required by its bindings. Reopening MUST use captured values without filling gaps from live work. Coverage, unavailable evidence and truncation SHALL be explicit.

#### Scenario: Source work is retired

- **WHEN** a saved report is opened after service restart and source worktree removal
- **THEN** its captured content and included evidence remain readable with original observation/provenance and no live substitution

#### Scenario: Snapshot lacks a transcript

- **WHEN** a report references a session but did not capture its transcript
- **THEN** the report states that limitation while a separately labeled app action can inspect currently available evidence

### Requirement: Freeze an observed view explicitly

An explicit Save snapshot action SHALL validate a retained source surface/revision and freeze its resolved data under a stable publication request. Authorized Abra SHALL also be able to compose a saved report from captured evidence. A changed source revision MUST produce a conflict rather than silently saving different content. Saving MUST NOT require a model turn or advance workflow state.

#### Scenario: User saves a live work view

- **WHEN** the user saves an observed surface revision while its work data is available
- **THEN** the owner publishes an immutable data-plus-A2UI snapshot and returns its artifact reference without submitting a prompt

#### Scenario: Surface changed before save

- **WHEN** the submitted surface revision has been replaced before the save is validated
- **THEN** the save reports a stale selection and neither saves a different layout nor overwrites an earlier report

### Requirement: Preserve catalog and document compatibility

Saved documents SHALL declare their format and catalog/renderer compatibility. Supported versions SHALL remain renderable through explicit readers. Unsupported or malformed records SHALL remain preserved and individually unavailable without hiding valid reports. Verified canonical JSON SHALL be downloadable independently of presentation; unknown content MUST NOT be executed.

#### Scenario: Newer catalog is unsupported

- **WHEN** a saved document requires an unsupported catalog or format version
- **THEN** the app shows that report as unavailable for rendering and retains a safe download of its verified bytes without changing the document

#### Scenario: One report is corrupt

- **WHEN** a report's bytes no longer match its retained digest or valid document contract
- **THEN** the affected artifact returns a concrete integrity/resource error while unrelated reports remain usable

### Requirement: Preserve legacy reports without conversion

Published legacy HTML and accepted research Markdown SHALL remain readable under their original identities and integrity checks. Upgrade MUST NOT rewrite their bytes or treat a retry as a new-format request. Unfinished legacy builds that cannot resume SHALL retain their evidence and explicit unavailable state. New-format reports SHALL use new publication identities.

#### Scenario: Existing HTML is opened after upgrade

- **WHEN** a valid retained HTML report is selected after the new document format is introduced
- **THEN** its original verified bytes open in the isolated viewer and remain downloadable without regeneration

#### Scenario: Old report request is retried

- **WHEN** a previously published legacy request is repeated after upgrade
- **THEN** it returns its original legacy artifact rather than recapturing current work or converting the stored result

#### Scenario: Old pending compiler is no longer supported

- **WHEN** a retained unfinished legacy build cannot resume with a supported compiler
- **THEN** its pending evidence is preserved with a concrete unavailable/recovery diagnostic and no replacement publication identity is invented

## REMOVED Requirements

### Requirement: Provide a directly editable report template

**Reason**: The primary report workflow is now a saved data-plus-A2UI document rendered by the application's shared catalog; maintaining a separate manual Solid authoring application duplicates presentation.
**Migration**: Compose and save report surfaces using the supported catalog. Keep a shared renderer/export fixture and documented validation commands for contributors. Existing built HTML remains readable; optional new HTML exports originate from saved documents.
