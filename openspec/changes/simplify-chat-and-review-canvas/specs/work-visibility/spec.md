# Spec Delta

## ADDED Requirements

### Requirement: Reach a pending human decision from compact attention

The workspace SHALL keep current human obligations discoverable from a compact count and a Review next action when an answer is available. Developers SHALL be able to reach every listed obligation, distinguish partial coverage, and resume edits for the same native form binding. Read history SHALL remain separate from unresolved attention.

#### Scenario: Several items need attention while reading

- **WHEN** two actionable decisions and an informational recap are available
- **THEN** the transcript stays in place, Review next opens an actionable decision, and reading the recap or inspecting a decision leaves unresolved obligations counted

#### Scenario: Resume or supersede a native answer

- **WHEN** a developer edits a native answer, collapses attention, inspects evidence, and reopens the same binding
- **THEN** the answer retains its edits and submission revalidates the binding
- **AND** if the binding has been superseded, the replacement is distinguishable and the earlier edits cannot answer it

### Requirement: Open the evidence named by a link

The canvas SHALL lead with the selected resource and show its task context when applicable. A compact section switcher SHALL preserve access to the other work views. Links to an exact finding, file, plan passage, or report SHALL open that owned target or explain its unavailability. Existing task bookmarks, browser history, focus return, and the single composer SHALL remain usable.

#### Scenario: Follow a finding into a diff

- **WHEN** a developer opens a finding with a verified issue, finding revision, and attributable changed-file reference
- **THEN** the finding is visible immediately and its file action opens that file in the diff viewer
- **AND** Back restores that finding, and reload restores the selected target

#### Scenario: Evidence lacks a file or has moved

- **WHEN** a finding lacks a verifiable changed-file reference, or the requested revision or plan passage cannot be resolved
- **THEN** available evidence stays readable and the UI identifies the missing detail without guessing a file or substituting a newer revision

#### Scenario: Open a task bookmark on a phone

- **WHEN** the developer opens an existing issue and tab URL or follows a retained report link
- **THEN** the requested work view or exact report opens in the dismissible canvas and dismissing it restores focus appropriately

### Requirement: Carry a selection from the canvas into the conversation

The canvas SHALL offer one recognizable Ask Abra action and a consistent, readable source label for diff lines, plan passages, and screenshot regions. Explicit attachment SHALL preserve typed text and return focus to the main composer. Inspecting other work SHALL preserve the original attachment until the developer replaces, removes, or sends it.

#### Scenario: Ask about A while inspecting B

- **WHEN** a developer selects lines on A, invokes Ask Abra, inspects B, reloads, and sends
- **THEN** the draft and sent message identify A's file, side and range, and the sent question reopens the captured excerpt even if A changes later

#### Scenario: Ask from a narrow viewer

- **WHEN** a keyboard user attaches a plan passage or a screenshot region from the narrow canvas
- **THEN** the composer receives focus with its existing question, and its attachment and the sent message use the same source label for the exact passage or region

### Requirement: Present a useful answer at each producing tool call

The conversation SHALL keep a concise takeaway at the native call's position. A small result SHALL be readable inline. A multi-item result SHALL surface significant findings and disclose partial coverage. A substantial generated comparison, board, or diagram SHALL offer one direct action from its inline preview to the complete layout.

#### Scenario: A blocking result occurs between two text segments

- **WHEN** a tool returns several findings including one blocker between two parts of Abra's answer
- **THEN** the transcript preserves that order, shows the blocker and its evidenced reason inline, and offers the remaining results without a stack of expanded cards
- **AND** a loaded subset is labeled as partial and replaying history preserves the original call identity

#### Scenario: A comparison is the tool result

- **WHEN** the tool call produces a multi-task comparison
- **THEN** one preview shows an evidenced takeaway or describes the available comparison, and one action opens the full layout directly without expanding an intermediate tool card

### Requirement: Open the exact generated layout from conversation history

The canvas SHALL resolve a retained surface by its owning conversation, surface identity, and layout revision, including layouts spanning tasks. It SHALL distinguish current bound data from captured values. Frozen reports SHALL reopen with their original contents. Opening a layout SHALL be read-only and preserve the user's place in chat.

#### Scenario: Reopen after a newer layout is published

- **WHEN** a developer opens the original comparison from chat, Back, or a bookmark after publication of a second revision
- **THEN** the original layout is displayed with its data mode identified, and a saved snapshot still shows its captured values
- **AND** a missing or foreign revision shows a local unavailable state without substituting the latest layout

### Requirement: Lead verification with attributable outcomes

Verification SHALL lead with the check outcome for the observed content, the independent review status, and the next available action. A reader SHALL be able to expand the underlying evidence, including provenance, commands, and fingerprints, and distinguish missing proof from an earlier pass.

#### Scenario: A change follows a passing check

- **WHEN** a check passed on an earlier revision and the current change has no matching receipt
- **THEN** the headline identifies the earlier pass and the absence of current proof, and the previous receipt remains inspectable

#### Scenario: Independent review is unavailable

- **WHEN** the checks match the observed content but the independent review cannot be read
- **THEN** both facts are visible together, available evidence remains readable, and any pending decision leads to its current bound form

### Requirement: Refresh visible canvas evidence together

The canvas SHALL offer one refresh action for its visible evidence. A failed section SHALL show a scoped retry and identify any retained last successful result. Refreshing SHALL preserve selection, drafts and unrelated observations, and heavy content SHALL load only when inspected.

#### Scenario: One of several evidence reads fails

- **WHEN** the reader refreshes a verification canvas and a single section fails
- **THEN** successful sections remain visible, the failed section offers Retry, and retrying reads only that section and its visible dependencies
- **AND** unopened screenshots, other tasks, and frozen report content are unaffected by live refresh

#### Scenario: Selection changes during refresh

- **WHEN** the developer opens B before a refresh for A returns
- **THEN** the late result cannot replace B's evidence or alter the draft
