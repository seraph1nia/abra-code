# Spec Delta

## ADDED Requirements

### Requirement: Reuse prepared renderer assets across documents

Explicit exports using the same compatible renderer identity SHALL reuse prepared application code and styles without compiling a new application for each document. Each export SHALL embed its exact captured document and prepared diagrams as inert data. Renderer preparation or export failure MUST preserve canonical JSON and previous artifacts.

#### Scenario: Two documents use the same renderer

- **WHEN** two distinct saved documents are exported under the same installed renderer identity
- **THEN** they share one prepared renderer and exporting the second document performs no additional application compilation
- **AND** each HTML artifact contains only its own captured document and matching prepared diagram data

#### Scenario: Concurrent exports need an unprepared renderer

- **WHEN** concurrent exports first require the same renderer identity
- **THEN** renderer preparation is coordinated or safely reused without partial shared assets or cross-document data leakage

#### Scenario: Renderer preparation is interrupted

- **WHEN** preparation stops before a complete verified renderer is available
- **THEN** no partial export is advertised and retry preserves existing documents and publication evidence

### Requirement: Export cache identity follows rendering inputs

Exporter identity SHALL cover compatible renderer behavior, catalog, styles, resolved rendering dependencies, prepared-asset format and required notices. Unrelated backend source or dependency changes MUST NOT invalidate it. A relevant rendering change SHALL produce a distinct identity without modifying existing receipts or destinations.

#### Scenario: Unrelated controller source changes

- **WHEN** a backend-only source file changes while all rendering inputs remain unchanged
- **THEN** the same saved document reuses the existing exporter identity and verified cached artifact

#### Scenario: Unrelated dependency resolution changes

- **WHEN** only a dependency outside the renderer's resolved inputs changes
- **THEN** exporter identity remains unchanged

#### Scenario: Renderer dependency or notices change

- **WHEN** a resolved rendering dependency, catalog behavior, style, asset format or required notice changes
- **THEN** a new exporter identity selects a separate destination and previous valid exports remain readable under their original receipts

### Requirement: Reused exports preserve portability and publication integrity

Renderer reuse SHALL preserve the exact canonical document, supported version checks, byte bounds, required notices and isolated offline interaction. Publication SHALL remain exclusive, atomic and verifiable by retained identity, bytes and digest. Existing JSON, HTML and interrupted supported publication evidence MUST retain their compatible read and recovery semantics.

#### Scenario: Reused shell is opened offline

- **WHEN** a newly exported file is relocated and opened offline in an opaque sandbox
- **THEN** supported diagrams, filtering, disclosures, themes and feedback controls work without sibling files, network, same-origin storage or live application imports

#### Scenario: Document contains script delimiters

- **WHEN** captured text contains script-closing delimiters, markup or other executable-looking content
- **THEN** the exact captured data round-trips and renders inertly without escaping the embedded data boundary

#### Scenario: Export receipt write is interrupted

- **WHEN** verified HTML is published before its receipt is retained
- **THEN** same-identity recovery verifies existing bytes and repairs only missing publication metadata without recapturing live evidence or overwriting the artifact

#### Scenario: Old export is reopened after upgrade

- **WHEN** an operator opens a supported export created by the prior exporter
- **THEN** its original receipt, digest and destination remain authoritative and the new renderer does not rewrite it

#### Scenario: Input or output exceeds a bound

- **WHEN** a document exceeds 1 MiB or an HTML export exceeds 8 MiB
- **THEN** the affected operation fails with a bounded diagnostic while earlier valid documents and artifacts remain usable
