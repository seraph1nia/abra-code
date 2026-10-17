# Spec Delta

## MODIFIED Requirements

### Requirement: Readiness is exact and explains blockers

Delivery readiness SHALL be bound to the recorded repository, PR identity, target and reviewed head. It SHALL distinguish required checks, advisory checks, review requirements, draft status, mergeability and transport uncertainty. Missing or unreadable required-check policy MUST NOT imply success. Existing projects SHALL retain their conservative all-reported-check policy until explicitly configured otherwise; no-check merging SHALL require an explicit project policy.

Before a controller merge, readiness SHALL obtain a fresh complete observation of required PR feedback sources for the exact delivered identity. Unclassified substantive feedback, an active diagnostic/correction batch, accepted but unaddressed findings and unresolved scope decisions SHALL block controller merge. A retained successful poll or an unanswered human form MUST NOT substitute for feedback assessment. Existing forge-required approvals and conversation-resolution rules SHALL remain authoritative regardless of local handling dispositions.

Provisional draft publication and external validation success SHALL remain distinct from final delivered evidence. Pending policy-required public feedback actions, uncertain publication mutations, active external branch custody and an in-flight CI rerun SHALL prevent controller merge until their exact state is reconciled. Reviewer request receipts SHALL never substitute for submitted required reviews.

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

#### Scenario: Previously green PR receives new feedback

- **WHEN** a fresh pre-merge observation finds an unhandled substantive comment after CI was previously green
- **THEN** controller merge waits for its disposition while retaining valid same-head human authorization

#### Scenario: Diagnostic batch races with merge

- **WHEN** feedback admission or corrective work is pending for the delivered head
- **THEN** controller merge cannot proceed concurrently from a cached readiness result

#### Scenario: Feedback cannot be read completely

- **WHEN** a required review or comment source is unreadable during pre-merge observation
- **THEN** readiness reports an unconfirmed feedback wait and retains the PR and owned worktree

#### Scenario: An automatic thread reply is still uncertain

- **WHEN** configured feedback handling requires a reply whose result has not been reconciled
- **THEN** controller merge waits for the action's exact result rather than treating prepared content as a posted response

### Requirement: Feedback rounds retain gates and have finite scope

An explicitly enabled corrective policy SHALL support a finite number of rounds for failed checks, independent review and actionable forge findings within approved scope. Every changed head MUST obtain fresh verification and independent review and invalidate prior merge authorization. Full-spec post-archive corrections SHALL use a tracked revision planning cycle rather than mutating approved archived artifacts. Exhausted budgets, ambiguous feedback and scope changes MUST become durable decisions.

Forge corrections SHALL reference retained finding revisions assessed as applicable to the current delivered head and SHALL revalidate their authoritative source and accepted scope before admission. Related findings SHALL be handled in one finite round when feasible. Observation, classification and repeated delivery MUST NOT consume repair rounds; the round is consumed exactly once when corrective work is durably admitted. Publishing a correction SHALL restart observation of the same PR. Repeated findings across heads, exhausted budgets and changed ownership MUST stop automatic corrective admission and retain a concrete decision.

#### Scenario: Feedback changes an already delivered head

- **WHEN** an authorized correction round produces a new commit
- **THEN** old merge authorization is invalid, current checks/review are required and the PR retains its identity

#### Scenario: Full-spec correction begins after archival

- **WHEN** a delivered full-spec change requires an in-scope correction
- **THEN** a revision change passes the configured planning/task/archive gates while the prior archive remains preserved

#### Scenario: Feedback asks for unrelated work

- **WHEN** a forge comment requests work outside the accepted scope
- **THEN** the system requests a decision instead of expanding the corrective round

#### Scenario: Duplicate correction request after restart

- **WHEN** the same retained finding revisions and admission identity are retried after an uncertain correction launch
- **THEN** the original round and native admission are reconciled without consuming another round or creating another PR

#### Scenario: Diagnosis accepts feedback but repair is disabled

- **WHEN** a finding is accepted as in scope and repair rounds are configured as zero
- **THEN** the system retains a user-needed decision and does not start a corrective writer

#### Scenario: Finding is still present after a corrective head

- **WHEN** a previously attempted finding remains applicable after verification and publication
- **THEN** the system requests inspection rather than starting repeated automatic repairs of that same finding
