# Spec Delta

## ADDED Requirements

### Requirement: Every merge route accounts for required PR actions

Before any controller-authorized GitHub merge, the system SHALL determine required PR actions from the execution's snapshotted authority, exact repository/PR/target/head, complete fresh observations and retained action evidence. A policy-required action that has not yet been prepared SHALL remain pending; an empty action history or delayed monitor tick MUST NOT establish clearance. Policy-required ready transitions, on-ready reviewer requests, evidence replies, applicable thread resolution and eligible CI reruns SHALL be accounted for according to their configured prerequisites. A reviewer request receipt MUST NOT substitute for required submitted review approval.

Explicit completion, completion after a human merge approval and periodic reconciliation SHALL enforce the same action obligations. Missing, rejected, definitely unsubmitted, awaiting-postcondition or uncertain required actions SHALL retain a concrete wait or decision until satisfied, superseded by authoritative current evidence, or changed through an authorized policy revision. Potentially submitted actions MUST NOT be superseded solely because their source or local policy changed. Existing feedback assessment, scope decisions, external custody, verification, independent Review, exact-head authorization and forge protection requirements SHALL continue to apply.

#### Scenario: Merge is requested before the automatic action pass

- **WHEN** an addressed current-head finding requires a verified evidence reply and merge is requested while no reply action has been recorded
- **THEN** the controller retains the missing action as pending and does not send a merge request

#### Scenario: Merge approval is completed before the next monitor tick

- **WHEN** a human approves the exact delivered head while configured on-ready reviewer requests remain unfulfilled
- **THEN** completion applies the same action clearance rules as periodic reconciliation and retains the approval while the requests are handled

#### Scenario: Thread resolution depends on a reply

- **WHEN** policy requires both an evidence reply and resolution for an addressed thread and the reply is not yet confirmed
- **THEN** merge remains pending and thread resolution does not treat prepared reply content as posted evidence

#### Scenario: Manual discussion defaults remain selected

- **WHEN** current feedback has been appropriately dispositioned and automatic replies and resolution are disabled
- **THEN** the controller creates no automatic discussion obligation and still enforces forge-required conversation resolution and any explicitly admitted manual actions

#### Scenario: A required action was rejected

- **WHEN** an action required by the retained policy has been rejected without satisfying its remote postcondition
- **THEN** its rejection remains an explained blocker or decision and cannot count as successful action clearance

#### Scenario: An unsent source revision becomes stale

- **WHEN** feedback changes before a prepared action has been submitted
- **THEN** the old target is superseded with its reason, the new revision is assessed, and merge cannot use the obsolete action as evidence for the changed target

#### Scenario: An uncertain write remains unresolved

- **WHEN** a required action may have been submitted and its source is edited or a later policy decision changes the desired action
- **THEN** the system retains and reconciles the original possible effect rather than clearing uncertainty by changing the local desired action

### Requirement: Check provenance is consistent across delivery consumers

Readiness, feedback assessment and CI retry admission SHALL use consistent authoritative current-check observations. Each observation SHALL retain its source kind, stable source identity, assessed head, check name or status context, application binding when available, selected current attempt or revision, normalized state, source link when available and required/advisory classification. Same-name sources from distinct applications or source kinds MUST NOT be merged by display name. Superseded attempts MUST NOT acquire corrective authority from the state of another source.

Incomplete source pagination, mismatched heads, or insufficient identity to match an application-bound requirement SHALL remain unconfirmed rather than borrowing another source's identity. Optional job/log evidence SHALL remain supplemental and MUST NOT change authoritative required/advisory classification. Existing conservative all-reported policy, explicit required-only policy, missing-required-context waits and no-check authorization SHALL retain their meaning.

#### Scenario: Required and advisory applications use the same check name

- **WHEN** two applications report failed checks with the same display name and only the first application is required
- **THEN** readiness and feedback identify the first as blocking and the second as advisory, and the advisory source is ineligible for automatic corrective admission or CI rerun

#### Scenario: An older attempt failed but the current attempt passed

- **WHEN** a prior failed attempt remains visible in a summary while the authoritative current attempt has passed
- **THEN** feedback and retry admission use the current attempt and do not construct a new corrective request from the stale summary

#### Scenario: A commit status shares a name with a check run

- **WHEN** a commit status and an application-bound check run share a name but have distinct source identities
- **THEN** their observations remain distinct and the status cannot satisfy or inherit an application-bound check requirement by name alone

#### Scenario: Failure details are unavailable

- **WHEN** an authoritative blocking check has no readable linked Actions job or failure log
- **THEN** its blocking classification and source identity remain intact and missing supplemental details are explicitly disclosed

#### Scenario: Application identity is unavailable

- **WHEN** a policy requires a particular check application and the available source does not establish that application
- **THEN** readiness remains unconfirmed or waiting for the required source rather than accepting another same-name result
