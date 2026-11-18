# Spec Delta

## ADDED Requirements

### Requirement: Finder page work is limited to selected rows

A finder read SHALL return the requested page, exact matching count and continuation with existing filter and ordering semantics. The read SHALL hydrate issue evidence only for returned rows and their required relations. Serving a page MUST NOT load or sort the full matching ID set in the application, recompute fleet readiness or observe unrelated native sessions.

#### Scenario: One page is read from a large retained population

- **WHEN** a user loads a page from a large graph or changes repository, status or text filters
- **THEN** returned rows, readiness annotations, matching count and continuation agree with the existing finder contract
- **AND** the read materializes only page rows and their required evidence even when counting matches requires scanning stored entries

#### Scenario: Priority ties span pages

- **WHEN** matching issues with equal priority include supported IDs of different case or punctuation on both sides of a page boundary
- **THEN** repeated reads against the same graph state preserve the established locale-sensitive order without skips or duplicates

### Requirement: Finder and fleet observations retain their own freshness

Finder rows and page metadata SHALL describe a coherent retained graph observation or an explicit unavailable result. Fleet totals SHALL retain independent source freshness and population coverage. A finder request MUST NOT wait for a new fleet calculation, and stale, partial or unavailable fleet results MUST NOT appear current and complete.

#### Scenario: Fleet refresh falls behind a graph commit

- **WHEN** a graph commit changes the result set while fleet aggregation is pending
- **THEN** a finder read can return a coherent page from the new graph revision
- **AND** the fleet view keeps its last valid evidence with appropriate freshness or reports it unavailable

#### Scenario: A commit overlaps page capture

- **WHEN** relevant retained state changes between reading page metadata and collecting the evidence for its rows
- **THEN** the finder returns one coherent capture after bounded retries or an explained unavailable result without advancing lifecycle state
