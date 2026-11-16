# Spec Delta

## ADDED Requirements

### Requirement: Verify immutable report files before use

Report file reads and publication SHALL validate owned destination containment, regular-file identity, byte bounds and expected content digest/size. JSON documents and derived HTML exports SHALL obey the same physical-file guarantees while retaining their distinct format and receipt rules. Invalid files MUST remain preserved and unavailable for successful use.

#### Scenario: JSON or HTML bytes no longer match their receipt

- **WHEN** a retained JSON document or derived HTML export differs from its expected digest or byte count
- **THEN** the operation reports an integrity failure without accepting, overwriting or regenerating the conflicting file

#### Scenario: Destination escapes its owned location

- **WHEN** a selected report or staging path resolves outside its permitted destination or is a symlink or non-regular file
- **THEN** the operation refuses it without following the path for publication or deleting the conflicting resource

#### Scenario: File exceeds the supported size

- **WHEN** a JSON, export or export receipt file exceeds its applicable byte bound
- **THEN** the read or publication fails within the bound without treating a partial read as verified content

### Requirement: Reconcile occupied report destinations without replacement

Immutable file publication SHALL reuse an occupied destination only when its validated bytes match the expected content identity. Conflicting destinations MUST be preserved. Interrupted publication and retries SHALL reconcile verified existing content before creating new output, preserving retained identity and the existing JSON/export recovery semantics.

#### Scenario: Same content is published concurrently

- **WHEN** concurrent or retried publications target the same owned destination with identical expected bytes
- **THEN** they reconcile the same verified file without replacing its content or allocating a different domain publication identity

#### Scenario: Different content already occupies the destination

- **WHEN** a publication finds different bytes at its intended immutable destination
- **THEN** it reports a conflict while preserving those bytes, previous receipts and unrelated files

#### Scenario: Export HTML exists before its receipt is committed

- **WHEN** an export is interrupted after HTML publication and before its matching receipt is committed
- **THEN** recovery validates the retained HTML against the original document/exporter identity and completes only the matching receipt without overwriting HTML or recapturing current work

### Requirement: Keep report file recovery subordinate to publication authority

Verified file facts MUST NOT authorize a report receipt, change execution generation or advance workflow state. Publication owners SHALL retain their locks, authorization and receipt rules. Staging cleanup SHALL remove only proven owned scratch resources and preserve evidence required by existing interrupted-publication recovery.

#### Scenario: File is valid but publication authority is stale

- **WHEN** expected file bytes exist but the publication owner's current generation or authority check fails
- **THEN** no successful domain receipt or workflow transition is created from the file's existence alone

#### Scenario: Cleanup finds changed or unrelated staging evidence

- **WHEN** an interrupted operation's staging path has been replaced or cannot be proven to hold its owned expected content
- **THEN** cleanup preserves it and unrelated resources rather than treating a matching filename as deletion authority

#### Scenario: Historical staged JSON is resumed after refactoring

- **WHEN** recovery encounters a supported pre-refactor pending document with retained staging identity
- **THEN** it preserves the original request, content and receipt semantics without converting the stored intent or erasing still-required staging evidence

### Requirement: Freeze generated binding selections independently

Saving a generated surface SHALL capture the current values required by its live bindings and preserve the original values required by its snapshot bindings. Each binding SHALL retain its own selection, mode and coverage. A task-specific sibling link MUST NOT narrow another widget. Saving MUST NOT submit a native prompt or mutate workflow state.

#### Scenario: Mixed selections are saved together

- **WHEN** an unfiltered snapshot table, a task-specific report link and an explicit live summary share a valid surface
- **THEN** the saved document retains the table's bounded captured population, the link target and the live summary's save-time values independently

#### Scenario: Live task is outside the loaded history page

- **WHEN** an explicit live binding references an authorized retained task outside the workspace's current history page
- **THEN** saving captures that task's resolved current summary without silently omitting it or substituting its old snapshot values

#### Scenario: Live and snapshot versions differ

- **WHEN** a surface's snapshot task has changed in current work before the user saves a document containing both modes
- **THEN** the saved snapshot widget retains the publication-time value and the saved live widget retains the separately observed save-time value

### Requirement: Refuse incomplete explicit captures and disclose bounded populations

A new saved document SHALL capture every required explicit task within its supported bounds or fail without publication. Unfiltered populations exceeding a bound SHALL retain explicit coverage limitations. Missing or failed observations MUST NOT become authoritative empty rows or zero counts. Capture failure MUST preserve existing documents and publication identities.

#### Scenario: Required live task becomes unavailable during save

- **WHEN** a new save cannot resolve a task explicitly required by a live binding
- **THEN** it fails with a bounded source diagnostic and creates no apparently complete replacement document or changed prior artifact

#### Scenario: Unfiltered capture is larger than its budget

- **WHEN** a new save observes an unfiltered population larger than its captured row budget
- **THEN** the document records its known coverage and truncation and labels subset counts as partial

#### Scenario: Publication succeeded before its response was lost

- **WHEN** a previously published save request is retried after its live tasks have changed or become unavailable
- **THEN** reconciliation returns the original verified document without recapturing data, changing its coverage or allocating another revision

### Requirement: Preserve binding evidence across document compatibility paths

Reopening or exporting a saved document SHALL use only its captured binding values and coverage. Supported older records without coverage SHALL retain their original bytes, hashes and identities with unknown coverage explicitly labeled. Missing historical rows MUST NOT be reconstructed from current work. Unknown formats SHALL remain preserved and individually unavailable.

#### Scenario: Saved report is reopened after native restart and retirement

- **WHEN** the native service restarts, source work is retired and the saved report is reopened
- **THEN** its mixed live/snapshot bindings retain their saved values and limitations without live summary reads

#### Scenario: Document is exported and moved offline

- **WHEN** a saved document is exported to HTML, relocated and opened without network access
- **THEN** its rows, counts and coverage labels match the saved document and no application or native connection is required

#### Scenario: Historical document predates coverage metadata

- **WHEN** a supported old document lacks explicit binding coverage or lacks rows now known to exist
- **THEN** viewing states unknown historical coverage without rewriting the document or inserting current task values
