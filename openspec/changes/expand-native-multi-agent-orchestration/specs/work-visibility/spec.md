# Spec Delta

## ADDED Requirements

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
