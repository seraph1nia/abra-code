# delivery-evidence Specification

## Purpose

Deliver reviewed changes through explicit forge policies, explain ordinary blockers and prove preservation across configured GitHub merge methods.

## Requirements

### Requirement: Readiness is exact and explains blockers

Delivery readiness SHALL be bound to the recorded repository, PR identity, target and reviewed head. It SHALL distinguish required checks, advisory checks, review requirements, draft status, mergeability and transport uncertainty. Missing or unreadable required-check policy MUST NOT imply success. Existing projects SHALL retain their conservative all-reported-check policy until explicitly configured otherwise; no-check merging SHALL require an explicit project policy.

#### Scenario: Advisory check fails under an explicit required-only policy

- **WHEN** all verifiably required checks pass but an advisory check fails
- **THEN** readiness reports the advisory failure separately without treating it as a required-check failure

#### Scenario: Required context has not reported

- **WHEN** a required check exists but no result for the delivered head is available
- **THEN** readiness remains waiting and names the missing requirement

#### Scenario: Forge cannot enumerate required policy

- **WHEN** the required-only policy is selected but authoritative requirement discovery is unavailable
- **THEN** readiness remains unconfirmed and never infers that an empty reported-check list permits merge

#### Scenario: PR head changes

- **WHEN** the current PR head differs from the verified delivered commit
- **THEN** merge is refused and fresh verification and authorization are required

### Requirement: Merge method is configured and guarded

GitHub delivery SHALL support explicitly configured merge, squash and rebase methods while retaining merge as the default. Merge requests MUST enforce the expected head and required authorization without bypassing forge protections. A changed delivery method during an execution MUST NOT silently change its retained policy.

#### Scenario: Squash delivery is selected

- **WHEN** a project explicitly selects squash and current head, review, CI and authorization all match
- **THEN** the controller submits a guarded squash request for that PR identity

#### Scenario: Forge rejects configured method

- **WHEN** the forge refuses the configured method or reports an unsupported merge-queue requirement
- **THEN** the system reports the restriction without falling back to another method or bypassing protections

### Requirement: Preservation evidence covers transformed commits

Cleanup after a GitHub merge SHALL require authoritative confirmation that the exact delivered PR head was merged to the expected target and that the forge-reported resulting commit is retained by a freshly fetched target. Squash/rebase preservation MUST NOT require the original head to be an ancestor of the target, and MUST NOT accept similar patches, a branch name or a successful command exit as sufficient evidence. Branch delivery SHALL continue to require the exact intended remote commit.

#### Scenario: Squash or rebase changes commit identity

- **WHEN** the exact delivered PR is verifiably merged and its resulting commit is an ancestor of the fetched target
- **THEN** the system records source and resulting commit identities and permits retirement despite changed original commit identity

#### Scenario: Merge response is lost

- **WHEN** the merge command's response is unavailable
- **THEN** reconciliation inspects the exact PR and target before repeating the request or permitting cleanup

#### Scenario: Target no longer contains the result

- **WHEN** the forge reports a merge but the resulting commit is absent from the refreshed target
- **THEN** preservation remains unproven and the worktree is retained

### Requirement: PR content describes intent and evidence

Created PRs SHALL identify the issue title, requested outcome, relevant planning/report references and actual verification/review results. Retrying delivery SHALL rediscover the same owned PR. Automatic updates MUST be limited to a controller-owned summary section and preserve user-authored text.

#### Scenario: PR content is generated

- **WHEN** delivery creates a PR for a verified change
- **THEN** its title and body describe the requested change and recorded evidence rather than only the issue identifier

#### Scenario: User edits the description

- **WHEN** a subsequent delivery round updates the controller-owned evidence section
- **THEN** manually authored content outside that section remains unchanged

### Requirement: Feedback rounds retain gates and have finite scope

An explicitly enabled corrective policy SHALL support a finite number of rounds for failed checks, independent review and actionable forge findings within approved scope. Every changed head MUST obtain fresh verification and independent review and invalidate prior merge authorization. Full-spec post-archive corrections SHALL use a tracked revision planning cycle rather than mutating approved archived artifacts. Exhausted budgets, ambiguous feedback and scope changes MUST become durable decisions.

#### Scenario: Feedback changes an already delivered head

- **WHEN** an authorized correction round produces a new commit
- **THEN** old merge authorization is invalid, current checks/review are required and the PR retains its identity

#### Scenario: Full-spec correction begins after archival

- **WHEN** a delivered full-spec change requires an in-scope correction
- **THEN** a revision change passes the configured planning/task/archive gates while the prior archive remains preserved

#### Scenario: Feedback asks for unrelated work

- **WHEN** a forge comment requests work outside the accepted scope
- **THEN** the system requests a decision instead of expanding the corrective round

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
