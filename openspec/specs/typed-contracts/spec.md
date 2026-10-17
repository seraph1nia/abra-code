# typed-contracts Specification

## Purpose

Ensure external inputs and retained orchestration evidence are validated before they can influence execution, authorization, delivery or recovery.

## Requirements

### Requirement: Validate external data before use

The system SHALL validate the structure and safety-relevant values of CLI JSON, repository manifests, parsed configuration, plugin-owned wire responses and tool arguments before using them. Missing fields, invalid values and malformed JSON MUST produce a source-specific diagnostic without optimistic defaults or lifecycle advancement. Additive upstream fields SHALL remain compatible when the consumed contract remains valid.

#### Scenario: OpenSpec returns a syntactically valid invalid result

- **WHEN** an OpenSpec status response contains invalid artifact or completion fields
- **THEN** the system reports the command and invalid field path and retains the execution and its evidence without advancing it

#### Scenario: Forge response grows an unrelated field

- **WHEN** a forge response includes a new field while all consumed identity and readiness fields remain valid
- **THEN** the response remains usable and existing readiness checks still apply

#### Scenario: Invalid model-facing arguments

- **WHEN** a tool request contains an unknown policy or an invalid identifier
- **THEN** validation rejects it before issue creation, resource allocation or record mutation

### Requirement: Decode and migrate durable records explicitly

Every plugin-owned execution, project, setup, operation, decision and attention record SHALL have a versioned validated contract. Recognized legacy records SHALL migrate without changing issue/session/worktree identity, recorded policy, pending obligations or authentic authorization evidence. Unknown future versions or impossible states MUST remain preserved and unavailable for mutation, with actionable diagnostics.

#### Scenario: Existing full-spec execution upgrades

- **WHEN** a valid pre-versioning execution with pending approval is loaded after upgrade
- **THEN** migration retains its native IDs, fingerprints, approval state and claim and does not issue a new authorization

#### Scenario: Incomplete legacy state

- **WHEN** a legacy record lacks evidence required to resume its recorded phase
- **THEN** the system preserves the original data and requests recovery rather than inventing a receipt or replaying a mutation

#### Scenario: Unknown record version does not disappear

- **WHEN** a scan encounters an execution written by an unsupported newer version
- **THEN** the execution remains visible as unavailable for mutation and other valid executions remain inspectable

### Requirement: Distinguish expected waits from failures

Operation results SHALL distinguish completed work, routine waiting, retryable external failure, failed verification and unsafe recovery conditions. Retry policy MUST derive from this classification and retained identity, rather than free-text message matching or retrying every failure.

#### Scenario: Waiting is not a failed execution

- **WHEN** CI is pending or required review approval has not arrived
- **THEN** the execution records a waiting reason and next observation time and retains its current delivery authorization

#### Scenario: Changed remote identity

- **WHEN** the PR head or owned repository identity differs from recorded delivery evidence
- **THEN** the system stops the affected mutation and surfaces recovery or renewed verification requirements without automatic merge

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

### Requirement: PR action identity represents the remote mutation target

Each retained PR action SHALL have a validated target specific to its action kind and bound to its execution, repository, PR and applicable delivered head. Discussion actions SHALL retain the applicable source/thread revisions and prepared content identity; reviewer actions SHALL retain the selected user/team request lifecycle; CI reruns SHALL retain the exact workflow, run ID and source attempt. Invalid or incompatible target combinations MUST be rejected before mutation. Finding IDs and unrelated action fields MUST NOT create different identities for the same workflow-attempt rerun.

Multiple eligible findings for one workflow attempt SHALL contribute evidence to one logical rerun and one finite reservation. Retry, restart, pause/resume, repeated polls and additional job findings MUST NOT allocate another reservation or submit the same attempt again. Different workflow runs or later attempts SHALL remain distinguishable and require their own eligibility and remaining budget. Semantic target reuse MUST NOT grant permission to send under a stale generation, changed head or changed authority. Historical budget usage MUST NOT be silently reduced by normalization.

#### Scenario: Two failed jobs belong to one attempt

- **WHEN** two classified eligible findings point to the same workflow run and source attempt
- **THEN** one logical rerun retains both finding revisions, reserves one budget slot and admits at most one remote rerun submission even while the source still reports the original attempt

#### Scenario: The same rerun is inspected after restart

- **WHEN** reconciliation restarts while a rerun for the current source attempt is awaiting a subsequent attempt
- **THEN** it reuses the retained action and reservation and does not submit another rerun merely because no newer attempt is visible yet

#### Scenario: Distinct runs fail

- **WHEN** eligible findings refer to two different workflow run identities
- **THEN** the system treats their reruns as independent targets and applies eligibility and finite budget to each

#### Scenario: Pause changes control generation

- **WHEN** a paused execution resumes with the same retained rerun target and no new run attempt
- **THEN** it locates the original action without a duplicate reservation while rechecking current authority before any definitely unsubmitted action can be sent

#### Scenario: A later attempt also fails

- **WHEN** an observed subsequent attempt completes unsuccessfully
- **THEN** a further rerun requires a newly assessed eligible attempt and remaining budget, and the earlier rerun is not treated as proof of CI success

### Requirement: PR action evidence distinguishes preparation from submission

The action contract SHALL distinguish definitely unsubmitted preparation, durable submission admission, awaiting remote postcondition, confirmed effect and uncertain possible effect. Read-only identity, source and permission failures before send admission SHALL retain a definitely unsubmitted reason and remain eligible for bounded preparation retry when their classification permits it. Permanent denial or stale evidence SHALL remain an explained refusal or superseded target rather than an unbounded retry loop. An unchanged approved target SHALL retain its bound human authorization through a preparation retry; changed payload, identity or authority MUST require fresh validation and applicable authorization.

The system SHALL persist exact target and submission admission before the mutating command begins, recheck current control authority before admission, and preserve that admission across interruption. A generic failure, timeout or malformed response after admission SHALL remain potentially submitted unless explicit source evidence proves no effect. Recovery of a potentially submitted action SHALL observe its exact postcondition and MUST NOT blindly resend it. Typed outcome evidence SHALL determine retry eligibility; free-text error matching MUST NOT establish that a write was never sent. Tool and observer results SHALL accurately distinguish retryable preflight work from uncertain writes without performing mutations during reads.

#### Scenario: Permission lookup fails before a reviewer request

- **WHEN** an approved reviewer action cannot complete a read-only permission lookup before submission
- **THEN** it remains definitely unsubmitted with a bounded reason and, after the lookup recovers and current validation succeeds, submits once under the unchanged approval and action identity

#### Scenario: A reviewer is permanently ineligible

- **WHEN** a complete permission observation proves the selected reviewer cannot be requested
- **THEN** the system reports a definite unsubmitted refusal and does not treat it as an ambiguous sent request or repeatedly retry it without a relevant change

#### Scenario: The process stops after send admission

- **WHEN** a process stops after durable submission admission but before a success receipt is retained
- **THEN** recovery treats the effect as potentially submitted even if no mutating command can be proved to have started

#### Scenario: The reply response is lost after submission

- **WHEN** a discussion reply may have been posted but its command response is unavailable
- **THEN** recovery observes the exact discussion using the retained action marker, authenticated author and prepared body, and does not post another reply without authoritative resolution of the prior effect

#### Scenario: The target changes while preparation is pending

- **WHEN** the PR head, source revision, prepared payload or required authority changes before send admission
- **THEN** the previous approval cannot authorize the changed request and no write occurs under stale evidence

#### Scenario: An observer displays a preflight failure

- **WHEN** a ticket or tool reads an action whose permission preflight is temporarily unavailable
- **THEN** the output identifies it as unsubmitted preparation requiring retry, does not claim an uncertain remote write, and performs no action as a side effect of the read

### Requirement: Action upgrades preserve historical authority and uncertainty

Supported prior action records SHALL remain readable without changing their action IDs, original reply markers, approval/form bindings, prepared payload evidence, confirmed receipts, immutable finding history or consumed reservations. Normalization into a newer target/submission contract SHALL be explicit and lossless for the evidence required to authorize or reconcile an action. Unknown versions or insufficient target identity SHALL remain preserved and unavailable for sending with an actionable diagnostic.

A prior running or uncertain action without definite submission-stage proof SHALL remain potentially submitted. Its stored error text MUST NOT be reinterpreted as proof that no mutation occurred. Existing confirmed actions SHALL continue to satisfy matching semantic obligations without reissuing their remote effects. An upgrade MUST NOT grant fresh authority or reset a finite budget.

#### Scenario: A prior uncertain action has a permission-related error

- **WHEN** a supported historical action is uncertain and its only failure evidence is permission-related text
- **THEN** normalization preserves submission uncertainty and requires source reconciliation rather than enabling a resend

#### Scenario: An old reply marker is observed

- **WHEN** a confirmed or potentially submitted prior reply is found using its original action marker and matching source evidence
- **THEN** the upgraded controller reconciles that same action, recognizes the owned reply and does not issue a replacement reply with a new marker

#### Scenario: Historical duplicate reservations exist

- **WHEN** multiple prior records reference the same workflow attempt and have consumed retained budget
- **THEN** the controller prevents new duplicate submissions while preserving the historical records and consumed-budget evidence instead of silently refunding them

#### Scenario: A future action version is encountered

- **WHEN** an action record uses an unsupported version or lacks identity required for safe target normalization
- **THEN** the record remains preserved and visible as unavailable for mutation and no inferred target or fresh authorization is invented
