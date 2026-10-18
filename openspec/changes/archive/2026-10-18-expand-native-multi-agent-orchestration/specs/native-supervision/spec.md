# Spec Delta

## MODIFIED Requirements

### Requirement: Managed worker prompts require retained controller admission

New prompts directed at assigned or historical managed worker sessions SHALL be admitted only when bound to an eligible retained controller prompt intent, session, role and execution generation. The initial assignment and every subsequent queued or steering instruction SHALL have their own immutable prompt identity and retained exact content. Direct foreground messages and unowned queued or steering prompts SHALL be refused with guidance to use Abra before new worker model work begins. Client-supplied labels or delivery choice alone MUST NOT establish ownership. Native replay evidence for an already admitted owned prompt SHALL retain its existing identity and uncertainty semantics; rejecting a direct message MUST NOT stop or replace an independently valid owned turn. New admission SHALL be refused for stale generations, paused, superseded or inactive assignments, and reused message IDs MUST NOT authorize changed content or attachments.

#### Scenario: User opens a native worker conversation directly

- **WHEN** a new foreground prompt targets a managed worker session without an eligible controller intent
- **THEN** the request is refused and directs the user to Abra without starting worker work

#### Scenario: Caller queues an arbitrary worker prompt

- **WHEN** a queued prompt has no matching retained controller admission identity
- **THEN** queue delivery and supplied metadata do not authorize it

#### Scenario: Controller submits an eligible worker prompt

- **WHEN** the controller has retained the matching current assignment, prompt intent and context
- **THEN** native worker admission proceeds under the existing capability, policy and execution gates

#### Scenario: Owned submission is recovered after response loss

- **WHEN** native inbox/transcript evidence already contains the controller's retained prompt
- **THEN** recovery recognizes that admission without issuing a second prompt or interpreting it as a user conversation

#### Scenario: Authorized steering has a distinct identity

- **WHEN** the controller persists a new eligible steering intent for the current worker
- **THEN** that instruction passes the native prompt guard with its own identity while the original assignment identity and permissions remain intact

#### Scenario: Direct steering claims controller provenance

- **WHEN** a caller steers a worker using controller-like metadata without matching retained intent
- **THEN** admission is rejected before provider work begins

#### Scenario: Prompt identity is rebound

- **WHEN** a caller reuses an owned message ID with changed text, attachments or another session
- **THEN** controller tools refuse conflicting input; native replay may return the immutable original before the prompt hook, but changed content is never admitted, and another session cannot adopt that identity

#### Scenario: Assignment changes before consumption

- **WHEN** a queued instruction belongs to a paused or superseded generation
- **THEN** it cannot start new authorized worker work and native queued state is reconciled without assuming cancellation undid consumed work

## ADDED Requirements

### Requirement: Supervise several tasks without routine model polling

Native execution, progress, idle and relevant form observations SHALL trigger coalesced reconciliation, with periodic reconciliation covering missed events and reconnects. Routine unchanged state MUST NOT create model turns. Meaningful blockers and completion notices SHALL have durable deduplication identity, preserve unanswered obligations and expose an actionable owner and clearing step. Existing finite diagnostic/repair policies SHALL govern routine reasoning and corrections; automated turns MUST NOT inherit the authority of an explicit user instruction.

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
