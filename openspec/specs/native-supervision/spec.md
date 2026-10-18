# native-supervision Specification

## Purpose

Preserve unanswered obligations and direct supervisory attention to work that needs reasoning while keeping routine coordination deterministic and quiet.

## Requirements

### Requirement: Questions have durable identity and an answer owner

An assigned worker SHALL be able to report a structured question with a stable key, execution generation, affected scope and answer owner. Open questions SHALL survive restart and unrelated messages until explicitly answered, cancelled or superseded. Workers MUST NOT authorize their own plan, merge, delivery or resource removal through this mechanism.

#### Scenario: Question survives a later status update

- **WHEN** a worker opens a question and later reports unrelated progress
- **THEN** the question remains open and visible with its owner and clearing action

#### Scenario: Duplicate question delivery

- **WHEN** the same worker retries the same keyed question after an uncertain response
- **THEN** the system returns the existing question rather than opening another obligation

#### Scenario: Worker asks to bypass a checkpoint

- **WHEN** a worker requests that a question answer substitute for required plan or merge approval
- **THEN** the controller continues to require the matching human authorization receipt

### Requirement: Declared waits are explicit and rechecked

The system SHALL retain the condition, owner, start time, optional bounded expiry and clearing action for a declared wait. Known approval and command waits SHALL use the same observable vocabulary. Expired or invalid waits MUST return to inspection rather than suppressing attention indefinitely.

#### Scenario: Worker declares a dependency wait

- **WHEN** an assigned worker reports waiting on a named dependency with a clearing condition
- **THEN** supervision records the wait and uses its bounded recheck cadence instead of classifying silence as immediate failure

#### Scenario: Wait expires without progress

- **WHEN** the declared deadline passes and no clearing evidence exists
- **THEN** supervision surfaces a new incident with the unresolved condition and current owner

### Requirement: Progress is distinct from busy state

Supervision SHALL evaluate native worker activity, explicit progress, running operations and declared waits separately. Repeated polling or a persistent busy flag MUST NOT reset the age of last meaningful progress. Suspected stalls SHALL produce bounded, deduplicated attention with evidence and MUST NOT by themselves authorize interruption, replacement or deletion.

#### Scenario: Busy worker stops advancing

- **WHEN** a worker remains busy beyond its configured progress threshold with no applicable declared wait or meaningful progress
- **THEN** the system creates a suspected-stall incident identifying the last progress and active operation

#### Scenario: Legitimate long operation remains declared

- **WHEN** a worker is waiting on an owned check that is still within its configured deadline
- **THEN** supervision presents the command wait and does not automatically kill the worker because chat output is quiet

### Requirement: Deliver actionable attention durably through native sessions

Attention requiring reasoning SHALL be persisted before admitting a Supervisor prompt and deduplicated by execution, incident generation and delivery identity. Restart recovery SHALL reuse the original admission identity. Delivery and handling MUST remain separate: an admitted prompt is not proof of a resolved incident. Routine successful polls and unchanged status MUST NOT create Supervisor model turns.

#### Scenario: Service dies after prompt admission

- **WHEN** attention reaches the Supervisor but the service dies before recording admission success
- **THEN** recovery reuses the retained prompt identity and does not create a second independent message for the incident

#### Scenario: Supervisor has not acted on admitted attention

- **WHEN** a prompt was admitted but no matching action or disposition was retained
- **THEN** the incident remains open and visible without repeatedly admitting fresh prompts

### Requirement: Autonomous corrective work is scoped and bounded

Corrective action SHALL follow an explicit per-execution policy with a finite turn/round budget. Defaults MUST preserve existing approval requirements and disable automatic repair unless configured. Changes outside the accepted scope, missing authorization, exhausted budgets and uncertain ownership MUST return control to the user with retained evidence. Model or provider substitution MUST remain explicitly configured.

#### Scenario: Repair budget is exhausted

- **WHEN** configured corrective rounds are consumed without successful verification
- **THEN** the system retains the execution and findings, stops automatic retries and presents a concrete next decision

#### Scenario: Proposed repair changes approved scope

- **WHEN** a proposed corrective action changes accepted requirements or constraints
- **THEN** execution requests revised planning authorization rather than treating the incident as standing permission

#### Scenario: User intentionally pauses work

- **WHEN** a user pauses an execution with unresolved attention
- **THEN** supervisory delivery does not restart the worker and the pause remains effective until explicitly resumed

### Requirement: Validate worker selection at its native location

Before admitting a new worker prompt, the system SHALL resolve its configured or inherited agent and model against the native inventory at the assigned worktree location, validate model tool capability and required skills, and reject required tools outside its authoritative role policy. Actual required tool availability SHALL additionally be checked against the effective tools before the worker's provider request. A missing selection, unavailable skill or incompatible capability SHALL produce an actionable location-specific configuration blocker without silently substituting an agent, model, provider or skill or widening permissions. If inventory is unavailable, admission SHALL retain its intent and identity for a later explicit or ordinary eligible recovery rather than optimistically submitting the prompt. Recovery of an already admitted prompt SHALL observe native inbox/transcript evidence before treating current inventory drift as a reason to submit again; request-time authorization SHALL continue to apply.

#### Scenario: Configured agent does not exist in the worker location

- **WHEN** a configured worker agent exists centrally but is absent from the assigned worktree's native inventory
- **THEN** the controller reports the location-specific selection error before submitting the worker prompt and preserves owned resources and recovery identities

#### Scenario: Selected model cannot execute required tools

- **WHEN** the resolved model inventory declares that the selected model lacks tool capability required by the worker role
- **THEN** admission is blocked with a specific capability diagnostic and no alternative model is selected automatically

#### Scenario: Valid inventory does not prove provider availability

- **WHEN** an inventory-valid selection later encounters a provider or credential failure
- **THEN** normal native failure observation and the existing explicit retry policy apply without treating preflight as provider-success evidence

#### Scenario: Required skill is unavailable at the assigned location

- **WHEN** worker selection is valid but a required skill cannot be resolved at the worker location
- **THEN** admission stops before prompt submission with the requirement source and clearing action while preserving the issue claim, worktree and retry identity

#### Scenario: Effective tool availability differs from preflight

- **WHEN** the worker prompt has been admitted but the actual request lacks every alternative in a required tool group
- **THEN** the provider request is blocked with a retained capability diagnostic without substituting tools or granting a wider role

#### Scenario: Inventory changes after uncertain successful admission

- **WHEN** native inbox/transcript evidence proves the retained prompt was already admitted and current inventory has changed
- **THEN** recovery recognizes the existing admission without replaying it and subsequent request-time checks retain their normal authority

### Requirement: Long custom tools expose bounded native progress

Long controller-owned setup, verification and delivery tools SHALL expose bounded live progress on their native tool call when execution milestones or command-output counts advance. Updates SHALL identify the operation phase without leaking raw environments, credentials or unrestricted output. Live tool progress MUST remain separate from retained recovery evidence and MUST NOT by itself authorize completion, reset meaningful worker-progress age on unchanged heartbeats or bypass cancellation ownership.

#### Scenario: Repository verification produces output

- **WHEN** a controller-owned check emits additional output while its originating native tool call is active
- **THEN** the tool displays a bounded phase/count update and the durable command wait and configured deadline remain authoritative

#### Scenario: Progress display cannot be delivered

- **WHEN** a post-milestone progress update cannot be displayed
- **THEN** durable results and ownership are preserved and no completed side effect is repeated merely to deliver the progress display

### Requirement: Diagnose operations with bounded correlation and measurements

Operational diagnostics SHALL correlate relevant execution activity with its issue, execution, generation and operation identities when available. The system SHALL expose bounded measurements of reconciliation duration, admission waits, provider failures and observer requests without using individual issue/session identities as metric labels. Diagnostics and measurements MUST NOT expose secrets, raw provider bodies or unlimited command content and MUST NOT become lifecycle authority.

#### Scenario: Correlated operation fails

- **WHEN** an owned operation fails after admission
- **THEN** its diagnostics identify the applicable execution/generation/operation and safe failure classification so the operator can locate retained evidence

#### Scenario: Many issues produce measurements

- **WHEN** many different issues run and observers refresh repeatedly
- **THEN** measurement labels stay within the declared finite categories rather than creating a distinct metric series for each issue or session

### Requirement: Abra is the sole conversational user entry point

AbraCode SHALL expose one persistent central Supervisor agent named Abra as its normal user conversation. Launch, attach, user questions, work instructions, attention decisions and human checkpoint forms SHALL route through that central session and existing authorized controller routes. Explore, Apply, Review and Research SHALL remain independent controller-managed sessions, not alternative agents the user must converse with. A worker question SHALL retain its owner and durable identity and be presented for resolution through Abra. Naming or routing MUST NOT grant Abra implementation authority or replace required human authorization.

#### Scenario: Worker needs a user decision

- **WHEN** a worker reports an unresolved question owned by the user
- **THEN** it appears through Abra and the existing durable decision/form route without requiring a reply in the worker conversation

#### Scenario: Plan or merge needs approval

- **WHEN** the controller reaches a configured human checkpoint
- **THEN** the matching human form is presented in Abra and neither a worker report nor Abra's prose substitutes for its receipt

#### Scenario: User reconnects after service restart

- **WHEN** the existing AbraCode service and central session are rediscovered
- **THEN** the client attaches to the same Abra session with pending obligations preserved

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
