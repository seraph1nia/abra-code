# Spec Delta

## MODIFIED Requirements

### Requirement: Supervise several tasks without routine model polling

Native execution, progress, idle and relevant form observations SHALL trigger coalesced reconciliation, with periodic reconciliation covering missed events and reconnects. Routine unchanged state MUST NOT create model turns. Meaningful blockers and completion notices SHALL have durable deduplication identity, preserve unanswered obligations and expose an actionable owner and clearing step. Existing finite diagnostic/repair policies SHALL govern routine reasoning and corrections; automated turns MUST NOT inherit the authority of an explicit user instruction. Silent unchanged operational observations SHALL not wake a model. Related phase changes, findings, completions, prepared deliverables and recovered-worker outcomes SHALL be eligible for one bounded digest with exact retained source identities. Human-owned decisions, unsafe/ambiguous ownership, unrecoverable failures, verification conflicts, required approvals and escalated unanswered requests SHALL retain immediate actionable visibility independently of digest delivery. A digest SHALL NOT resolve its underlying decisions or incidents.

#### Scenario: Several events describe one blocker

- **WHEN** repeated native events and periodic reconciliation observe the same unresolved blocker
- **THEN** one actionable notice remains visible without a new prompt for every event

#### Scenario: Event stream misses task completion

- **WHEN** the completion event is missed or the service restarts
- **THEN** periodic reconciliation observes the retained native outcome and resumes authorized dependent work without inventing completion evidence

#### Scenario: Routine answer is within existing authority

- **WHEN** sufficient retained evidence resolves a supervisor-owned question under finite authorized diagnostic policy
- **THEN** the controller records the answer through the existing decision route and preserves human-owned checkpoints

#### Scenario: One task is blocked

- **WHEN** one task awaits human approval and another unrelated task is eligible
- **THEN** supervision preserves the decision while allowing the independent task to progress within capacity

#### Scenario: Several workers complete in one supervision cycle

- **WHEN** three workers produce routine meaningful outcomes before the next reasoning admission
- **THEN** one bounded digest can reference all three outcomes without three independent supervisor prompts

#### Scenario: Immediate decision arrives alongside routine outcomes

- **WHEN** a human decision and routine completion updates are observed together
- **THEN** the decision remains directly actionable and is not hidden or marked handled by digest coalescing

#### Scenario: Operator returns from unattended operation

- **WHEN** unattended mode retained human decisions and the operator returns to attended mode
- **THEN** unresolved important items surface with their original identities without replaying all historical routine events
