# Spec Delta

## ADDED Requirements

### Requirement: Operate workspace Search by keyboard or touch

The web workspace and Settings SHALL expose a visible Search control and support ⌘K on macOS and Ctrl+K on Windows and Linux. Opening Search SHALL focus its labeled input. The user SHALL be able to move the highlight with arrow keys, select with Enter or a tap, and dismiss with Escape. Opening and dismissing Search SHALL preserve the active URL and workspace state.

#### Scenario: Look up work while writing

- **WHEN** a user with a draft and attached evidence opens Search from the composer, types a query, moves the highlight and presses Escape
- **THEN** the query stays as typed while highlighting, the composer regains focus, and the draft, attachment, transcript anchor and browser history are preserved.

#### Scenario: Search on a phone from Settings

- **WHEN** the user visits a Settings subpage directly on a phone and taps Search
- **THEN** the palette opens with reachable input and results, the workspace destinations are available without first loading a conversation, and dismissal restores the Search control on the same subpage.

#### Scenario: A modal already owns focus

- **WHEN** the user presses the palette shortcut inside another modal or repeats it while Search is open
- **THEN** the current modal retains input and a second palette does not open.

### Requirement: Find retained tasks from the palette

Search SHALL match local task titles and issue IDs across projects and across active and closed work. An exact ID SHALL rank first even when other matches exceed the preview limit. Task rows SHALL display title, project or unassigned status, and task status. Selecting a task SHALL open its overview. **See all results in Work** SHALL carry the search text into the full finder with the same project and status scope.

#### Scenario: Open an older task by ID

- **WHEN** a pasted ID exactly matches a closed task outside the initial finder page and also appears in many other titles
- **THEN** the exact task is first and selecting it opens that task in the inspector, including Canvas on a phone.

#### Scenario: Continue a title search

- **WHEN** a user types part of a title shared by tasks in several projects and selects **See all results in Work**
- **THEN** the finder opens on the first page with that query, all projects and all local work states selected, and the user can refine the results there.

#### Scenario: Results arrive late or cannot be read

- **WHEN** the query changes before an earlier read finishes, or the current read fails
- **THEN** a late response cannot replace the current matches, and a failed read is distinguishable from zero matches while matching navigation commands remain usable.

### Requirement: Navigate from the palette using workspace context

The palette SHALL offer Chat, Work finder and Settings navigation. For an inspected task it SHALL offer Plan, Diff, Verification and Reports, with the target task title. With an empty query it SHALL offer pending decision review when a human decision is waiting and resume the last inspected item when one is known in this tab and Abra session. Palette selections SHALL navigate without submitting a prompt or a decision.

#### Scenario: Inspect a diff and return to writing

- **WHEN** a user inspecting a task searches for “diff”, selects its named Diff command and later chooses **Return to chat**
- **THEN** the existing inspector opens the selected task’s Diff tab, and Chat restores the draft and attachments with focus in the composer.

#### Scenario: Resume an exact target

- **WHEN** a user opens Search in Chat after inspecting a specific file in a task’s diff
- **THEN** the empty palette offers to reopen that file, and choosing it restores the selection in Canvas or the desktop inspector.

#### Scenario: Review a pending decision

- **WHEN** a human decision is pending and the user chooses **Review pending decisions** from the empty palette
- **THEN** the existing Attention view opens with any edits to the current form preserved, and the answer awaits explicit submission there.

#### Scenario: Open Search without task context

- **WHEN** a user first opens Search with no selected task, saved inspection or pending decision
- **THEN** Chat, Work finder and Settings destinations are available and the palette omits the inapplicable contextual suggestions.
