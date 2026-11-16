# Spec Delta

## ADDED Requirements

### Requirement: Capture requested diagram collections without clipping

New report revisions SHALL preserve every selected diagram within the supported collection and enclosing bounds. An explicit list SHALL replace automatic fallback diagrams, including when empty. Omitted input SHALL select retained research diagrams when present and otherwise the documented defaults. Unsupported collections MUST fail explicitly rather than truncate or displace diagrams.

#### Scenario: User supplies a full collection

- **WHEN** an authorized report request supplies 32 valid diagrams within all supported bounds
- **THEN** the captured report contains those exact 32 sources and titles in their supplied order
- **AND** automatic work/authority diagrams are not appended in their place

#### Scenario: User explicitly supplies no diagrams

- **WHEN** a valid report request includes an empty diagram list
- **THEN** the resulting report has no captured fallback diagrams

#### Scenario: Research supplied a larger collection

- **WHEN** report generation omits an override and retained research evidence contains a supported collection larger than eight
- **THEN** the complete retained collection is captured without truncation or default insertion

#### Scenario: No explicit or retained collection is available

- **WHEN** report generation omits diagrams and no research diagram collection is present
- **THEN** the documented default explanatory diagrams remain available and are labeled as presentation context

### Requirement: Save inline diagrams with their exact layout revision

Saving a generated surface SHALL capture every inline Mermaid component's exact source, title, description and layout position alongside its frozen bindings and captured diagram evidence. Source diagrams SHALL NOT become live references or compilation code in the canonical document. Invalid combined collections MUST be refused before a new successful publication.

#### Scenario: Dashboard is saved with diagrams between work widgets

- **WHEN** a user saves an exact valid dashboard revision containing standalone diagrams and mixed live/snapshot work widgets
- **THEN** the saved document preserves that diagram placement/source and each widget's separately captured values and coverage
- **AND** source retirement or later layout updates do not substitute different diagrams or data

#### Scenario: Inline and captured diagrams exceed the combined budget

- **WHEN** a selected layout and its displayed report evidence together exceed the supported diagram instance or aggregate source limit
- **THEN** saving fails with the combined limit identified without publishing a clipped document

#### Scenario: Same save request is retried after source changes

- **WHEN** a published save is retried after its source diagram or current work changes
- **THEN** it returns its original verified document without recapturing source or replacing its hash

### Requirement: Prepare all report diagram sources for portable export

Offline export SHALL prepare diagrams from both standalone catalog components and captured report evidence using the same validation rules as app viewing. The exported file SHALL embed only matching trusted prepared assets and inert captured data, with required notices. An unrenderable diagram MUST fail the export while preserving canonical JSON and earlier HTML artifacts.

#### Scenario: Report combines standalone and evidence diagrams

- **WHEN** a compatible saved document containing both diagram forms is exported
- **THEN** every displayed diagram has a corresponding prepared rendering at its captured layout position
- **AND** repeated identical sources display without SVG identifier collisions

#### Scenario: Diagram preparation fails during export

- **WHEN** any source fails parsing, rendering, safety checks or a preparation budget
- **THEN** export identifies the affected diagram and does not advertise partial HTML as successful
- **AND** the verified canonical document and previous exports remain available

#### Scenario: Export moves to an offline opaque viewer

- **WHEN** the generated HTML is relocated and opened offline without same-origin privileges
- **THEN** all prepared diagrams, source disclosure, scrolling and expanded zoom/reset interactions work without external requests, sibling assets or a diagram compiler runtime

### Requirement: Keep diagram preparation subordinate to report identity

Prepared report diagrams SHALL bind exact captured source to compiler/security/theme compatibility. Renderer identity SHALL cover the new preparation and presentation behavior. Reading, viewing or verifying diagrams MUST NOT alter canonical document bytes, research acceptance, publication ownership or lifecycle authority. Existing supported artifacts SHALL retain their original receipts and recovery behavior.

#### Scenario: Compiler or SVG safety policy changes

- **WHEN** a saved report is exported after a relevant rendering input changes
- **THEN** a distinct compatible exporter identity is used without overwriting the prior export or modifying the canonical document

#### Scenario: App prepares diagrams after service restart

- **WHEN** a supported saved report is opened after its derived diagram cache is lost
- **THEN** preparation uses its exact verified sources without live work substitution or another model turn

#### Scenario: Historical report predates the new collection contract

- **WHEN** a supported historical JSON, legacy HTML or accepted research Markdown report is opened after upgrade
- **THEN** its original bytes, digest and captured interpretation remain authoritative without automatic conversion
