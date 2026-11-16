# Spec Delta

## MODIFIED Requirements

### Requirement: Preserve unresolved decisions in the work surface

The browser work surface and Supervisor tools SHALL expose open questions and their answer owner independently of the latest status message. Browser summaries SHALL show concise typed question/owner/status cards, with answer and disposition history on demand. Decision answers MUST use authorized controller/native-form routes and MUST NOT be inferred from navigation or read-only observer requests.

#### Scenario: Worker update follows a question

- **WHEN** a worker reports progress after opening a question
- **THEN** the ticket still shows the unresolved question and who owes its answer

#### Scenario: Decision is resolved

- **WHEN** a decision is answered, cancelled or superseded
- **THEN** its disposition remains inspectable as history and it no longer appears as an open question merely because the record exists

### Requirement: Present policy-appropriate plans and deliverables

Full-spec tickets SHALL retain browser planning/task views. Research tickets SHALL expose the report and evidence without fictional implementation-task progress. Lightweight tickets SHALL expose their recorded scope and verification/review evidence. Report and revision history SHALL remain accessible after worktree removal and service restart. Archived planning evidence SHALL be read from verified retained archive/commit references when available; unavailable documents SHALL state the reason and preserve other task evidence.

#### Scenario: Research ticket is opened after retirement

- **WHEN** an operator opens a completed research ticket whose worktree is gone
- **THEN** the retained report is readable with its source base, limitations and follow-on links

#### Scenario: Lightweight ticket has no OpenSpec directory

- **WHEN** a lightweight ticket's plan view is opened
- **THEN** it displays accepted scope and approval status without reporting missing full-spec artifacts as a failure

#### Scenario: Completed plan has no readable retained document

- **WHEN** an archived task has no verified accessible planning document
- **THEN** the interface states that availability limit rather than asking the user to select a nonexistent artifact and still exposes the task's retained scope, outcome and reports

### Requirement: Retain native observer behavior

The observer SHALL remain read-only, use the browser workspace's theme/navigation primitives and preserve bounded lazy reads, keyboard navigation and retained snapshots labeled by freshness. New schema/record failures MUST remain visible without making unrelated tickets or historical reports disappear. Expected read errors SHALL preserve other valid views and be distinguished from loss of the service connection. Request-local reuse of observations MUST NOT hide newer committed state from subsequent requests or supply cached authority to a mutating controller action.

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

#### Scenario: Current detail changes within one phase

- **WHEN** a selected worker transcript or decision changes without a workflow phase or control-generation change
- **THEN** committed invalidation or the bounded fallback refreshes the selected evidence without requiring a tab switch or replaying a mutation

### Requirement: Display native running and queued session state

Worker activity SHALL use server-observed native session and pending-prompt state within read-only browser work views. Known queued prompts SHALL remain distinguishable from idle workers, including when a worker is not selected for inspection. Missing or failed synchronization MUST NOT be presented as authoritative idle state, and display data MUST NOT determine controller admission, approval or stop confirmation. Synchronization MUST NOT open a worker conversation or expose a worker composer.

#### Scenario: Worker has a queued prompt

- **WHEN** a managed session has pending native prompt admission but no running provider turn
- **THEN** its work view indicates queued activity rather than presenting it as idle

#### Scenario: Newly discovered worker is off screen

- **WHEN** a new managed session appears while its inspection is not selected
- **THEN** the observer synchronizes its native status and pending state without opening worker tabs or stealing focus from Abra

#### Scenario: Session synchronization fails

- **WHEN** worker status cannot be synchronized
- **THEN** the observer marks the presentation unavailable or stale rather than inferring confirmed worker quiescence

### Requirement: Inspect workers without opening another conversation

AbraCode's browser work surface SHALL expose worker role, native activity, model selection, progress, decisions, reports and available bounded transcript evidence through read-only inspection. Transcript history SHALL be reachable through bounded pagination when retained; tool bodies SHALL expand on demand. Worker selections and worker-related commands SHALL open this inspection rather than a native worker chat composer, and discovery MUST NOT create worker conversation tabs. Conversation navigation SHALL lead to Abra. Missing or retired worker evidence SHALL be labeled unavailable without inventing a transcript, and inspection MUST NOT submit prompts or advance lifecycle state.

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

#### Scenario: More transcript history is retained

- **WHEN** a selected session has visible retained messages beyond the initial inspection page
- **THEN** the user can request earlier bounded pages under the same issue/session ownership checks without opening a worker composer

### Requirement: Delivery tools expose independent evidenced outcomes

Supervisor approval, finish and status tools and browser task detail SHALL expose consistent independent observations for matching human approval, delivery preservation, cleanup and issue closure. Observations SHALL identify their execution generation, delivered-content identity when available, observation time and relevant evidence availability. A recorded approval MUST NOT imply merge completion; a forge-reported merge without verified preservation MUST NOT imply retirement is safe; completed delivery MUST NOT imply issue closure. Busy or stale observations MUST state their limits. Successful classified waits SHALL retain the native success envelope while explicitly identifying what remains incomplete. Rejected authorization, stale content, unsafe ownership, uncertain effects and unexpected defects MUST retain their native failure semantics; available committed stage evidence SHALL remain discoverable with the applicable recovery action.

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

#### Scenario: Compact card precedes full delivery inspection

- **WHEN** a task card summarizes work whose delivery is verified but cleanup remains blocked
- **THEN** its concise state does not claim closure and expanding it reveals the independent approval, delivery, cleanup and closure evidence

### Requirement: Inspect correlated communication without mutation

Authorized management inspection SHALL return bounded message summaries, delivery/acknowledgement distinctions, outstanding requests, source/destination identities, applicable generation, observation time and relevant reply evidence for a work item. It SHALL expose unavailable or uncertain native observations honestly and preserve unresolved requests after worker failure or restart. Browser communication SHALL use compact typed summaries with expandable bodies, reply evidence and disposition history. Native worker inspection SHALL remain read-only, and reads MUST NOT prompt agents, resolve obligations or change lifecycle state. Recovery inspection SHALL preserve required response, admission uncertainty, attempt count and the clearing action.

#### Scenario: Native session is idle with pending inbox work

- **WHEN** a session appears idle while a retained request remains queued
- **THEN** inspection reports queued work rather than presenting the request as answered or the worker as authoritatively quiescent

#### Scenario: Message history exceeds a view bound

- **WHEN** an issue has more messages than one inspection page can display
- **THEN** the response includes bounded results and continuation/total information without silently hiding outstanding obligations

#### Scenario: Reminder is admitted but unanswered

- **WHEN** a recovery prompt is admitted without a correlated answer or required acknowledgement
- **THEN** communication shows the retained attempt and outstanding response without presenting admission or a completed provider turn as a reply

#### Scenario: Worker question already owns a decision

- **WHEN** a retained communication references an existing decision
- **THEN** the interface links to that same obligation and answer owner without creating a second question record

### Requirement: Derive concise aggregate supervision summaries

The browser work surface and Supervisor status route SHALL provide bounded aggregate counts and per-task summaries distinguishing running, pending admission, dependency wait, supervisor decision, human decision, suspected stall, provider failure, validation failure, review failure, delivery/CI wait, unsafe recovery and completed work. These SHALL be projections of existing authoritative phases, native observations, obligations and evidence, with explicit observation time and unknown/stale availability, rather than a separately editable lifecycle. Counts SHALL use a documented mutually exclusive primary classification while preserving additional blockers and exact delivery/cleanup/closure evidence in detail. Fleet and per-repository summaries SHALL distinguish native queued, ready, capacity and dependency waits; completion recency SHALL use retained timestamps with a stated day boundary. Counts and attention coverage SHALL be independent of loaded history pages.

#### Scenario: Abra summarizes several tasks

- **WHEN** some tasks run, another waits for a plan decision and another has retained research findings
- **THEN** the summary identifies counts, meaningful blockers and deliverables with links to evidence without opening every worker conversation

#### Scenario: Evidence is unavailable

- **WHEN** a native observation fails while retained obligations are readable
- **THEN** the summary preserves the obligations and labels native activity unavailable without guessing successful completion or idle state

#### Scenario: Closed-history page changes

- **WHEN** the user requests another page of closed work
- **THEN** aggregate totals and completed-today counts remain based on retained state rather than the visible page

#### Scenario: Attention exists beyond loaded work

- **WHEN** an unanswered request, user decision, failure or configured lead proposal belongs outside the loaded finder page
- **THEN** attention navigation exposes it within declared coverage or clearly reports truncation/unavailability

## ADDED Requirements

### Requirement: Derive actionable attention from unresolved evidence

Browser attention SHALL derive from current human/supervisor decisions, required approvals, unresolved communication, expired/invalid waits, actionable failures and recovery/cleanup blockers. Handled/superseded incidents alone MUST NOT qualify. Each item SHALL identify its owner and next action; dependency/capacity waits SHALL remain distinguishable from human input.

#### Scenario: Plan approval has no separate incident

- **WHEN** a task is awaiting current plan approval but has no decision or attention incident array entry
- **THEN** the user can discover the approval requirement through attention

#### Scenario: Only a handled incident remains

- **WHEN** a task has no actionable obligation or failure and retains only handled/superseded attention incidents
- **THEN** the task does not appear as requiring attention because of those historical records

### Requirement: Discover all work through bounded pages

Work discovery SHALL support repository/state filters, title/ID search and bounded open/closed history with total and continuation information. Search SHALL cover the eligible retained work rather than only loaded browser rows. Active/open work MUST NOT be labeled as proof of native execution. A direct task selection SHALL remain inspectable outside the loaded page.

#### Scenario: More than fifty tasks are closed

- **WHEN** closed work exceeds one finder page
- **THEN** the user can reach subsequent pages and locate matching retained work through search without an agent turn

#### Scenario: Task is selected by a report link

- **WHEN** an artifact links to a retained task outside the current finder page or repository filter
- **THEN** the task can open directly without requiring the user to locate its list page

### Requirement: Present typed review and check summaries

Review/check inspection SHALL show concise typed findings, blocking state, disposition and check outcomes with source/head and observation context. Full evidence, external-validation details and action/history pages SHALL be available on demand. Missing or stale evidence MUST remain explicit and MUST NOT be replaced with an inferred successful result.

#### Scenario: Feedback includes blocking and informational findings

- **WHEN** a task has both blocking and informational PR feedback
- **THEN** the interface distinguishes them and allows expanding their evidence/dispositions without displaying raw records by default

### Requirement: Inspect scoped management evidence

When project leads are configured, browser inspection SHALL expose repository scope, enabled/stopped/recovery state, native availability, outstanding requests, pending proposals and related work. Historical requests SHALL remain distinguishable after disable or scope change. Inspection SHALL preserve current authorization boundaries and route conversational actions through Abra.

#### Scenario: Configured lead has a pending proposal

- **WHEN** an enabled lead has an unanswered request or retained proposal
- **THEN** compact attention/activity inspection exposes it and its related work without raw record browsing or a new management action

#### Scenario: Lead has been disabled

- **WHEN** a lead is disabled with retained request history
- **THEN** the interface shows its disabled state and preserves authorized historical inspection without implying active management

### Requirement: Retire custom terminal work presentation

AbraCode SHALL cease registering its custom terminal sidebar, footer, work panel/route and work-inspection commands. Supported browser inspection SHALL preserve the relevant evidence/navigation behaviors. Native controller/RPC observation, sessions, forms and operational CLI commands SHALL remain available independently of custom terminal rendering.

#### Scenario: Native terminal attaches after upgrade

- **WHEN** the operator uses the supported native attach command
- **THEN** Abra remains accessible without loading AbraCode's removed custom work UI or requiring its renderer dependencies

#### Scenario: Browser observes after terminal removal

- **WHEN** custom terminal presentation has been removed
- **THEN** browser work/session/report reads and committed invalidation continue using their shared backend services

## REMOVED Requirements

### Requirement: Panel navigation participates in native keymaps

**Reason**: AbraCode's custom terminal panel and its command registrations are removed.
**Migration**: Use the browser workspace's shared inspector, browser history and accessible keyboard/focus behavior. Preserve request cancellation and stale-selection protection in the browser; operational native attach/auth/service commands remain available.
