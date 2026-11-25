# Spec Delta

## ADDED Requirements

### Requirement: Sanitize and verify embedded SVG diagrams in offline reports

Prepared SVG diagrams SHALL pass a strict tag and attribute allowlist sanitizer both during build-time diagram preparation and before client rendering, with styles isolated from the host document. Offline HTML report exports SHALL embed an integrity digest for the prepared diagram block and validate it alongside the canonical report document.

#### Scenario: Tampered or hostile SVG reaches the report viewer

- **WHEN** an embedded diagram payload contains script elements, event-handler attributes, foreign objects or unscoped global CSS
- **THEN** validation rejects tampered offline payloads and client sanitization strips disallowed markup before rendering

#### Scenario: Valid offline report with diagrams is exported

- **WHEN** a report containing Mermaid diagrams is exported to standalone HTML
- **THEN** both the document block and the prepared diagrams block carry verified integrity digests and render with isolated SVG styles

### Requirement: Bound diagram batch cancellation, timeouts and syntax diagnostics

Diagram batch preparation SHALL remove canceled queued callers before launching a renderer, prevent one caller's timeout from terminating a browser shared by another active caller, and emit only schema-valid one-based line numbers on syntax errors.

#### Scenario: Queued diagram caller cancels before a slot opens

- **WHEN** a waiting diagram preparation request is aborted while queued
- **THEN** it is removed from the queue and does not launch a renderer when a slot becomes available

#### Scenario: Syntax error reports line zero

- **WHEN** the diagram compiler reports a syntax failure at line 0
- **THEN** the batch omits the invalid zero line number and returns a valid typed syntax result rather than failing schema decoding

### Requirement: Export current v1 documents safely without legacy HTML fallbacks

Renderer reuse SHALL preserve the exact canonical version-1 document, UTF-8-safe text truncation, byte bounds, required notices and isolated offline interaction without legacy HTML or historical v1–v4 snapshot fallbacks. Offline document and diagram payloads MUST be injected at the closing document body boundary outside bundled scripts rather than matching inside inline JavaScript, and publication SHALL remain exclusive, atomic and digest-verified.

#### Scenario: Reused shell is opened offline

- **WHEN** a newly exported file is relocated and opened offline in an opaque sandbox
- **THEN** supported diagrams, filtering, disclosures, themes and feedback controls work without sibling files, network, same-origin storage or live application imports

#### Scenario: Bundled renderer script contains a body-closing substring

- **WHEN** the compiled renderer shell contains a literal `</body>` substring inside its inline JavaScript bundle
- **THEN** report export still injects the document and diagram payload blocks at the real closing HTML body tag without corrupting the script

#### Scenario: Document contains script delimiters

- **WHEN** captured text contains script-closing delimiters, markup or other executable-looking content
- **THEN** the exact captured data round-trips and renders inertly without escaping the embedded data boundary

#### Scenario: Export receipt write is interrupted

- **WHEN** verified HTML is published before its receipt is retained
- **THEN** same-identity recovery verifies existing bytes and repairs only missing publication metadata without recapturing live evidence or overwriting the artifact

#### Scenario: Input or output exceeds a bound

- **WHEN** a document exceeds 1 MiB or an HTML export exceeds 8 MiB
- **THEN** the affected operation fails with a bounded diagnostic while earlier valid documents and artifacts remain usable

## REMOVED Requirements

### Requirement: Reused exports preserve portability and publication integrity

**Reason**: Replaced by `Export current v1 documents safely without legacy HTML fallbacks`, dropping retired pre-v1 legacy HTML and v1–v4 snapshot export compatibility.
**Migration**: Export reports using the current canonical version-1 `ReportDocument` JSON and offline React/A2UI renderer.
