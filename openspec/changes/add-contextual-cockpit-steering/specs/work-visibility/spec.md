# Spec Delta

## ADDED Requirements

### Requirement: Keep the developer's chosen work in focus

The workspace SHALL offer one resizable desktop canvas and an equivalent narrow-screen view beside the persistent Abra conversation. Chat cards, supported generated-view links, finder entries and verification links SHALL open the same owned resources. Background activity SHALL leave the developer's current selection in place.

#### Scenario: Another task completes during review

- **WHEN** a developer is reading a diff and another task publishes a result
- **THEN** the result can be opened explicitly while the current diff, reading position and draft stay available

#### Scenario: A developer returns through browser history

- **WHEN** the developer opens a result from a chat card and uses Back or restores an existing issue bookmark
- **THEN** the corresponding canvas selection is restored, including on narrow screens with keyboard navigation

### Requirement: Inspect the evidence for one change

The verification view SHALL connect the task's accepted scope, changes, check outcomes, independent findings and current next decision through attributable sources. Each result SHALL distinguish the observed revision, missing evidence and freshness. Full-spec, lightweight and research tasks SHALL show evidence appropriate to their workflow.

#### Scenario: A new edit follows a passing recheck

- **WHEN** the developer opens the canvas after another edit supersedes the tested content
- **THEN** the earlier pass remains inspectable with its source and the later edit has no confirmed passing result until matching evidence exists

#### Scenario: Only some evidence is available

- **WHEN** a screenshot is available but a relevant check or independent finding is missing
- **THEN** the developer can inspect the screenshot and see which proof remains unavailable
- **AND** a research report or lightweight fix shows its actual scope without fabricated implementation tasks

#### Scenario: Inspecting a decision beside its evidence

- **WHEN** the developer opens a decision from a verification result
- **THEN** they can inspect its evidence and reach the current bound form, which revalidates the decision on submission
- **AND** a stale decision cannot authorize a later generation

#### Scenario: Working while a check is in progress

- **WHEN** check or decision state changes while the relevant canvas is open
- **THEN** the compact summary updates from observed state without requiring a message to Abra, and large evidence loads only for the inspected resource

### Requirement: Separate current attention from local reading history

The return view SHALL present current human-owned obligations independently of material changes since the developer last inspected covered work on this device. It SHALL disclose its coverage and advance reading history only on explicit inspection of the recap or result.

#### Scenario: Return to three active tasks

- **WHEN** task A has a new result, B has a human decision and C is running without a material change
- **THEN** the developer can open A's result and B's decision directly, and routine activity from C adds no decision
- **AND** marking an item seen leaves B in attention until its obligation is actually settled

#### Scenario: Reading history is unavailable or partial

- **WHEN** this is the first visit, local storage is unavailable, or an issue was outside the retained reading window
- **THEN** current attention remains accessible and the UI identifies the available recap coverage without claiming a complete change history

#### Scenario: Reconnect while away from the recap

- **WHEN** the browser reconnects, receives repeated updates or a different task becomes active
- **THEN** background observation alone does not mark new evidence seen or duplicate a material change

### Requirement: Open tool evidence from verification results

When available, the canvas SHALL offer an owned retained trace produced by the target repository, a file or symbol reference, or a versioned documentation source supplied by a worker. The result SHALL identify its source and expose missing or unsupported evidence locally.

#### Scenario: A repository produces a Playwright trace

- **WHEN** a scoped verification run retains an existing trace and the producing worktree retires
- **THEN** the developer can retrieve that specific trace from its result and inspect it with a compatible viewer

#### Scenario: A worker cites code and library documentation

- **WHEN** a worker supplies an owned file or symbol location and a versioned documentation link
- **THEN** the result exposes the location and named version or source, and labels an unavailable historical location without substituting the current checkout

#### Scenario: No optional tool produced an output

- **WHEN** the repository produces no trace or the worker has no lookup integration
- **THEN** the other verification results remain usable without tool installation
