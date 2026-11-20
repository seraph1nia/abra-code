# Spec Delta

## ADDED Requirements

### Requirement: Find GitHub work through chat and the Work finder

The default Work overview and equivalent Abra inquiry SHALL expose the same GitHub inventory, filter semantics and coverage. Project, item kind, label, remote state and Abra role SHALL be optional filters. Existing local-only work and its detail navigation SHALL remain accessible.

#### Scenario: Ask what is open

- **WHEN** a user opens Work or asks Abra “What's open across my projects?”
- **THEN** both entry points include unassigned open issues and PRs across all registered GitHub projects and expose further pages when the visible answer is bounded
- **AND** inspecting an item leaves local intake, GitHub and the chat draft untouched

#### Scenario: Narrow or revisit the inventory

- **WHEN** a user filters for one project's labeled issues, requests merged PRs, or clears the filters
- **THEN** results include matches beyond the initial page, distinguish merged PRs from closed unmerged PRs and return to all open items when reset

### Requirement: Inspect remote state alongside Abra's work

An item SHALL show its project, number, kind, title, author when available, labels, GitHub state and Abra role. Detail SHALL give access to the source, body, recent discussion and linked local work or findings, with the observation time and any coverage limits.

#### Scenario: A review finishes while its PR is open

- **WHEN** the local review report is complete and GitHub still reports the PR open
- **THEN** the operator sees both outcomes, can open the private findings and can distinguish the author from the reviewer

#### Scenario: A fix ships while its source issue is open

- **WHEN** a local implementation task has a recorded merged delivery PR and its GitHub source issue is open
- **THEN** the issue, PR and local task expose their separate observed outcomes and links
- **AND** the operator can still find the issue in open results and the PR in merged results

#### Scenario: Select a colleague's PR for review

- **WHEN** the user selects the review action on an unassigned PR
- **THEN** the composer targets that exact PR and the assignment request is submitted only on Send

### Requirement: Load inventory details only on demand

The finder SHALL render available cached summaries while stale pages refresh, distinguish incomplete coverage from an empty result and suspend automatic inventory refresh when hidden. Selecting a row SHALL fetch details for that item alone.

#### Scenario: Return to a warm inbox

- **WHEN** a user reopens a fully loaded fresh finder, repeats the query in chat and opens one PR
- **THEN** both lists use the same cached summaries with zero inventory calls, and only the selected PR requires a detail read
- **AND** no changed-file reads run until review is requested
