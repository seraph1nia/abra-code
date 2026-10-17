# Spec Delta

## Purpose

Deliver reviewed changes through explicit forge policies, explain ordinary blockers and prove preservation across configured GitHub merge methods.

## ADDED Requirements

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
