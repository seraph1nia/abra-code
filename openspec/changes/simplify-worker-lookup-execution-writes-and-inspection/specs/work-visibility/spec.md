# Spec Delta

## ADDED Requirements

### Requirement: Read a ticket overview independently of planning evidence

Opening or refreshing Overview SHALL return ticket status, description, supervision, blockers and available outcomes without running OpenSpec commands, reading planning document bodies or enumerating live or archived plan paths. Selecting Plan SHALL load policy-appropriate planning evidence independently. Direct ticket URLs and existing full-detail consumers SHALL retain access to their documented evidence.

#### Scenario: Overview opens directly on an active full-OpenSpec ticket

- **WHEN** a user opens an off-page ticket by URL or refreshes Overview after a task invalidation
- **THEN** the inspector presents the ticket with zero planning commands, plan directory listings, archive walks or proposal reads

#### Scenario: User selects Plan

- **WHEN** the user switches from Overview to Plan or opens an existing Plan bookmark
- **THEN** the inspector loads the selected ticket’s applicable progress, proposal, document list or selected document, including verified archive evidence for retired work
- **AND** lightweight and research tasks show their retained scope without running OpenSpec

#### Scenario: Planning evidence is slow or unavailable

- **WHEN** a Plan read stalls or fails and the user returns to Overview or selects another ticket
- **THEN** Overview remains usable and a late result cannot overwrite the newer selection
- **AND** Plan reports unavailable planning evidence when reopened

## MODIFIED Requirements

### Requirement: Finder page work is limited to selected rows

A finder read SHALL return the requested page, exact matching count and continuation with existing filter semantics. Rows SHALL sort by ascending priority and then ascending bytewise issue ID, independently of locale. The read SHALL hydrate issue evidence only for returned rows and their required relations. Serving a page MUST NOT load or sort the full matching ID set in the application, recompute fleet readiness or observe unrelated native sessions.

#### Scenario: One page is read from a large retained population

- **WHEN** a user loads a page from a large graph or changes repository, status or text filters
- **THEN** returned rows, readiness annotations, matching count and continuation agree with the defined finder order and filters
- **AND** the read materializes only page rows and their required evidence even when counting matches requires scanning stored entries

#### Scenario: Priority ties span pages

- **WHEN** matching issues with equal priority include supported IDs of different case or punctuation on both sides of a page boundary
- **THEN** repeated reads against the same graph state return bytewise issue ID order across locales, without skips or duplicates

#### Scenario: An existing graph is upgraded

- **WHEN** the service upgrades a supported graph containing mixed-case historical IDs and resumes issue creation or batch retries
- **THEN** existing and newly created issues participate in the same bytewise tie order, and issue identities, dependency relationships, events and retry receipts retain their meaning
