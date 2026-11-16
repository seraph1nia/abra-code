# Spec Delta

## Purpose

Expose an authorized persistent native agent session through AG-UI while preserving native execution, admission identity, observable ordering and recovery semantics independently of the workspace presentation.

## ADDED Requirements

### Requirement: Expose native execution through a standard agent contract

The backend SHALL accept validated AG-UI run input for its authorized native session and emit valid AG-UI events consumable without application widgets. OpenCode SHALL retain execution and session-history ownership. Unsupported client tools, context, state mutation and session selection MUST NOT alter native configuration or controller authority.

#### Scenario: Standard client runs the authorized agent

- **WHEN** a standard AG-UI client submits supported text input with a stable admission identity to the authorized endpoint
- **THEN** it observes valid run boundaries and the native reply without requiring the task finder, report renderer or workspace state

#### Scenario: Client attempts to replace native configuration

- **WHEN** run input supplies executable client tools, unsupported context, foreign session identity or an unsupported state mutation
- **THEN** the backend refuses the unsupported capability before native admission and preserves the configured agent and permissions

### Requirement: Preserve streamed native message and tool meaning

The agent transport SHALL progressively emit supported native visible text and tool updates through AG-UI events with stable identities and native provenance. Live and historical projections SHALL agree on order, tool status and bounded observable content. Hidden reasoning and provider replay MUST remain excluded; truncation MUST be explicit.

#### Scenario: Native output interleaves text and a tool call

- **WHEN** a native reply emits text, streamed tool arguments, a tool result and later text
- **THEN** the consumer receives progressive text/tool events in the same visible order with the original call identity and stable native-message provenance

#### Scenario: One native tool fails while execution continues

- **WHEN** OpenCode records a failed tool and continues generating the reply
- **THEN** the tool remains a failed observation under its original identity without being represented as successful content or prematurely terminating the whole run

#### Scenario: Historical content exceeds an observable limit

- **WHEN** a completed call has oversized arguments or results
- **THEN** its bounded historical representation states the limit and does not emit malformed argument fragments as a complete replayable call

#### Scenario: Hidden provider material is present

- **WHEN** native events or history contain reasoning, replay metadata or private provider payloads
- **THEN** the standard consumer receives only the permitted visible projection

### Requirement: Correlate transport runs with durable native admission

Each supported run SHALL bind its stable submission identity to the native admitted message, preserving queue and steer semantics. Completion and errors SHALL refer to that submission's evidenced native processing. A transport run ID MUST NOT become a second admission identity. Missing or uncertain evidence MUST NOT cause automatic replay.

#### Scenario: Admission response is lost

- **WHEN** native admission succeeds but the HTTP response is lost and the same submission is reconciled after reconnect or restart
- **THEN** the original native message and receipt are recovered without a second prompt or tool execution

#### Scenario: Another client queues work during a run

- **WHEN** multiple inputs share one session and an unrelated idle transition or completion occurs
- **THEN** each observed run remains correlated to its own admitted message rather than borrowing another submission's completion

#### Scenario: Native processing fails

- **WHEN** the native processing of the admitted input reaches an evidenced terminal failure
- **THEN** its transport run terminates with a bounded AG-UI error while retained admission and native failure evidence remain inspectable

#### Scenario: Admission cannot be proved

- **WHEN** a submission has uncertain or conflicting admission evidence
- **THEN** the transport exposes the uncertainty and requires the existing explicit reconciliation path without allocating another native identity

### Requirement: Recover observation without replaying execution

Observation SHALL reconnect after failure or clean closure, establish a valid session baseline and recover missing or reordered updates without replaying input. Baseline replacement SHALL prevent duplicate or lost visible output. Owned retries and fallback reads SHALL be bounded and shared across consumers; wall time MUST NOT establish causal ordering.

#### Scenario: Connection drops during streamed tool arguments

- **WHEN** the native subscription ends while a tool is streaming and native execution continues
- **THEN** reconnect obtains the current baseline and continues the call without duplicating arguments, results, prompts or execution

#### Scenario: Native service restarts or an event gap is detected

- **WHEN** observation cannot continue against its established event baseline
- **THEN** the client retains explicitly stale valid content until a fresh baseline replaces it and subsequent deltas apply to that baseline only

#### Scenario: Several observers watch one session

- **WHEN** multiple supported observation consumers are attached
- **THEN** they receive coherent projections without independent unbounded native subscriptions or duplicate periodic full-workspace reads

### Requirement: Separate observation disposal from native Stop

Disconnecting, unsubscribing or disposing a transport observer SHALL release only its owned observation resources. Stopping current native execution SHALL require the explicit authorized Stop operation. A historical transport run ID MUST NOT be treated as authority to stop unrelated current native work.

#### Scenario: Browser closes during active execution

- **WHEN** a browser closes or cancels its HTTP stream while native work is active
- **THEN** its observer and retry resources are released while the native session, queued inputs and execution remain intact

#### Scenario: User explicitly stops the current turn

- **WHEN** the operator invokes the authorized current-turn Stop action
- **THEN** the native Stop operation is performed with its existing queue and acknowledgement semantics

#### Scenario: Client names an old transport run

- **WHEN** a Stop request targets a historical run that cannot be bound to a supported native stop target
- **THEN** it is refused without stopping the current turn

### Requirement: Retain exact generated presentation references

The transport SHALL preserve the producing native message/call identity and exact retained revision of generated surface or report references. Documented generated interactions SHALL remain typed read-only navigation. Unsupported agent callbacks MUST NOT execute tools, submit prompts or create approval authority.

#### Scenario: A generated surface is revised

- **WHEN** a later native call publishes a new revision of the same surface
- **THEN** each historical reference continues resolving to its own exact retained revision after reload and restart

#### Scenario: Reader uses a generated navigation link

- **WHEN** the reader opens an allowed task, session, decision, changes or artifact target
- **THEN** ownership is validated and inspection opens without native prompt admission or controller mutation

#### Scenario: Input requests an unsupported generated callback

- **WHEN** a generated interaction requests an arbitrary action or approval callback
- **THEN** it is rejected without execution and existing valid presentation remains available
