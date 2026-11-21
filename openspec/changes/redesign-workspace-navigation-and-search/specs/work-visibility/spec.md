# Spec Delta

## MODIFIED Requirements

### Requirement: Explain compute and resource capacity separately

Readiness and operator views SHALL distinguish active-worker limits, role limits, retained-resource limits and dependency blocks. Releasing active capacity MUST NOT make the UI imply that an issue claim or preserved resource was released.

#### Scenario: Worker capacity is available but retained limit is full

- **WHEN** repository setups in preparation occupy all execution slots and worker turns are idle
- **THEN** queued work displays the execution-slot blocker and its owners. Work → Capacity shows used and configured slots globally and for the selected repository. The waiting task links to that scope.

## ADDED Requirements

### Requirement: Browse independently scoped workspace destinations

The workspace SHALL provide distinct Chat, Work, GitHub, Thoughts, Attention and Settings destinations. Each collection SHALL own its filters, pagination, empty state and coverage.

#### Scenario: Triage unrelated collections on desktop

- **WHEN** the operator chooses Work from the desktop rail after viewing merged PRs for one repository
- **THEN** Work shows its own local tasks, Active/Closed/All, repository filter and local pagination. GitHub restores its own kind, remote state, role, label and scope on return. Personal Thoughts is available with zero repositories.

#### Scenario: Find information previously kept in the sidebar

- **WHEN** the operator visits Work, Attention or Settings
- **THEN** Work exposes Sessions, Capacity/fleet and device-local Recently inspected. Attention separates human-actionable native forms, permissions and obligations from other owners with coverage limits. Settings exposes Agents, Repositories with Onboard repository, Appearance and About/licenses.

### Requirement: Adapt navigation to the viewport and entry point

Chat SHALL be the default visit. On wide desktop every task or evidence reader SHALL open beside the live Abra transcript and composer. Tablets SHALL use a destination menu and dismissible evidence sheet. Phones SHALL show one primary surface with Chat, Work, Thoughts and More navigation and a direct return to the same draft.

#### Scenario: Keep live chat beside every wide-screen task or evidence reader

- **WHEN** an operator above 1250 CSS pixels opens a task, Plan, Diff, Verification, Activity/session, report or generated evidence from Work, Search, Attention, a message, an existing bookmark or browser history
- **THEN** the central Abra transcript and usable composer appear beside the selected reader. Switching evidence sections, refreshing or following a related result preserves the same chat, draft, attachments and reading anchor. The return affordance restores the originating list or chat.

#### Scenario: Discuss a diff while it is visible

- **WHEN** the operator enters a question in the desktop composer while reading a diff reached from Work or Search
- **THEN** the diff stays visible while they type and send to Abra. Keyboard focus can move between the transcript, composer and evidence. An explicitly expanded report can return to this split view.

#### Scenario: Move between tablet and phone

- **WHEN** a selected resource crosses the 1250 or 760 CSS pixel breakpoint while the operator has a draft
- **THEN** the tablet sheet or phone detail shows the same selection. At 760 pixels and below GitHub and Settings are under More, and labeled Search and Attention are reachable from the header. The active input and primary action fit the visible keyboard viewport.

### Requirement: Share one chat and reader split

Every desktop chat-and-reader pair SHALL use one saved reader percentage per browser and app origin and one keyboard- and pointer-operable divider. The percentage applies to the space available to the two panes after navigation.

#### Scenario: Set the width once

- **WHEN** the operator drags the divider on Plan, opens Diff for another task, follows a session or report, and reloads the app
- **THEN** the same percentage is used throughout. An already open same-origin tab in another Abra session adopts the setting and a separate browser profile keeps its own. Arrow keys adjust the same value, and assistive technology can identify the handle and its current value.

#### Scenario: A temporary layout cannot fit the saved width

- **WHEN** the user crosses to a tablet sheet or phone detail, returns to desktop, changes the navigation width, or temporarily expands a report
- **THEN** both panes stay usable wherever the split is visible. A temporary fit or single-pane presentation leaves the saved preference intact for the next split.

### Requirement: Restore meaningful navigation and edits

Navigating SHALL preserve the session draft, attachments, transcript anchor, active native form edits and collection return state. Existing finder, Canvas, task, file, scope, surface and exact-revision URLs SHALL continue to resolve.

#### Scenario: Return to a list or interrupted conversation

- **WHEN** a user opens an item from a filtered later page, follows evidence, then uses Back or Forward
- **THEN** history restores the selected resource or original list query, page, scroll and focus. Chat restores the same draft and reading anchor even when a new reply arrived elsewhere.

#### Scenario: Reload an old link with no originating list

- **WHEN** the user opens a legacy finder, Canvas or exact-evidence bookmark in a fresh tab
- **THEN** finder resolves to Work, Canvas resumes a valid inspection for that tab and session or falls back to Work, and exact evidence keeps its original identity. Detail has a return path to its owning collection or Chat.

#### Scenario: A decision changes while the operator reads evidence

- **WHEN** a partially answered form is reopened after the controller has replaced its binding
- **THEN** the UI identifies the changed request and prevents edits or a submission for the older binding from applying to the replacement.

### Requirement: Carry the notebook source through the thought lifecycle

A verified saved, selected, discussed or accepted thought SHALL present a recognizable source card with an original Memos link when the source can be safely identified. The card SHALL distinguish captured wording from a live preview.

#### Scenario: Save, discuss and accept a private thought

- **WHEN** a save is verified, the operator attaches that memo to a draft, sends a question and later accepts an excerpt for work
- **THEN** the save receipt, draft, sent message and task identify the same notebook source. The user can open the original and inspect an on-demand preview with its available snippet, date and tags. The task displays the exact accepted excerpt.

#### Scenario: Memos changes or loses access

- **WHEN** a note is edited, removed, or the configured notebook account changes
- **THEN** accepted work still displays its retained excerpt. The preview explains the changed or unavailable source, a new discussion can reselect current wording, and credentials and private memo bodies stay out of global search history.

#### Scenario: Find work that used the memo

- **WHEN** a user opens Used in work for a verified personal note
- **THEN** a paged read lists only authorized tasks with an accepted reference to that notebook, account and memo, distinguishes accepted versions, and opens each exact task without changing the original note.
