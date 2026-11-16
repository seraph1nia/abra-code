# Spec Delta

## Purpose

Let operators converse with Abra while inspecting concise typed work evidence and generated artifacts through the same conversation and an optional adjacent viewer.

## ADDED Requirements

### Requirement: Keep Abra chat as the primary surface

The workspace SHALL keep one retained Abra conversation as its primary surface. Task summaries, generated views and artifact cards SHALL appear in conversation context. Work discovery and inspection SHALL remain available without replacing the conversation or creating a worker composer. Closing the browser MUST detach observation without stopping native work.

#### Scenario: Abra answers a task question

- **WHEN** the user asks about a task and Abra returns work evidence
- **THEN** the answer can contain a concise task card with inspection links in the conversation without switching to a separate Work views mode

#### Scenario: User inspects work while composing

- **WHEN** the user opens and closes work discovery or a task/session/artifact viewer while editing a message
- **THEN** the draft and conversation position remain intact and further instructions continue to target Abra

#### Scenario: Browser is closed

- **WHEN** the user closes the workspace while a native turn or managed work is active
- **THEN** native sessions and work continue under their existing ownership

### Requirement: Render native tool observations with stable identities

The conversation SHALL preserve native text/tool order, message IDs, tool-call IDs and observed tool states. Supported tool results SHALL render as typed compact UI; other tools SHALL have a bounded fallback. Reload, history loading and reconnect MUST NOT reexecute tools or duplicate observations. Hidden reasoning and provider replay payloads MUST remain excluded.

#### Scenario: One turn contains text and tools

- **WHEN** Abra emits text, a tool observation and further text
- **THEN** the conversation retains that order and renders the tool's current observed state and safe result under its original native identity

#### Scenario: Completed call is loaded from history

- **WHEN** a completed native tool call appears after reload or earlier-message pagination
- **THEN** its card/result is rendered from retained evidence without another tool execution or model turn

#### Scenario: Unknown tool result is large

- **WHEN** a tool has no specialized renderer or contains an oversized external result
- **THEN** the default shows a concise name/state and bounded optional details with explicit limits instead of an unbounded payload

### Requirement: Load minimal typed evidence on demand

Default cards and workspace updates SHALL contain only bounded summaries and resource references needed for the current view. Full transcripts, bodies, diffs, report documents and history SHALL load on demand with totals/continuations or explicit limits. Resource errors SHALL preserve unrelated readable content; changing selection MUST prevent a late response from replacing the selected evidence.

#### Scenario: Task card is visible but not expanded

- **WHEN** a task summary is rendered in chat
- **THEN** the workspace does not load that task's full worker transcript, report bytes or feedback history merely to show the card

#### Scenario: Communication exceeds one page

- **WHEN** the user requests communication beyond its first bounded page
- **THEN** the interface retrieves the indicated continuation and preserves total/outstanding information

#### Scenario: Selection changes during a slow read

- **WHEN** a user selects another task or session before an earlier read finishes
- **THEN** the earlier response does not replace the new selection and closing the viewer releases its observation work

### Requirement: Open resources through one responsive inspector

Chat cards, work discovery and generated UI SHALL navigate to the same task, session, decision, changes or exact artifact selection. Desktop SHALL support viewing evidence beside chat; narrow screens SHALL provide an accessible dismissible viewer. Back/reload/deep links SHALL preserve valid selection. Navigation MUST be read-only and MUST NOT require an agent turn.

#### Scenario: User selects Inspect session

- **WHEN** a user selects a session link from chat or generated UI
- **THEN** the shared viewer opens that retained session's read-only evidence with no submitted prompt or controller transition

#### Scenario: User returns through browser history

- **WHEN** the user drills from a task into a session or artifact and uses Back or reload
- **THEN** the valid prior or current resource selection is restored while chat stays associated with the same Abra session

#### Scenario: Mobile viewer is dismissed

- **WHEN** a user dismisses the narrow-screen viewer with its close action or Escape
- **THEN** focus returns appropriately to the originating control and the chat remains usable without page-wide overflow

### Requirement: Validate navigation and preserve native answer authority

Generated navigation SHALL name only supported typed resource targets resolved against retained ownership. Arbitrary callbacks, controller commands and unsafe links MUST NOT be accepted as navigation. Instructions SHALL use explicit Abra input actions. Human answers and permissions SHALL use current native forms/requests with server binding checks; generated UI MUST NOT create approval authority.

#### Scenario: Generated component targets a foreign session

- **WHEN** a generated link names a session not belonging to its allowed retained work
- **THEN** the selection is refused or shown unavailable without exposing evidence, opening a worker composer or submitting input

#### Scenario: User opens a decision answer

- **WHEN** a user selects Answer on a user-owned decision
- **THEN** the interface opens the corresponding current native form and a reply still requires its observed binding and applicable controller checkpoint

#### Scenario: Saved card references a stale checkpoint

- **WHEN** a card references an approval or decision form that is no longer current
- **THEN** the interface identifies the stale target and cannot authorize the historical checkpoint

### Requirement: Reuse a bounded presentation catalog

Routine cards, generated A2UI and saved snapshot viewing SHALL reuse compatible presentation components. Generated structures SHALL be validated against a closed versioned catalog with bounded size, depth and references. Components SHALL distinguish current data from captured snapshots. Invalid revisions SHALL preserve the last valid view and surface a local diagnostic.

#### Scenario: Abra generates a blocker overview

- **WHEN** Abra publishes a valid composed view of selected work
- **THEN** the view uses captured or current typed evidence as labeled and its inspection links open the same application resources as ordinary cards

#### Scenario: Generated layout is invalid

- **WHEN** a replacement contains a cycle, unknown component, invalid reference or excessive size
- **THEN** publication is rejected without replacing the previous valid revision

### Requirement: Associate presentation with exact producing evidence

Published views and reports SHALL have retained associations to their proven producing native message/tool or completion notice, with exact revision identity. Retries and restart SHALL reconcile existing publication/association rather than duplicating artifacts. A historical report card MUST NOT silently resolve to a newer revision. Missing legacy association evidence SHALL remain explicit.

#### Scenario: Report is regenerated

- **WHEN** a new report revision is published after an earlier report card
- **THEN** the earlier card opens its original frozen revision and the new publication has its own association

#### Scenario: Publication succeeds before attachment persistence

- **WHEN** the service interrupts after artifact publication but before its message association is saved
- **THEN** recovery verifies the retained publication and repairs only the missing association without creating another artifact or replaying a workflow action

#### Scenario: Legacy surface has only its latest revision

- **WHEN** an old saved surface cannot prove an earlier message/revision association
- **THEN** the latest valid legacy view remains reachable with its historical limit stated and no fabricated earlier revision

### Requirement: Match presentation labels to rendered behavior

Tables SHALL expose rows/columns, dependency graphs SHALL use actual dependency references, and timelines SHALL use chronological events/times. A blocker list or latest-progress list SHALL be labeled accordingly. Layouts SHALL remain readable and controls reachable on desktop and narrow screens, with keyboard focus and status text alongside color.

#### Scenario: Data has blockers but no dependency edges

- **WHEN** a generated view contains blocker explanations without dependency identities
- **THEN** it displays a labeled blocker list rather than claiming a dependency graph

#### Scenario: Multiple widgets share a narrow row

- **WHEN** generated cards, metrics and a board render at a 375- or 390-pixel viewport or beside an inspector
- **THEN** rows wrap/stack and oversized board content scrolls within its own container without making later controls unreachable
