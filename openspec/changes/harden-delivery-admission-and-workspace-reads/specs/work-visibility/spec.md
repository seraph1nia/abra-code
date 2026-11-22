# Spec Delta

## ADDED Requirements

### Requirement: Search only committed presentation revisions

Workspace Search and transcript attachments SHALL use the surface or interactive review owner’s commitment evidence before exposing a revision. Discovery SHALL page bounded metadata in the authorized session, retain its continuation across filtered entries, and report incomplete coverage when commitment cannot be established from damaged records.

#### Scenario: The association exists before the revision commits

- **WHEN** publication stops after the producing-message association is stored but before the committed head advances
- **THEN** Search and the transcript omit the pending revision, the exact reader refuses it, and earlier committed revisions remain available.
- **WHEN** recovery completes publication
- **THEN** the matching revision becomes discoverable once and opens in its exact reader.

- **AND** for legacy pending review heads that lack verified predecessor metadata, Search omits the predecessor and reports incomplete coverage until recovery verifies it.

#### Scenario: A publication page has no visible matches

- **WHEN** a page contains pending or malformed associations and another page exists
- **THEN** the caller receives the continuation and can reach committed matches on later pages without loading complete publication bodies during search.

### Requirement: Preserve the reason a publication matched

The workspace palette SHALL retain owner-confirmed matches for the active query when combining them with local previews. A producing tool call or message ID SHALL lead to the exact authorized publication revision even when the displayed label omits that identifier. Duplicate hits for the same target SHALL yield one selectable row.

#### Scenario: A tool call ID matches only association metadata

- **WHEN** the operator enters the producing call ID and the committed surface or review has a different title and target ID
- **THEN** the palette shows that revision and selecting it opens the matching reader.

#### Scenario: Local and remote hits name the same current revision

- **WHEN** a local preview and a result confirmed by producing message ID refer to the same session, kind, target and revision
- **THEN** the palette retains the match once, and a matching earlier revision remains separately selectable.
- **AND** results confirmed for a previous query or session cannot appear as confirmed hits for the current one.

### Requirement: Enumerate owned planning documents once per discovery request

For each issue inspected during a plan passage search, the system SHALL enumerate the eligible worktree documents or delivered archive tree at most once per request. It SHALL preserve per-document containment, bounds, passage identity, coverage and continuation. A subsequent selection SHALL validate the current source again.

#### Scenario: Search multiple documents from one archive

- **WHEN** a discovery page inspects three Markdown files in one delivered archive
- **THEN** it resolves the retained commit and lists its tree once, reads eligible content from those blobs under existing size limits, and returns the same ordered passage identities and cursor as individual reads.

#### Scenario: A worktree document changes after discovery

- **WHEN** an active document disappears or its path resolves outside the owned change while the discovered files are being read
- **THEN** the search preserves valid neighboring results and reports limited coverage for the unavailable document.
- **WHEN** the user later opens a passage whose content or generation changed
- **THEN** the reader rejects the stale selection rather than using the earlier observation as authority.
