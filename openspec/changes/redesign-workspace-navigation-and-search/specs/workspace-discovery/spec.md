# Spec Delta

## Purpose

Let an operator find a remembered item or action across AbraCode and reach its owning reader, conversation or form with its identity and context intact.

## ADDED Requirements

### Requirement: Open workspace search from any destination

Search SHALL be reachable by touch and ⌘/Ctrl K from workspace and Settings destinations, including direct entry. Dismissing it SHALL return focus and preserve the current destination and edits.

#### Scenario: Search over a phone keyboard

- **WHEN** the user opens Search from a phone Settings page, highlights a hit, then cancels
- **THEN** the full-screen picker keeps the input, results and Close reachable above the keyboard and returns to the same Settings control with browser history intact.

#### Scenario: Use Search while inspecting a modal sheet

- **WHEN** an inspector sheet owns focus and the user activates its Search control
- **THEN** one accessible picker owns focus, Escape returns to the sheet and repeated shortcuts or IME composition cannot submit a result or dismiss the underlying reader.

### Requirement: Find exact items across sources

Search SHALL support All, type filters, command aliases and source-specific continuation. Each result SHALL identify its type, title, owner and selection effect. Exact identities SHALL rank first, followed by exact names and then contextual or textual matches.

#### Scenario: Find a closed task and a similarly named remote item

- **WHEN** a task ID outside the first page also occurs in other titles and the task links to a GitHub PR
- **THEN** the exact task leads, its PR remains a separate addressable hit, and More in Work carries the query into active and closed work across repositories.

#### Scenario: Recall a note or worker without knowing the parent

- **WHEN** the operator searches by memo words or tag, or by worker ID, role, repository or owning task title
- **THEN** Search can find the private personal memo or owned session beyond the mounted page, with a typed result opening the exact note or read-only transcript. The central Abra session opens Chat.

#### Scenario: Find a page, agent, repository or action

- **WHEN** the operator enters an agent ID, repository name, destination, “add project” or a command-only query
- **THEN** results can focus the definition, registry entry or page, or show a named command with its effect and required context. Empty Search offers recent destinations and frequent eligible actions.

### Requirement: Open retained evidence by its identity

Search SHALL open owner-validated results for decisions, permissions, waits, reports, reviews, generated views, files, plan passages, findings, receipts, messages, communications, leads and proposals at their owning resource or labeled scoped reader.

#### Scenario: Open an earlier publication or piece of evidence

- **WHEN** two revisions share a title or two tasks contain the same path
- **THEN** results distinguish issue, revision and source where applicable. Opening preserves the selected hash, generation, file, range or receipt identity, or explains that the exact source is unavailable.

#### Scenario: A hit points to an obsolete approval or missing history

- **WHEN** an operator opens a settled decision, a replaced permission or a compacted message
- **THEN** Search offers the corresponding retained history or reports its availability limit. Opening the result cannot answer a replacement request or substitute a newer message.

### Requirement: Report search coverage independently

Each source SHALL return bounded, independently usable results with freshness, coverage, continuation and failure states. Switching query, scope, session or account SHALL prevent a late response from replacing current results.

#### Scenario: A notebook fails while other results arrive

- **WHEN** the notebook is unavailable while work, GitHub and commands match the query
- **THEN** those matches remain usable, the notebook has its own retry, and a large work result set leaves room for matches from other sources.

#### Scenario: Only part of a history is observable

- **WHEN** the source can search only a retained window or a loaded message page
- **THEN** the picker identifies that scope and any continuation, distinguishes it from a complete zero-match result and opens further scoped results with the original filters.

### Requirement: Select commands by their declared effect

Palette, contextual buttons and supported slash aliases SHALL use the same named actions for opening, attaching, preparing a draft or opening a bound form. Any subsequent send, answer, save or export SHALL retain its own explicit action.

#### Scenario: Prepare onboarding or a reusable snippet

- **WHEN** a user selects Onboard repository from Settings, command search or the composer’s `/onboard-repo` suggestion with an existing draft
- **THEN** all three prepare the same editable onboarding request, preserve preceding prose and attachments, and focus the one Abra composer. An insert-code action similarly adds attributed fenced text for inspection before Send.

#### Scenario: Save or attach a thought

- **WHEN** the user selects `/save-thought` or `/attach-thought`
- **THEN** Save thought prepares an editable request for the exact wording and Attach thought opens a picker. Cancel preserves the original draft, and only selecting a specific memo attaches its versioned reference.

#### Scenario: Literal input and unavailable actions

- **WHEN** the user pastes a path, code or a literal slash command, types with an IME, or selects a template that exceeds the draft limit
- **THEN** text remains editable without automatic command execution, sending or truncation of existing content. Missing prerequisites or insufficient space are explained before the draft changes.

#### Scenario: Distinguish approval, task control and stopping a turn

- **WHEN** a user selects an approval, Pause work or a report export action from Search
- **THEN** approval opens its current native form, Pause prepares an issue-specific request, and export opens its report control. Stopping the current Abra turn remains a separate busy-conversation action.
