# Spec Delta

## Purpose

Let operators discover GitHub work across registered projects and explicitly connect an issue or pull request to the work Abra performs.

## ADDED Requirements

### Requirement: Enumerate open work across registered GitHub repositories

Default discovery SHALL cover every open issue and PR in every registered GitHub repository accessible to the operator, regardless of label, authorship, assignment, local work or delivery policy. It SHALL expose continuation, freshness and incomplete coverage.

#### Scenario: A later page includes a colleague's draft

- **WHEN** the first page contains unlabeled issues and a later page contains a colleague's open draft PR in a branch-delivery project on GitHub
- **THEN** both are reachable in the default results without intake, label setup or a change of filter

#### Scenario: A repository cannot be read

- **WHEN** credentials, API limits, an invalid continuation or a partial response prevent a complete read
- **THEN** readable projects and verified pages remain usable, the affected coverage is identified and a refresh can retry
- **AND** an incomplete observation cannot establish closure, a zero count or a new assignment

### Requirement: Identify why an item is in Abra's scope

The system SHALL bind local work to the verified repository and GitHub item identity and distinguish issue pickup, PR review and controller-owned delivery. Only a matching controller delivery record SHALL establish the delivering role.

#### Scenario: Two PRs have the same author

- **WHEN** a previously recorded Abra delivery and an unrelated PR were opened under the same account
- **THEN** discovery identifies the first PR as delivering its local task and shows the second as having no Abra assignment

#### Scenario: Similar identifiers and issue mentions

- **WHEN** a colleague's PR mentions an issue Abra is implementing and another project has the same PR number
- **THEN** neither a textual mention nor a matching number grants delivery ownership or links either PR to the wrong task

### Requirement: Pick up a GitHub issue once

Explicit pickup of an open issue SHALL create a linked local task under ordinary repository intake and scheduling policy. Concurrent or repeated equivalent requests SHALL resolve to the same task across restarts. Remote edits SHALL remain distinguishable from the task's accepted scope.

#### Scenario: Two clients pick up the same issue

- **WHEN** both requests target the same verified issue and a client retries after response loss
- **THEN** each receives the same durable task and source link
- **AND** an intake failure leaves neither a partial task nor an orphaned assignment

#### Scenario: An issue changes after pickup

- **WHEN** the reporter edits the issue or closes it on GitHub during local work
- **THEN** refresh shows the current remote state beside the retained local scope and progress, and the operator can decide how to proceed

### Requirement: Review an external PR as private work

An explicit review request SHALL create or reuse a read-only local assignment tied to the selected PR and assessed base and head. Its private report SHALL identify the changes examined, findings and coverage limits. Assignment alone grants no delivery or public review authority.

#### Scenario: A fork PR receives an update during review

- **WHEN** the operator requests a review of a colleague's fork PR and the head advances before the report is opened
- **THEN** the findings identify the reviewed revision and the newer observed revision is shown separately
- **AND** repeating the original request returns its assignment without submitting feedback, modifying the fork or merging the PR

#### Scenario: A diff cannot be obtained completely

- **WHEN** the selected revision cannot be verified or only part of its changes are readable
- **THEN** the assignment reports the unavailable evidence or partial coverage and cannot claim a complete review

### Requirement: Share demand-driven inventory and retain work independently

Chat and web SHALL share account-scoped persisted summaries, page progress and freshness. Startup SHALL defer inventory until requested. Demand SHALL coalesce equivalent refreshes, bound concurrent reads and respect rate limits. Expiring cached summaries or details SHALL preserve accepted local work and evidence.

#### Scenario: Refresh detects a closure after restart

- **WHEN** an earlier open scan completed, a colleague closed an item and the operator returns after restart
- **THEN** an incremental refresh includes closed and reopened items, survives interruption and advances the successful checkpoint only after completing its range

#### Scenario: Authentication or repository changes

- **WHEN** the viewer changes or GitHub reports that the repository is inaccessible
- **THEN** the inbox withholds observations outside the current access scope and preserves independently retained local work
