# Spec Delta

## ADDED Requirements

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
