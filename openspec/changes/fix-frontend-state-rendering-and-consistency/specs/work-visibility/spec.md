# Spec Delta

## ADDED Requirements

### Requirement: Preserve custom-choice text during native form editing

Native custom multiselect editors SHALL retain raw text, line breaks and caret behavior while the user edits. Submission SHALL normalize supported selections and custom lines into the existing answer format and validate the result. Observation refresh and collapsed attention MUST preserve edits for the same active binding; a replacement binding SHALL reset them.

#### Scenario: User types two custom choices

- **WHEN** the user types a custom value, presses Enter and types a second value
- **THEN** the editor retains both lines and permits further insertion and deletion without removing the newline or moving the caret unexpectedly
- **AND** submission contains both nonempty choices in the existing answer shape

#### Scenario: User pastes repeated and empty lines

- **WHEN** custom text contains duplicate lines, blank lines and selected predefined choices
- **THEN** editing preserves the raw text until answer preparation
- **AND** the submitted values remove empty entries and duplicates while preserving the first occurrence order and definition-specific validation

#### Scenario: Same form is refreshed or replaced

- **WHEN** observation refreshes the same active form binding or later replaces that binding
- **THEN** the same binding retains its edits across refresh and attention collapse, while the replacement starts from its own defaults

### Requirement: Display and submit date-time defaults consistently

Native date-time fields SHALL display supported defaults and make their timezone interpretation visible. Offset-bearing defaults SHALL display the same instant in browser-local time and submit their original value if untouched. Edited valid values SHALL serialize with an explicit offset or UTC. Invalid or impossible local times MUST produce an inline error rather than silent normalization.

#### Scenario: Offset-bearing default is shown

- **WHEN** a date-time field defaults to `2026-11-16T10:00:00Z` in an Amsterdam browser
- **THEN** the input displays the corresponding local date and time with its timezone identified
- **AND** submitting without editing retains the exact original default rather than an empty or shifted value

#### Scenario: User edits a date-time

- **WHEN** the user changes a date-time in a browser with a non-UTC timezone
- **THEN** the visible local value and submitted explicitly zoned timestamp identify the same instant
- **AND** ordinary date-only fields retain their date-only semantics

#### Scenario: Local time does not exist

- **WHEN** a user enters an invalid date-time or a local time skipped by a daylight-saving transition
- **THEN** submission identifies the field error without shifting it to another time or losing other form edits

#### Scenario: Supported default has no timezone

- **WHEN** a supported existing date-time default has no offset
- **THEN** it remains visible under the documented local-time interpretation and an untouched submission preserves the original value

### Requirement: Retry derived presentation assets by exact identity

Derived diagram requests SHALL share pending work for the same exact authorized resource and expose pending, success, failure and retry states. Retry and evidence refresh SHALL retry failed preparation for the selected identity without reloading the application. A late result MUST NOT replace another selected revision. Reader detachment MUST release owned work without stopping native execution.

#### Scenario: Preparation fails temporarily

- **WHEN** diagram preparation fails and the reader retries it or refreshes its containing evidence after service recovery
- **THEN** preparation runs again for the same selected surface revision or report request/hash and replaces the local error on success
- **AND** retained source and unrelated widgets remain readable throughout

#### Scenario: Two placements request the same resource

- **WHEN** two mounted placements need diagrams from the same exact retained resource
- **THEN** they share pending preparation and compatible retained results instead of issuing duplicate concurrent reads

#### Scenario: Selection changes before preparation completes

- **WHEN** the reader selects a different resource or revision while preparation is pending
- **THEN** the late result cannot populate the new selection and detachment releases that reader's subscription
- **AND** another reader of the original identity can still receive its result

#### Scenario: Reader retries viewing

- **WHEN** a reader refreshes or retries a generated view
- **THEN** no prompt, tool replay, live snapshot recapture, report publication or workflow transition is admitted

### Requirement: Keep explicit export status consistent with its request

The export UI SHALL present pending, failure and successful download/preview state from the selected explicit export request. An unsuccessful attempt MUST retain the canonical JSON and offer a same-document retry. Preview visibility SHALL remain a local preference and MUST NOT be mistaken for export completion or publication authority.

#### Scenario: Export fails then succeeds

- **WHEN** an explicit export fails and the reader retries successfully
- **THEN** its pending/error display follows the current attempt and the resulting links refer to that document and verified exporter identity

#### Scenario: Reader changes the selected report

- **WHEN** a different exact report is selected while an export is pending
- **THEN** the previous result cannot appear as the new report's export or change its local preview state

### Requirement: Isolate composer interaction from unchanged transcript rendering

Editing the composer SHALL NOT rerender unchanged historical message contents or rebuild their presentation associations. Growing history SHALL remain readable and navigable without silently dropping messages or mounted edits. Streaming, history loading and layout changes SHALL preserve message identity, tool ordering, scroll anchors and current native admission behavior.

#### Scenario: User types in a long conversation

- **WHEN** the user enters 100 characters with 1,000 retained messages loaded
- **THEN** unchanged historical message-content render counts do not increase because of composer edits
- **AND** typing admits no request and the session-scoped draft remains recoverable

#### Scenario: One assistant message streams

- **WHEN** the latest assistant message receives a text or tool update
- **THEN** that message updates without rerendering all unchanged historical message contents or changing native part order

#### Scenario: User reads older content

- **WHEN** earlier pages are loaded and the reader scrolls, uses browser find or focuses historical controls
- **THEN** historical content remains reachable with preserved edits and the reader's position is maintained
- **AND** offscreen rendering optimizations do not hide content from assistive technology or turn read actions into native submissions

### Requirement: Refresh visible age indicators when deadlines pass

Mounted review evidence SHALL update its stale or due label when the displayed observation deadline passes, without waiting for unrelated user input. Age indication SHALL describe retained evidence and MUST NOT synthesize new native observations, change check outcomes or start an additional network polling loop.

#### Scenario: Review observation becomes stale while idle

- **WHEN** the next-check deadline passes while the reader leaves the evidence open
- **THEN** the stale label appears through the existing observation or local clock mechanism without requiring a keystroke
- **AND** closing the view disposes its owned clock work
