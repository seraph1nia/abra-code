# Spec Delta

## MODIFIED Requirements

### Requirement: Adapt navigation to the viewport and entry point

Chat SHALL remain the default visit. A task opened from Work SHALL occupy the primary reading area with an optional Abra conversation. Chat-originated evidence on wide desktop SHALL retain the live split. Tablet and phone views SHALL preserve the selected evidence, the draft and return navigation across viewport changes.

#### Scenario: Open a task or exact evidence on wide desktop

- **WHEN** the operator opens a ticket or one of its sections from Work above 1250 CSS pixels
- **THEN** the task opens full width within the workspace, and a summary gives its intent, latest known progress, next owner and available action
- **AND** Plan, Diff, Reports and Live session lead to their evidence. Search, Attention, prior bookmarks and browser history resolve their exact target. Earlier Verification and Activity links still reach the corresponding checks, findings, sessions or communications.

#### Scenario: Discuss a diff while it is visible

- **WHEN** the operator asks Abra about a selected diff from the task page or inspects the diff from Chat
- **THEN** the wide-screen reader and the existing Abra composer can be used together at the saved split width, preserving the draft, selection, transcript anchor and keyboard focus return
- **AND** returning to Work restores its list filters and position

#### Scenario: Move between tablet and phone

- **WHEN** a selected resource crosses the 1250 or 760 CSS pixel breakpoint with a draft open
- **THEN** the tablet reader or phone detail shows the same selection. On phones, Chat, Work, Thoughts and More remain reachable, GitHub and Settings are under More, and Search and Attention stay accessible. The input and primary action fit the visible keyboard viewport.

## ADDED Requirements

### Requirement: Count actions owed by the human consistently

The navigation, Attention and task header SHALL derive actionable human decisions from the same owner, target and availability evidence. A decision SHALL be counted once across its representations. A person SHALL reach the corresponding question and evidence directly. Other owners' obligations, unavailable forms and partial coverage SHALL remain distinguishable.

#### Scenario: Human and agent both owe a reply

- **WHEN** one plan has a usable human form, a worker owes an acknowledgement, and another required form is undelivered
- **THEN** the human count is one, Review next opens that plan, and the two other items show their owners and status outside the human count
- **AND** opening either representation of the plan resumes one draft for its binding without duplicate editable controls

#### Scenario: A blocking question falls outside the first history page

- **WHEN** a current question follows a page of resolved requests
- **THEN** following its attention or activity link opens that exact request with its owner, response state and linked answer when present

### Requirement: Read the accepted plan as it progresses

Plan SHALL show accepted intent, criteria, consequential choices and approval state. Full-spec plans SHALL expose ordered tracked steps with labels, observed completion and links to owned source locations. Lightweight and research plans SHALL show their short contracts. Missing, stale or partial evidence SHALL be identified.

#### Scenario: Return to running or retired work

- **WHEN** a user opens a running full-spec plan after a step completes, or reopens its retained revision after retirement
- **THEN** the running view reflects the changed row and the retired view uses the attributable final plan and revision
- **AND** an untracked active step is never inferred from the first unchecked row. A missing historical plan is explicitly unavailable.

### Requirement: Read an evidence-backed outcome at review and after delivery

Reports SHALL present the accepted outcome, observed results against available criteria, the relevant diff revision, checks, independent Review, unresolved findings and limitations. The report SHALL link to available sources and distinguish approval, delivery, cleanup and closure. Research SHALL use its retained investigation report. Existing immutable reports and exports SHALL stay addressable.

#### Scenario: Reconsider a revised merge

- **WHEN** a revised head awaits approval and the prior reviewed revision is known
- **THEN** the decision links what changed since that revision and identifies current checks and Review separately from earlier evidence
- **AND** if comparison or criterion-level proof is unavailable, the report marks the gap without presenting it as passed

#### Scenario: Reopen a completed task

- **WHEN** the worktree has been retired or a branch was preserved without merging
- **THEN** the report shows what the retained receipts establish, including delivery mode, limitations and remaining actions, without requiring a new worker turn

### Requirement: Observe the selected worker at session scope

Live session SHALL default to the exact current assignment and honor explicit historical session selections. Known text or tool-stream updates SHALL refresh only that session's mounted live content. Planning, verification, scheduling and unknown changes SHALL retain appropriate live invalidation, reconnect and manual-refresh behavior.

#### Scenario: Stream a repair with an earlier worker of the same role

- **WHEN** Apply attempt two streams while the first attempt remains in history
- **THEN** Live session defaults to attempt two, a link to attempt one remains on attempt one, and token-only updates cause zero finder, plan or diff reads
- **AND** a real task-checkbox change still updates the mounted plan. If the new assignment lacks a session, the reader reports that state.

### Requirement: Render feedback as a human-readable receipt

A review response SHALL appear as the person's choices or comment with its source revision, admission state and any linked follow-up. Central Abra SHALL be able to retrieve the exact retained response. Rendering SHALL verify the admitted response identity and preserve ordinary user-authored messages.

#### Scenario: A short visual choice survives reload

- **WHEN** an operator submits a choice, loses the response and reopens the conversation
- **THEN** the admitted message has one correlated feedback receipt showing what the person chose, and the resulting revision appears when published
- **AND** native transport instructions and serialized protocol fields stay out of the human receipt. Similar text typed manually remains an ordinary message.
