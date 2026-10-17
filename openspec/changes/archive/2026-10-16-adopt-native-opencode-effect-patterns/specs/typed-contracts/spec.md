# Spec Delta

## MODIFIED Requirements

### Requirement: Keep representations consistent

Validated data contracts SHALL define the accepted tool and observer representations as well as their internal types. Successful custom tools SHALL return structured output conforming to their advertised output contract and consistent with their human-readable success content. Diagnostic output MUST identify the operation and offending field without dumping credentials or unlimited external payloads. Already validated native runtime values SHALL retain their native identities and timestamp semantics. Existing omission-versus-null behavior and additive durable evidence MUST be preserved when codecs or native schema projections change.

#### Scenario: Input description matches execution validation

- **WHEN** a tool advertises accepted workflow and policy fields
- **THEN** the handler accepts exactly that documented validated shape and returns a consistent structured failure for invalid data

#### Scenario: Native diagnostic timestamps cross the observer

- **WHEN** a decoded native message is projected to a custom wire response
- **THEN** it is encoded to the documented JSON timestamp representation and the observer receives a validated response

#### Scenario: Successful tool exposes machine-readable data

- **WHEN** a custom tool completes successfully
- **THEN** its native structured output conforms to the advertised output schema and agrees with its success content, including valid no-value results

#### Scenario: Unknown tool argument is rejected

- **WHEN** a caller supplies an undeclared argument to a custom tool whose contract rejects excess properties
- **THEN** the request is rejected before its handler mutates state and the field is not silently stripped to permit the action

#### Scenario: Optional output field is absent

- **WHEN** an optional observer or retained-record field has no value
- **THEN** encoding preserves its existing omission behavior rather than introducing a null value or an explicit undefined wire field

#### Scenario: Native error is projected to diagnostics

- **WHEN** a native model or error value is used in a diagnostic response
- **THEN** the projection retains the native identity and consumed field semantics, applies intentional local refinements and excludes raw provider response bodies

## ADDED Requirements

### Requirement: Native failures preserve their classification

Rejected custom tool actions and expected tool-policy rejections SHALL use the native recoverable tool-failure channel with a bounded safe reason, stable domain code and applicable recovery guidance. They MUST NOT be represented as successful tool content or unexpected defects. Explicit routine waits SHALL remain successful classified domain values. Unexpected implementation defects and cancellation MUST retain their distinct semantics rather than being converted into ordinary validation failures.

#### Scenario: Worker attempts a forbidden tool

- **WHEN** an Explore worker attempts a shell tool that its role prohibits
- **THEN** the native call fails through the expected tool-error channel, remains rejected and does not authorize any lifecycle transition

#### Scenario: Controller rejects a stale action

- **WHEN** a custom tool action is rejected because its generation or checkpoint evidence is stale
- **THEN** the host observes a failed tool call with the safe code and recovery guidance rather than a successful result containing an error envelope

#### Scenario: Delivery is waiting normally

- **WHEN** an authorized delivery observation reports pending CI or review
- **THEN** the tool returns the classified wait as successful data without presenting the wait as a failed tool execution

#### Scenario: Implementation defect occurs

- **WHEN** an unexpected programmer defect occurs during tool execution
- **THEN** it remains distinguishable from an expected domain rejection and does not generate a fabricated successful or retry-authorizing response

### Requirement: Observer errors have a declared domain contract

Expected observer failures SHALL have schema-defined error identities and bounded safe data so clients can distinguish a missing issue, unavailable retained resource or invalid read selection from connection/framework failure. Such errors MUST NOT mutate lifecycle state or hide unrelated readable work.

#### Scenario: Planning document is unavailable

- **WHEN** a planning-document read targets a retired worktree or an unavailable owned document
- **THEN** the observer returns its declared unavailable-resource error and the client can preserve the ticket and other readable views

#### Scenario: Observer connection fails

- **WHEN** a read cannot reach the native service
- **THEN** the client identifies connection failure separately from a declared missing-resource error and keeps its last snapshot marked stale

### Requirement: Persisted timestamps represent valid time

OpenCrew-owned timestamp strings SHALL represent valid UTC instants while preserving supported valid historical representations. Newly generated timestamps and time-based decisions SHALL use one controllable clock source. Invalid retained timestamps MUST produce bounded record diagnostics without rewriting evidence or inventing a receipt time.

#### Scenario: Invalid timestamp is encountered

- **WHEN** a retained timestamp contains non-date text
- **THEN** validation preserves the original record and reports the affected source and field without admitting a mutation based on that record

#### Scenario: Controlled time advances

- **WHEN** the supplied clock advances during an execution and a new receipt or fallback failure timestamp is generated
- **THEN** the timestamp reflects that same clock while existing native message times retain their original meaning

#### Scenario: Valid historical timestamp is loaded

- **WHEN** a supported retained record contains a valid UTC timestamp string
- **THEN** it remains readable without changing its identity, recorded time or authorization status

### Requirement: Work creation uses one normalized contract

Work creation arguments, normalized creation requests and persisted retry inputs SHALL derive from one owned family of validated contracts. Normalization SHALL preserve title/description trimming, priority bounds, sorted unique dependencies, workflow/scope/report identity and the existing Supervisor-scoped implicit request key. Invalid new inputs MUST NOT create partial graph or request records. Previously accepted saved requests MUST retain their retry meaning through a compatible decoder.

#### Scenario: Equivalent creation is retried

- **WHEN** the same request is retried with whitespace-normalized goal text or reordered duplicate dependencies
- **THEN** it resolves to the original normalized request and issue rather than creating independent work

#### Scenario: Saved request contains malformed data

- **WHEN** a persisted retry input cannot be decoded according to its supported request contract
- **THEN** the system reports the invalid source without rebinding the request ID or changing the original issue

#### Scenario: Legacy full-spec request is retried

- **WHEN** an existing saved request omits fields that were historically defaulted
- **THEN** its decoded normalized identity remains compatible with that original request and no new request or policy authorization is invented
