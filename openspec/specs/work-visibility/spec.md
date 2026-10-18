# work-visibility Specification

## Purpose

Make execution outcomes, actionable decisions and preserved deliverables understandable through OpenCrew's existing native ticket views and management tools.

## Requirements

### Requirement: Present waits and next actions explicitly

Ticket views and status tools SHALL distinguish workflow phase, worker activity, external operation, routine wait, actionable failure and unsafe recovery. Each blocker SHALL expose its owner or dependency, relevant evidence and the next clearing action. Normal CI/review waits and contended approval/finish observations MUST NOT appear as recovery failures. A delivery awaiting external confirmation SHALL be labeled unconfirmed or in progress rather than definitively unmerged. A preserved delivery with ordinary cleanup blockers SHALL identify the remaining retirement action separately from the delivered result.

#### Scenario: Ticket awaits CI

- **WHEN** a delivered ticket is waiting on a named check
- **THEN** the operator sees the check reason and next observation rather than a generic recovery-required label

#### Scenario: Execution has stale ownership evidence

- **WHEN** mutation is stopped because the owned identity cannot be verified
- **THEN** the ticket remains visible under attention with the identity conflict and a recovery action

#### Scenario: Merged delivery awaits file disposition

- **WHEN** a PR delivery receipt proves preservation and ordinary files block retirement
- **THEN** the view identifies delivery as verified, cleanup as blocked with retained path evidence and next action, and issue closure as pending

### Requirement: Preserve unresolved decisions in the work surface

The existing native work home, ticket detail and Supervisor tools SHALL expose open questions and their answer owner independently of the latest status message. Decision answers MUST use authorized controller/native-form routes and MUST NOT be inferred from navigation or read-only observer requests.

#### Scenario: Worker update follows a question

- **WHEN** a worker reports progress after opening a question
- **THEN** the ticket still shows the unresolved question and who owes its answer

### Requirement: Present policy-appropriate plans and deliverables

Full-spec tickets SHALL retain native planning/task views. Research tickets SHALL expose the report and evidence without fictional implementation-task progress. Lightweight tickets SHALL expose their recorded scope and verification/review evidence. Report and revision history SHALL remain accessible after worktree removal and service restart.

#### Scenario: Research ticket is opened after retirement

- **WHEN** an operator opens a completed research ticket whose worktree is gone
- **THEN** the retained report is readable with its source base, limitations and follow-on links

#### Scenario: Lightweight ticket has no OpenSpec directory

- **WHEN** a lightweight ticket's plan view is opened
- **THEN** it displays accepted scope and approval status without reporting missing full-spec artifacts as a failure

### Requirement: Explain compute and resource capacity separately

Readiness and operator views SHALL distinguish active-worker limits, role limits, retained-resource limits and dependency blocks. Releasing active capacity MUST NOT make the UI imply that an issue claim or preserved resource was released.

#### Scenario: Worker capacity is available but retained limit is full

- **WHEN** all worker turns are idle and the retained-execution limit is reached
- **THEN** queued work displays the retained-resource blocker and the executions consuming it

### Requirement: Retain native observer behavior

The observer SHALL remain read-only, use host theme/navigation primitives and preserve bounded lazy reads, keyboard navigation and retained offline snapshots. New schema/record failures MUST remain visible without making unrelated tickets or historical reports disappear. Expected read errors SHALL preserve other valid views and be distinguished from loss of the service connection. Request-local reuse of observations MUST NOT hide newer committed state from subsequent requests or supply cached authority to a mutating controller action.

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

### Requirement: Refresh committed work through native invalidations

The observer SHALL react to native invalidations for committed work changes in its OpenCrew home, including decision, report, registration and execution changes that need not produce a session-execution event. Invalidations SHALL be emitted only after the relevant durable commit, coalesced for bounded refresh and scoped to the correct home/locations. They SHALL carry no mutation authority. Subscription loss, missed events or event-publication failure MUST remain recoverable through periodic reads and refresh after subscription/reconnection.

#### Scenario: Decision changes without worker activity

- **WHEN** a retained decision is resolved without a new worker execution event
- **THEN** the work view refreshes from committed data through the native invalidation path

#### Scenario: Unrelated home emits an event

- **WHEN** the client receives a work invalidation belonging to another OpenCrew home
- **THEN** the event does not select, mutate or refresh work for the current home

#### Scenario: Observer misses a notification

- **WHEN** the event subscription ends or a commit's notification is lost
- **THEN** periodic observation and refresh after reconnection eventually present the committed change without replaying a lifecycle action

#### Scenario: Publication fails after a durable mutation

- **WHEN** the durable action succeeds but its invalidation cannot be published
- **THEN** the action remains committed and is not reported as an uncommitted mutation that must be repeated solely because notification failed

### Requirement: Display native running and queued session state

Worker activity SHALL use the host's synchronized native session and pending-prompt state within read-only work views. Known queued prompts SHALL remain distinguishable from idle workers, including when a worker is not selected for inspection. Missing or failed synchronization MUST NOT be presented as authoritative idle state, and display data MUST NOT determine controller admission, approval or stop confirmation. Synchronization MUST NOT open a worker conversation or expose a worker composer.

#### Scenario: Worker has a queued prompt

- **WHEN** a managed session has pending native prompt admission but no running provider turn
- **THEN** its work view indicates queued activity rather than presenting it as idle

#### Scenario: Newly discovered worker is off screen

- **WHEN** a new managed session appears while its inspection is not selected
- **THEN** the observer synchronizes its native status and pending state without opening worker tabs or stealing focus from Abra

#### Scenario: Session synchronization fails

- **WHEN** worker status cannot be synchronized
- **THEN** the observer marks the presentation unavailable or stale rather than inferring confirmed worker quiescence

### Requirement: Panel navigation participates in native keymaps

Work-panel navigation SHALL use named host keyboard commands with the appropriate panel focus and input-mode scope. Shortcut help SHALL reflect the active native bindings, including user remapping. Panel commands MUST NOT consume ordinary prompt-editor or dialog input, and disposing the panel/plugin SHALL remove its commands and in-flight view work.

#### Scenario: Navigation shortcut is remapped

- **WHEN** the user changes a work-panel navigation binding
- **THEN** dispatch and displayed shortcut help follow the native remapping rather than a hardcoded shortcut

#### Scenario: User types in an editor or dialog

- **WHEN** a text editor or nested dialog owns input focus
- **THEN** panel Home/Back navigation does not intercept its ordinary input

#### Scenario: Panel is disposed during a read

- **WHEN** the panel/plugin is disposed while a detail or diff read is pending
- **THEN** its scoped requests and command registrations are released and a late response does not overwrite another selection or a disposed view

### Requirement: Inspect workers without opening another conversation

AbraCode's work surface SHALL expose worker role, native activity, model selection, progress, decisions, reports and available bounded transcript evidence through read-only inspection. Worker selections and worker-related commands SHALL open this inspection rather than a native worker chat composer, and discovery MUST NOT create worker conversation tabs. Conversation navigation SHALL lead to Abra. Missing or retired worker evidence SHALL be labeled unavailable without inventing a transcript, and inspection MUST NOT submit prompts or advance lifecycle state.

#### Scenario: User selects a worker

- **WHEN** the user selects a worker from a ticket or worker command
- **THEN** the interface opens read-only worker inspection and preserves Abra as the conversational entry point

#### Scenario: New worker is discovered

- **WHEN** a refresh discovers a newly created managed worker session
- **THEN** activity is synchronized without opening or focusing a worker conversation tab

#### Scenario: Transcript is unavailable

- **WHEN** selected worker evidence cannot be loaded or was not retained
- **THEN** inspection labels its availability and keeps other ticket information usable

#### Scenario: User needs to give new instructions

- **WHEN** the user follows the conversation action from a worker inspection
- **THEN** navigation opens Abra and no input is forwarded to the worker as an observer side effect

### Requirement: Delivery tools expose independent evidenced outcomes

Supervisor approval, finish and status tools and native ticket detail SHALL expose consistent independent observations for matching human approval, delivery preservation, cleanup and issue closure. Observations SHALL identify their execution generation, delivered-content identity when available, observation time and relevant evidence availability. A recorded approval MUST NOT imply merge completion; a forge-reported merge without verified preservation MUST NOT imply retirement is safe; completed delivery MUST NOT imply issue closure. Busy or stale observations MUST state their limits. Successful classified waits SHALL retain the native success envelope while explicitly identifying what remains incomplete. Rejected authorization, stale content, unsafe ownership, uncertain effects and unexpected defects MUST retain their native failure semantics; available committed stage evidence SHALL remain discoverable with the applicable recovery action.

#### Scenario: Approval succeeds before automatic delivery

- **WHEN** merge approval collection returns a persisted matching approval and delivery has not yet been confirmed
- **THEN** the response reports approval recorded and delivery unconfirmed or waiting with a next observation, without claiming that finalization failed or completed

#### Scenario: Merge succeeds and cleanup is blocked

- **WHEN** finish verifies a merge and subsequently finds ordinary unapproved ignored files
- **THEN** its successful classified outcome reports delivery verified, cleanup blocked and closure pending, with the same retained diagnostics available through status and ticket detail

#### Scenario: A native retirement failure follows verified delivery

- **WHEN** retirement fails for an unsafe identity or native removal error after preservation was committed
- **THEN** the native tool remains failed with its actual code and recovery guidance, and the retained delivery evidence stays visible without requiring another merge

#### Scenario: The service restarts between stage transitions

- **WHEN** a status or ticket read occurs after restart with approval and delivery receipts retained but retirement incomplete
- **THEN** the independent outcomes are reconstructed from committed evidence rather than treating the latest tool error or conversation text as the delivery outcome

#### Scenario: A status observation becomes stale

- **WHEN** delivery advances after a previous status response or the service becomes unavailable
- **THEN** subsequent available reads use newer committed evidence and cached views identify their age or unavailable freshness instead of repeating an authoritative awaiting-merge claim

#### Scenario: Preserved branch or research report has no PR merge

- **WHEN** the execution uses branch delivery or a research-only report receipt
- **THEN** its outcome describes the applicable preservation evidence without inventing a GitHub merge or human merge approval

### Requirement: Inspect correlated communication without mutation

Authorized management inspection SHALL return bounded message summaries, delivery/acknowledgement distinctions, outstanding requests, source/destination identities, applicable generation, observation time and relevant reply evidence for a work item. It SHALL expose unavailable or uncertain native observations honestly and preserve unresolved requests after worker failure or restart. Native worker inspection SHALL remain read-only, and reads MUST NOT prompt agents, resolve obligations or change lifecycle state.

#### Scenario: Native session is idle with pending inbox work

- **WHEN** a session appears idle while a retained request remains queued
- **THEN** inspection reports queued work rather than presenting the request as answered or the worker as authoritatively quiescent

#### Scenario: Message history exceeds a view bound

- **WHEN** an issue has more messages than one inspection page can display
- **THEN** the response includes bounded results and continuation/total information without silently hiding outstanding obligations

### Requirement: Derive concise aggregate supervision summaries

The existing work surface and Supervisor status route SHALL provide bounded aggregate counts and per-task summaries distinguishing running, pending admission, dependency wait, supervisor decision, human decision, suspected stall, provider failure, validation failure, review failure, delivery/CI wait, unsafe recovery and completed work. These SHALL be projections of existing authoritative phases, native observations, obligations and evidence, with explicit observation time and unknown/stale availability, rather than a separately editable lifecycle. Counts SHALL use a documented mutually exclusive primary classification while preserving additional blockers and exact delivery/cleanup/closure evidence in detail.

#### Scenario: Abra summarizes several tasks

- **WHEN** some tasks run, another waits for a plan decision and another has retained research findings
- **THEN** the summary identifies counts, meaningful blockers and deliverables with links to evidence without opening every worker conversation

#### Scenario: Evidence is unavailable

- **WHEN** a native observation fails while retained obligations are readable
- **THEN** the summary preserves the obligations and labels native activity unavailable without guessing successful completion or idle state
