# Spec Delta

## Purpose

Let agents compose diagram-heavy reports and dashboards with Mermaid, verify their renderability through a bounded diagnostic tool, and give readers consistent safe diagrams in the app and portable artifacts.

## ADDED Requirements

### Requirement: Compose standalone diagrams through the catalog

The supported A2UI catalog SHALL expose a `Mermaid` component accepting a title, literal source and optional textual description. Agents SHALL be able to place diagrams among other catalog components without captured report evidence. Component inputs MUST NOT accept executable callbacks, arbitrary renderer configuration, URLs or supplied SVG.

#### Scenario: Agent requests a diagram dashboard

- **WHEN** an authorized agent publishes a valid supported surface containing text, work widgets and multiple Mermaid components
- **THEN** each diagram is rendered at its declared layout position with its title and any supplied description
- **AND** the agent's catalog instructions describe the component and applicable limits

#### Scenario: Diagram has no report evidence binding

- **WHEN** a valid standalone diagram is opened without a captured report snapshot
- **THEN** it renders from its own retained literal source without reporting missing report evidence or inventing work data

#### Scenario: Generated props attempt to supply executable content

- **WHEN** diagram props supply SVG, callbacks, configuration or unknown properties instead of the closed component contract
- **THEN** publication refuses them without executing content or changing the previous surface revision

### Requirement: Verify diagrams with a native diagnostic tool

The OpenCode plugin SHALL expose `abra_mermaid_verify` accepting an identified batch of literal sources and returning an overall outcome plus bounded per-diagram results. Verification SHALL parse and render each accepted input using the same security and compatibility rules as presentation. Success MUST NOT imply factual correctness, readability, publication or controller approval.

#### Scenario: Syntax parses but rendering fails

- **WHEN** an input is syntactically accepted but its shape or layout cannot be rendered
- **THEN** the verifier reports a rendering failure for that diagram and does not report the batch as verified

#### Scenario: Batch includes a malformed diagram

- **WHEN** a batch contains both valid input and a syntax error within its resource budget
- **THEN** results preserve input identities and distinguish successful diagrams from the identified syntax failure
- **AND** diagnostics include source location when supplied by the engine without exposing unrelated source, local paths or unbounded output

#### Scenario: Compiler is unavailable or times out

- **WHEN** preparation cannot start or complete within its deadline
- **THEN** the tool reports unavailable or timeout distinctly from invalid syntax, marks unfinished results explicitly and never returns overall success

### Requirement: Preserve supported Mermaid syntax without weakening resource isolation

Preparation SHALL support documented flowchart, sequence, state, class, entity relationship, Gantt and mindmap syntax under fixed safe settings. Ordinary label punctuation or words MUST NOT be rejected solely because they resemble unsafe source tokens. Source-controlled configuration, executable interactions, HTML labels, images and external resource references SHALL be refused before successful preparation.

#### Scenario: Ordinary syntax contains previously blacklisted characters

- **WHEN** a supported flowchart uses bidirectional arrows or an ordinary escaped label and a sequence label contains the word "click"
- **THEN** preparation accepts valid syntax and renders literal labels without interpreting them as HTML or interactions

#### Scenario: Source attempts to change security settings

- **WHEN** a diagram supplies an initialization directive or configuration frontmatter
- **THEN** preparation identifies forbidden configuration rather than applying it

#### Scenario: Source or output requests active content

- **WHEN** input or prepared SVG contains callbacks, navigable links, executable elements, event handlers, images or external resource loading
- **THEN** preparation refuses the diagram and makes no source-induced network request
- **AND** valid unrelated diagrams and retained artifacts remain available

### Requirement: Publish complete verified diagram revisions

New generated surfaces and report revisions containing diagrams SHALL complete parse, render and safety verification before publication is advertised as successful. Invalid or over-budget revisions MUST leave previous revisions intact. Browser preparation SHALL select exact authorized publication identities and MUST NOT accept paths or arbitrary native operations.

#### Scenario: One diagram invalidates a replacement surface

- **WHEN** a new revision contains one unrenderable diagram among valid widgets and diagrams
- **THEN** the new revision is refused with the diagram identified and the previous valid revision remains selected and readable

#### Scenario: Browser requests a different retained identity

- **WHEN** preparation is requested for a foreign report, mismatched hash or stale selected surface revision
- **THEN** the request is refused rather than resolving to another artifact or the latest revision

#### Scenario: Existing artifact cannot currently be prepared

- **WHEN** a retained supported diagram is opened while its compiler is unavailable
- **THEN** the viewer labels that diagram unavailable and retains source disclosure and the verified document download without hiding unrelated content

### Requirement: Enforce explicit collection and enclosing limits

New compatible views and reports SHALL accept up to 32 diagram instances, 32 KiB UTF-8 source each and 256 KiB aggregate diagram source, subject to enclosing size bounds. Repeated placements SHALL count toward the instance limit. Excess input MUST receive an identified limit diagnostic before publication, never a silently shortened diagram collection.

#### Scenario: Collection is at the supported count

- **WHEN** a new surface or report contains 32 diagrams within source and enclosing limits
- **THEN** all 32 remain present and renderable without clipping or default diagrams displacing them

#### Scenario: Count or source bytes exceed the limit

- **WHEN** a request contains 33 diagram instances, a source exceeding 32 KiB or aggregate source exceeding 256 KiB
- **THEN** it fails with the exceeded limit identified and no partial publication

#### Scenario: Layout or output exceeds an enclosing bound

- **WHEN** a new catalog surface exceeds 384 KiB, a document exceeds 1 MiB, evidence exceeds 512 KiB or prepared/final HTML output exceeds its 8 MiB bound
- **THEN** the affected operation fails with its own bound identified even if the diagram count and source limits are satisfied
- **AND** the surface component count and depth remain bounded to 100 and 10

### Requirement: Present readable and accessible diagrams consistently

App and offline viewers SHALL provide titled diagrams, any supplied textual description, keyboard-accessible source disclosure, local scrolling and an expanded view with zoom and reset. Diagram width MUST NOT cause page-wide horizontal overflow at 375- or 390-pixel viewports. Light and dark viewing SHALL retain readable labels and edges without changing captured source.

#### Scenario: Reader inspects a dense diagram

- **WHEN** a reader opens a wide or tall diagram on a narrow screen and uses keyboard controls
- **THEN** the diagram can be scrolled or expanded, zoomed and reset while surrounding report controls remain reachable
- **AND** focus returns to the invoking control when the expanded view closes

#### Scenario: Reader changes theme or opens source

- **WHEN** a reader changes the supported theme or expands diagram source
- **THEN** labels and relationships remain visible and the exact retained source is available as inert text
- **AND** no agent prompt or workflow action is submitted

### Requirement: Bound preparation work and reuse exact results

Preparation SHALL bound concurrency, queued work, retained cache bytes, output and execution time. Identical source under the same compiler/security/theme identity SHALL reuse valid prepared results and share in-flight compilation. Different placements MUST have independent SVG identifiers. A failed, canceled or timed-out operation SHALL release owned resources without removing retained publication evidence.

#### Scenario: Identical source is rendered repeatedly

- **WHEN** a diagram is requested again with an identical preparation identity while its valid result is cached
- **THEN** it requires no further compiler activity and repeated placements display without SVG ID collisions

#### Scenario: Concurrent callers need the same diagram

- **WHEN** concurrent verifier, viewer or export operations need the same uncached source under one service owner
- **THEN** they share preparation rather than launch duplicate compilation and remain within the documented concurrency/queue budgets

#### Scenario: Verification reaches the heavy-use target

- **WHEN** the documented verification machine prepares the specified 32-diagram mixed lightweight fixture from a cold diagram cache
- **THEN** every diagram succeeds within the 60-second batch deadline
- **AND** evidence records toolchain, fixture, elapsed time, peak memory, compiler launches and bytes, separately from warm-cache viewing

#### Scenario: Expensive input exhausts preparation budget

- **WHEN** a batch times out, its output exceeds its bound or admission reaches its bounded queue limit
- **THEN** the caller gets an explicit timeout, limit or busy diagnostic and later requests can use released capacity

### Requirement: Preserve historical diagram identities and compatibility

The new component and limits SHALL use an explicit catalog and renderer compatibility identity. Supported historical surfaces/documents SHALL retain their original interpretation, bytes, digests, limits and retry behavior. Incompatible records SHALL remain individually unavailable with verified download rather than being rewritten or partly interpreted as a supported new view.

#### Scenario: Old report is reopened after upgrade

- **WHEN** a supported pre-change report or surface is opened or retried after installation of the new catalog
- **THEN** its original identity and captured source remain authoritative without migration or recapture

#### Scenario: Reader does not support the new catalog

- **WHEN** a reader encounters a report declaring unsupported diagram compatibility
- **THEN** it preserves the original artifact, labels rendering unavailable and does not silently omit diagram components
