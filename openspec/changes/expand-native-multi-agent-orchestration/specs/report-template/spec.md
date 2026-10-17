# Spec Delta

## ADDED Requirements

### Requirement: Reuse small report primitives with accessible local interactions

The report toolkit SHALL retain ordinary manual TSX authoring and provide only reusable primitives exercised by shipped example reports. Examples SHALL include section navigation, local text filtering, collapsible evidence, readable code/diff excerpts, status/timeline views and multiple build-time Mermaid diagrams. Keyboard operation and a 375-pixel viewport SHALL remain usable. Reports MUST NOT load a diagram runtime, CDN, component framework or backend to support basic viewing.

#### Scenario: Author composes a report

- **WHEN** an author customizes the manual example and adds local interactions or multiple diagrams
- **THEN** type checking, diagram validation and the single-file build continue to work using the documented template

#### Scenario: Diagram is invalid

- **WHEN** an authored diagram cannot be parsed or rendered
- **THEN** validation/build fails with the offending source identified instead of publishing a partial successful report

### Requirement: Generate read-only evidence snapshots safely

An optional report-generation path SHALL accept validated, bounded evidence snapshots identifying issue/execution, observed time, provenance, source references, available checks, findings and limitations. Status SHALL be explicitly labelled a snapshot. Missing evidence MUST remain unavailable rather than fabricated. Repository strings, code, diffs, URLs and report data SHALL render as inert text or validated links, never as repository-supplied executable HTML/JavaScript. Snapshot generation SHALL neither mutate workflow truth nor grant additional worker shell/write permissions.

#### Scenario: Report includes hostile repository text

- **WHEN** a finding or source excerpt contains markup, script delimiters or an unsafe URL
- **THEN** it renders as inert text or a refused link without executing code or contacting an agent

#### Scenario: Research worker requests a visual report

- **WHEN** an authorized read-only Research worker submits retained findings
- **THEN** an authorized controller build route can render validated data without granting that worker central-template or source editing rights

### Requirement: Publish concurrent reports with retained immutable identity

Each generated report SHALL have an execution/issue-bound stable request and revision identity, captured inputs and a retained validated artifact digest/path. Independent builds SHALL use isolated source/output locations without modifying the shared installation template. Finished outputs SHALL be validated before atomic publication to an exclusively owned revision destination. Retry/restart SHALL reconcile an already published digest before rebuilding or replacing anything. Invalid/interrupted builds or identity conflicts MUST preserve earlier artifacts. Cleanup SHALL remove only the build's own scratch resources and MUST NOT erase retained reports or unrelated files.

#### Scenario: Two workers request reports concurrently

- **WHEN** two authorized report builds run at the same time
- **THEN** each produces its own portable artifact without sharing mutable authoring files, build caches or output paths

#### Scenario: Publication response is lost

- **WHEN** a report was published before the service crashed
- **THEN** recovery verifies the retained request/revision and artifact digest and returns the same artifact without overwriting it

#### Scenario: Later build fails

- **WHEN** a new report revision is invalid or interrupted
- **THEN** the previous validated revision remains readable and no partial new artifact is advertised

### Requirement: Preserve portable native preview and offline feedback export

Generated reports SHALL remain one offline HTML file with assets and applicable license notices included, usable after relocation in an ordinary browser and the existing native sandboxed HTML preview. Optional local feedback controls SHALL export or display structured Markdown/JSON without requiring network, storage privileges or a service. Feedback MUST be labelled review input and MUST NOT approve work, change controller state or silently submit a prompt.

#### Scenario: Artifact is moved and opened offline

- **WHEN** the HTML is moved to another directory and opened with network access and same-origin privileges unavailable
- **THEN** diagrams, styling, navigation, filtering, evidence disclosures and local feedback export remain usable without sibling assets

#### Scenario: Reviewer exports feedback

- **WHEN** the reader records section comments or findings and exports the feedback
- **THEN** the result is local review data and no session, approval or workflow mutation occurs
