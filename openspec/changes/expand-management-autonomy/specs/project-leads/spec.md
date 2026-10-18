# Spec Delta

## MODIFIED Requirements

### Requirement: Enforce narrow project-management authority

A lead SHALL be able to inspect authorized project evidence, propose tasks, monitor assigned issues, route findings and answer supervisor-owned routine questions within its registered repositories. An active explicit delegation grant SHALL additionally permit bounded research-only or lightweight-fix task intake and, only when granted, requests to the central scheduler. Without such a grant the existing proposal/Abra-acceptance boundary SHALL remain unchanged. Every mutation and query SHALL validate enabled native caller identity, current registration revision, grant where required and exact repository scope at invocation. Leads MUST NOT write project code, admit unmanaged writing sessions, grant or expand their own authority, change capacity or policy, approve protected checkpoints, merge, discard resources, close issues or delegate outside scope. Leads MUST NOT create other leads; only one management level beneath Abra SHALL be supported.

#### Scenario: Lead submits a task proposal

- **WHEN** an enabled lead proposes a task in an authorized repository
- **THEN** the proposal is retained for Abra's authorized intake/dispatch path without starting execution by itself; delegated admission requires a separate explicit grant and controller action

#### Scenario: Lead requests another project's work

- **WHEN** a lead queries or controls an issue outside its exact repository set
- **THEN** the controller refuses the action and discloses no unauthorized project evidence

#### Scenario: Lead attempts self-approval or recursive delegation

- **WHEN** a lead invokes protected approval, delivery, code-writing or lead-registration behavior
- **THEN** role and controller checks refuse it regardless of prompt text or profile

#### Scenario: Granted lead creates an allowed task

- **WHEN** an enabled current lead submits complete in-scope research or lightweight work within its active grant
- **THEN** the central controller admits ordinary work with grant provenance while preserving readiness, capacity, independent Review and human approvals

### Requirement: Reuse correlated communication and central scheduling

Lead messages SHALL use the same retained identity, admission, acknowledgement and recovery contract as other controller-routed communication. Completion/blocker notices SHALL be durably routed to the registered lead and Abra as appropriate without competing schedulers or work graphs. Disabling a lead SHALL revoke new management work and message admission, reconcile queued instructions and preserve existing tasks and unresolved obligations. Grant revocation SHALL prevent future delegated mutations without deleting already authorized tasks or implying consumed instructions were undone. Scope/model/session revision SHALL revoke old new-admission authority while retaining historical requests, accepted replies and proposal provenance under their original revision. Parent notification loss SHALL NOT cause repeated delegated task creation or loss of accepted replies. Required lead responses SHALL follow the same bounded recovery/uncertainty/escalation contract without bypassing management capacity or diagnostic budgets. Already admitted automatic lead turns SHALL retain finite configured diagnostic authority rather than inheriting a user's explicit authority from their parent session.

#### Scenario: Assigned worker reports a blocker

- **WHEN** a worker opens an applicable obligation for work monitored by a lead
- **THEN** the lead receives a correlated scoped notice while human-owned approval remains routed to Abra

#### Scenario: Lead is disabled with queued work

- **WHEN** Abra disables the lead before another management request is admitted
- **THEN** the lead cannot create or admit new work, queued messages are reconciled, and existing controller-owned executions and obligations remain intact

#### Scenario: Single-supervisor installation upgrades

- **WHEN** no project leads are configured
- **THEN** the existing Abra workflow continues with no additional management sessions or authority changes

#### Scenario: Revocation races a delegated batch

- **WHEN** grant revocation and batch admission contend
- **THEN** their retained authorization order determines whether the entire batch was admitted, and any admitted tasks keep their original controller ownership

#### Scenario: Scope revision has historical requests

- **WHEN** a lead's repository scope changes with answered and unanswered historical requests
- **THEN** history retains original scope/revision provenance, old instructions gain no new authority and unresolved work receives explicit supersession or escalation

#### Scenario: Lead creation or parent notice response is lost

- **WHEN** native session creation or a committed reply notification loses its receipt across restart
- **THEN** reconciliation reuses retained session/message identities without duplicate task intake or fabricated response completion

## ADDED Requirements

### Requirement: Delegate finite task admission through an explicit grant

Only authorized Abra control SHALL establish, replace or revoke a versioned controller-owned delegation grant. A grant SHALL bind one lead and registration revision to authorized repositories, permitted task kinds and workflow policies, a finite lifetime task budget, a finite concurrently active task limit, a required expiration timestamp, scheduling permission and preserved human approval requirements. Initial supported kinds SHALL be scoped investigation under research-only and minor correction under lightweight-fix. Every delegated mutation SHALL revalidate current native caller, registration, enabled grant, expiration/revocation, repository/dependency scope, task kind/workflow, remaining budget and applicable project policy. Concurrent admissions MUST NOT exceed the total task budget; concurrent scheduler claims MUST NOT exceed the granted active limit or global/repository capacity. Unknown or stale grants SHALL confer no authority. Grant replacement SHALL retain prior usage/provenance; only an explicit new grant can authorize another budget.

#### Scenario: Scope or workflow violates grant

- **WHEN** a lead submits work in another repository, uses full-openspec or requests an unpermitted task kind
- **THEN** the entire delegated mutation fails without creating tasks or consuming grant budget

#### Scenario: Grant is exhausted expired or disabled

- **WHEN** budget is exhausted, expiry has passed, the lead is disabled or its registration revision changed
- **THEN** no new delegated work or scheduling claim is authorized and a concrete reason is returned

#### Scenario: Concurrent calls compete for last task

- **WHEN** two distinct delegated batches concurrently compete for one remaining task allowance
- **THEN** at most one task is committed and restart preserves that usage

#### Scenario: Active limit is reached

- **WHEN** a lead has one occupied active grant slot and its maximum active tasks is one
- **THEN** another admitted task waits for the central scheduler until a verified slot release while unrelated eligible work can proceed

#### Scenario: Lead attempts to approve its own plan or merge

- **WHEN** a lead invokes a protected approval or delivery action with a valid task-admission grant
- **THEN** the action is refused and the matching human/controller approval boundary remains required

#### Scenario: No delegation is configured

- **WHEN** an existing installation has only ordinary lead registrations
- **THEN** leads retain proposal-only task creation behavior and no implicit grant or additional management turn is created
