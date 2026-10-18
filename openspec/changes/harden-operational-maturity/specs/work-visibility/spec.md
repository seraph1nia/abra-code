# Spec Delta

## MODIFIED Requirements

### Requirement: Inspect correlated communication without mutation

Authorized management inspection SHALL return bounded message summaries, delivery/acknowledgement distinctions, outstanding requests, source/destination identities, applicable generation, observation time and relevant reply evidence for a work item. It SHALL expose unavailable or uncertain native observations honestly and preserve unresolved requests after worker failure or restart. Native issue detail SHALL provide a compact communication section and expandable bounded message bodies with sender, recipient, kind, timestamp, request identity, status, reply summary and evidence links. Full retained history SHALL remain reachable through pagination. Recovery inspection SHALL identify the original required response, attempt zero or one of one, admission status, last verified native state/time, uncertainty and escalation/clearing action. Native admission MUST NOT be labeled read or acknowledged. Native worker inspection SHALL remain read-only, and reads MUST NOT prompt agents, resolve obligations or change lifecycle state.

#### Scenario: Native session is idle with pending inbox work

- **WHEN** a session appears idle while a retained request remains queued
- **THEN** inspection reports queued work rather than presenting the request as answered or the worker as authoritatively quiescent

#### Scenario: Message history exceeds a view bound

- **WHEN** an issue has more messages than one inspection page can display
- **THEN** the response includes bounded results and continuation/total information without silently hiding outstanding obligations

#### Scenario: Reminder is admitted but unanswered

- **WHEN** a recovery prompt is admitted without a correlated response
- **THEN** communication shows attempt one of one and the outstanding response rather than resolved recovery

#### Scenario: Worker asks for input

- **WHEN** a worker question is already retained as a decision
- **THEN** issue detail shows that same question, owning issue/role, answer owner, progress impact and authorized next action without a second question record

### Requirement: Derive concise aggregate supervision summaries

The existing work surface and Supervisor status route SHALL provide bounded aggregate counts and per-task summaries distinguishing running, pending admission, dependency wait, supervisor decision, human decision, suspected stall, provider failure, validation failure, review failure, delivery/CI wait, unsafe recovery and completed work. These SHALL be projections of existing authoritative phases, native observations, obligations and evidence, with explicit observation time and unknown/stale availability, rather than a separately editable lifecycle. Counts SHALL use a documented mutually exclusive primary classification while preserving additional blockers and exact delivery/cleanup/closure evidence in detail. Native Work home SHALL expose compact fleet and per-repository running, queued and attention counts, distinguish native queued work from ready work waiting for capacity, and provide attention-first navigation to human decisions, unanswered requests, failures, stalls, recovery, delivery approval and lead proposals. Completed-today counts SHALL use retained completion/closure timestamps with a stated day boundary, never infer recency from the loaded closed-history page. Aggregate coverage and truncation SHALL be explicit and independent of visible ticket pagination.

#### Scenario: Abra summarizes several tasks

- **WHEN** some tasks run, another waits for a plan decision and another has retained research findings
- **THEN** the summary identifies counts, meaningful blockers and deliverables with links to evidence without opening every worker conversation

#### Scenario: Evidence is unavailable

- **WHEN** a native observation fails while retained obligations are readable
- **THEN** the summary preserves the obligations and labels native activity unavailable without guessing successful completion or idle state

#### Scenario: Fleet mixes running queued and dependency-blocked work

- **WHEN** Work home contains running sessions, native queued prompts, capacity waits and unresolved dependencies
- **THEN** the compact summary and per-project grouping distinguish these states and each waiting task names its reason

#### Scenario: Closed-history page changes

- **WHEN** the user navigates between pages of closed tickets
- **THEN** fleet totals and completed-today values do not change merely because a different history page is displayed

#### Scenario: Attention exists outside the visible page

- **WHEN** an unanswered request or lead proposal belongs to work outside the current loaded ticket page
- **THEN** attention navigation still exposes it within declared coverage or explicitly reports a truncated/unavailable aggregate

## ADDED Requirements

### Requirement: Inspect scoped project leads in native Work

Native Work SHALL expose registered leads with repository scope, enabled/stopped/recovery state, native session availability, outstanding requests, pending proposals and the latest meaningful retained outcome. Navigation SHALL connect a lead to its assigned work and read-only session/evidence inspection. It SHALL distinguish enabled management from historical requests after disable or scope revision. Existing evidence inspection remains available; additional report/PR shortcuts are deferred. All conversational decisions SHALL return to Abra; human-owned actions SHALL use existing native forms and authenticated controller routes.

#### Scenario: Lead has pending work

- **WHEN** a registered lead has an unanswered request, a proposal and several assigned tasks
- **THEN** Work exposes those items with direct scoped navigation without raw controller-record inspection

#### Scenario: Lead is disabled

- **WHEN** an existing lead is disabled after work was assigned
- **THEN** the lead view exposes its disabled status while preserving scoped controller-owned work and historical requests
