# Spec Delta

## ADDED Requirements

### Requirement: Stream live conversation and activity references natively

The workspace SHALL stream assistant text and tool-call output incrementally through the native conversation message stream without waiting for polling or turn completion, and SHALL exclude duplicated transcript arrays from workspace metadata state. Generated views, interactive reviews and saved artifacts SHALL attach to messages as lightweight activity references whose full payloads remain lazily fetched and ownership-verified.

#### Scenario: Assistant streams text and tool input

- **WHEN** the central agent emits incremental text or tool-input deltas during an active turn
- **THEN** the workspace renders the incremental output live without waiting for turn completion or a periodic fallback read

#### Scenario: Surface or review attaches to a conversation turn

- **WHEN** a turn produces a generated view, interactive review or saved report
- **THEN** the stream delivers a lightweight activity reference bound to the producing message and revision, and opening it fetches the verified payload lazily

### Requirement: Render generated views with one v1.0 catalog in place

Generated views SHALL use one canonical A2UI v1.0 catalog derived from the upstream basic catalog, rejecting historical v1–v4 catalog identifiers and custom prefixed wire keys. Updating an existing surface revision SHALL apply component and data updates in place without discarding client control state, and live work updates SHALL refresh bound widgets without re-rendering unrelated surface content.

#### Scenario: Surface revision updates an active view

- **WHEN** a new revision is published for an already mounted surface identifier
- **THEN** the view updates in place and preserves unrelated local input and disclosure state

#### Scenario: Historical v1–v4 catalog identifier is supplied

- **WHEN** a surface publication references a retired v1–v4 catalog identifier or custom prefixed wire key
- **THEN** validation rejects the unsupported catalog instead of normalizing it through a legacy adapter

### Requirement: Render view text and external media safely

Generated view Markdown SHALL render CommonMark without corrupting underscored code identifiers or injecting raw HTML. Media components and link-opening actions SHALL reject relative URLs, credentials and disallowed schemes before issuing requests or opening windows.

#### Scenario: Markdown contains code identifiers

- **WHEN** generated view text contains underscored identifiers such as `abra_render_ui` or `issue_id`
- **THEN** the rendered text preserves the literal underscores without converting segments into emphasis

#### Scenario: Generated view supplies a relative media or link URL

- **WHEN** a generated view supplies a relative path or non-HTTP(S) URL for media or link opening
- **THEN** the renderer rejects the relative or disallowed URL before issuing a request or opening a window

### Requirement: Render interactive reviews with native v1.0 controls

Interactive reviews SHALL compose standard A2UI v1.0 input and validation controls for single-select, multi-select and text comments alongside design-preview choice groups, using two-way data-model bindings and the active workspace theme tokens. Review reads and submissions SHALL validate only current revisioned review records without scanning unrelated reviews under a write lock.

#### Scenario: Operator completes a review with validation checks

- **WHEN** an operator edits answers in an interactive review and submits
- **THEN** native v1.0 data bindings and validation checks reflect answer state, inherit the active theme and submit without scanning unrelated review records under the review write lock

### Requirement: Apply ordered live updates against a valid baseline

Live workspace updates SHALL identify their observation epoch, order and relevant source revisions, rejecting observations that omit required ordering metadata. A client SHALL apply an incremental update only to its matching baseline. Duplicate, out-of-order, foreign-session or gapped updates MUST NOT replace newer valid data, and high-frequency text or tool deltas MUST NOT evict state snapshots from observation delivery.

#### Scenario: Incremental update follows bootstrap

- **WHEN** a valid update follows the established baseline in the same session and epoch
- **THEN** changed state is applied while native message and tool identities, visible ordering and unchanged evidence are preserved

#### Scenario: Delta arrives with a gap

- **WHEN** an incremental update has no matching baseline or skips a required sequence
- **THEN** it is not applied and the observer obtains a full baseline while labeling the retained observation appropriately

#### Scenario: Older connection emits after restart

- **WHEN** an old connection sends an update after a new observer epoch has been established
- **THEN** it cannot supersede that new epoch's state even if its timestamp appears newer

#### Scenario: Streaming token burst overlaps a state snapshot

- **WHEN** rapid text or tool deltas arrive alongside a workspace state update
- **THEN** the state snapshot is delivered intact without triggering a spurious sequence gap or forced bootstrap reload

## MODIFIED Requirements

### Requirement: Retain native observer behavior

The observer SHALL remain read-only, use host theme/navigation primitives and preserve bounded lazy reads, keyboard navigation and retained offline snapshots. New schema/record failures MUST remain visible without making unrelated tickets or historical reports disappear. Expected read errors SHALL preserve other valid views and be distinguished from loss of the service connection. Request-local reuse of observations MUST NOT hide newer committed state from subsequent requests or supply cached authority to a mutating controller action. Stale or inactive native forms SHALL remain visible for reconciliation even when zero active attention items exist, switching browser tabs MUST NOT unmount mounted inbox views, and root and route error boundaries SHALL present recoverable diagnostics instead of blank screens.

#### Scenario: Disconnected observer has pending decisions

- **WHEN** the observer loses its connection
- **THEN** it keeps the last snapshot, marks freshness unavailable and does not imply that cached approval or progress information is current

#### Scenario: One record cannot be decoded

- **WHEN** a ticket contains an unsupported durable record
- **THEN** the observer shows its diagnostic while valid tickets and navigation continue to work

#### Scenario: One document read is unavailable

- **WHEN** a declared unavailable-resource error is returned for a selected planning document
- **THEN** the ticket snapshot and other valid views remain usable without claiming that the native service is disconnected

#### Scenario: Later read observes a new commit to work state

- **WHEN** a decision or execution changes after an observer request finishes
- **THEN** a subsequent observer request reads the newer committed state rather than reusing a previous request's cached authorization or readiness evidence

#### Scenario: Only stale forms remain in attention

- **WHEN** the workspace has no active forms or permissions but retains an inactive stale form
- **THEN** the attention view still displays the stale form and its reconciliation notice instead of an empty state

#### Scenario: User switches browser tabs while inspecting the inbox

- **WHEN** the browser tab becomes hidden and later visible again while an inbox list or item sheet is open
- **THEN** the inbox preserves its mounted view and open selection without unmounting on tab hide

#### Scenario: Lazy capability or route fails during rendering

- **WHEN** a route or lazily loaded interface module throws during load or render
- **THEN** an error boundary displays an actionable recovery state instead of a blank screen

### Requirement: Refresh resources according to changed evidence

Observation SHALL distinguish affected task, transcript, form, admission, presentation, fleet and aggregate resources. It SHALL coalesce bursts and refresh affected mounted reads, including selected resources outside loaded lists. Unchanged fallback observations and freshness-only updates MUST NOT invalidate all work queries, broad change hints SHALL retain safe broad-refresh fallback, and background fallback polling SHALL pause when no observer clients are connected.

#### Scenario: One off-page task changes

- **WHEN** evidence changes for a selected task outside the current finder and bootstrap rows
- **THEN** that task's affected mounted evidence refreshes without refetching unrelated task documents or transcripts

#### Scenario: Workspace remains unchanged

- **WHEN** repeated fallback observations contain no semantic changes
- **THEN** freshness can update without repeated full transcript emissions or redundant mounted resource fetches

#### Scenario: Old invalidation omits affected identities

- **WHEN** an invalidation provides no narrower change scope
- **THEN** the observer uses bounded broad recovery and retains correctness without assuming that no work changed

#### Scenario: Review submission or fleet change occurs

- **WHEN** an observation signals changed presentations, admissions or fleet totals
- **THEN** mounted review and finder queries invalidate and refresh without waiting for an unrelated task mutation

#### Scenario: No browser clients are connected

- **WHEN** all workspace observers disconnect from the local server
- **THEN** the periodic fallback observation timer pauses until a client reconnects

## REMOVED Requirements

### Requirement: Apply ordered updates against a valid baseline

**Reason**: Replaced by `Apply ordered live updates against a valid baseline`, which drops unordered legacy observation compatibility and protects state snapshots from streaming bursts.
**Migration**: All workspace observations carry required epoch and sequence metadata; restart with a current runtime.
