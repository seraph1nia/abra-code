# Spec Delta

## ADDED Requirements

### Requirement: Navigate the workspace at phone widths

At viewport widths up to and including 760 CSS pixels the workspace SHALL provide persistent, labeled Chat, Canvas and Settings navigation. An ordinary workspace visit SHALL open Chat. Users SHALL be able to identify the current destination and operate navigation by touch or keyboard. Only the active destination and its controls SHALL participate in reading and focus order.

#### Scenario: Start a conversation on a phone

- **WHEN** the user opens the workspace root in a 390-pixel-wide portrait browser
- **THEN** Chat is selected, the transcript and composer are visible, and connection status and pending decisions are reachable from Chat

#### Scenario: Open a bookmark or traverse history

- **WHEN** the user opens or reloads an existing evidence bookmark or Settings subpage, or uses Back or Forward between destinations
- **THEN** the active navigation item and visible content match the URL, including the evidence selection or Settings subpage it identifies

#### Scenario: Change width while inspecting evidence

- **WHEN** the user resizes from a phone width through the tablet layout to a wide desktop and back with evidence selected
- **THEN** the same selection appears in the appropriate phone destination, tablet sheet or desktop inspector, and the user can resume the same draft

### Requirement: Return from phone Canvas to a conversation in progress

Canvas SHALL open evidence links at their exact target and give access to the Work finder. Selecting Canvas directly SHALL reopen the last inspected target in the current tab and Abra session, or show the finder on first use. Switching destinations SHALL retain draft text, attachments, the transcript reading position and edits to a still-current native form. Navigation by itself SHALL have no submission effect.

#### Scenario: Choose work and revisit it

- **WHEN** the user opens Canvas before inspecting anything, chooses a task from the finder, opens a file in its diff, visits Chat, and taps Canvas again
- **THEN** the same task, diff and file reopen, with an action to find other work

#### Scenario: Follow evidence while writing

- **WHEN** the user starts a prompt, opens an evidence link from a message, and chooses Ask Abra on selected evidence
- **THEN** Canvas opens the linked target, then Chat restores the draft with the selected evidence attached and focuses the composer for explicit submission

#### Scenario: Read Settings while a reply arrives

- **WHEN** a user reading an earlier message visits Settings with a draft and edits to a current human decision, receives a reply, then returns to Chat
- **THEN** the earlier message remains in view, the draft and attached evidence are available, and reopening the same decision restores its edits

#### Scenario: Previously viewed evidence becomes unavailable

- **WHEN** the user revisits a Canvas target whose evidence is unavailable
- **THEN** Canvas identifies the unavailable selection and offers access to the finder and Chat

### Requirement: Compose within the visible phone viewport

Phone Chat SHALL keep the editable prompt and current submission action within the usable viewport as the software keyboard opens and closes. The transcript SHALL scroll independently, and wide message content SHALL stay within its own scrolling area. Existing submission and recovery behavior SHALL apply across destination changes.

#### Scenario: Type and send a prompt in portrait

- **WHEN** the user focuses the composer at a 375- or 390-pixel portrait width, opens the keyboard and types a multiline prompt
- **THEN** the edited line and applicable Send or Queue action remain reachable above keyboard and device insets, and the user can submit without panning the page sideways

#### Scenario: Resume after losing the submission response

- **WHEN** the user submits a prompt, loses the response, and returns to Chat after a connection interruption
- **THEN** Chat shows the original submission's confirmed or pending state through existing recovery and does not send a duplicate
