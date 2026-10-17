# Spec Delta

## ADDED Requirements

### Requirement: Reconcile pending implementation before merge

For a controller-owned open PR, the system SHALL detect tracked or nonignored untracked edits and local commits not represented by the retained publication. Existing attributable changes within accepted scope SHALL return through applicable planning, verification, independent Review, archival and publication gates and update the same PR before merge. Publication reconciliation MUST NOT authorize new corrective coding, adopt unknown changes, expand accepted scope, overwrite a changed remote branch or reuse approval for a different commit. Uncertain attribution or scope SHALL create a durable decision through Abra. Synchronization SHALL have a finite retained admission budget independent of optional stall diagnostics; unchanged observations and recovery of an admitted attempt MUST NOT consume additional attempts.

#### Scenario: Implementation changes after PR publication

- **WHEN** attributable existing implementation changes within accepted scope remain locally after publication of an open owned PR
- **THEN** the system withholds merge, revalidates the changes through the applicable gates, commits and pushes the validated content to that same PR, and obtains any required approval for the resulting head

#### Scenario: Local commit has not been published

- **WHEN** the owned local branch is ahead of its retained publication and the remote still matches that publication
- **THEN** the system validates attributable in-scope commits and publishes them without creating another PR or treating the older remote commit as current work

#### Scenario: File ownership or scope is uncertain

- **WHEN** remaining local changes cannot be attributed to authorized work or assessed within the accepted scope
- **THEN** the system preserves them, presents a decision identifying the affected changes, and does not automatically stage, discard or publish them

#### Scenario: Scope or planning artifacts change

- **WHEN** pending edits change accepted requirements or previously archived planning artifacts
- **THEN** the system requires the applicable revised planning authorization, preserves historical archives and does not classify the change as ordinary publication synchronization

#### Scenario: Synchronization budget is consumed

- **WHEN** the finite synchronization admission budget is exhausted and another content revision requires reconciliation
- **THEN** automatic synchronization stops with an actionable retained decision without suppressing that decision or resetting the budget because the head changed

#### Scenario: New corrective coding is required

- **WHEN** revalidation of existing edits fails and completing the work would require a new implementation turn
- **THEN** the existing finite corrective policy or explicit user authorization governs that turn rather than publication synchronization granting repair authority

### Requirement: Merge uses current local and remote evidence

Before requesting a new human merge approval and immediately before submitting any controller-owned merge, the system SHALL establish worker and queued-writer quiescence, a clean deliverable worktree, matching local and intended published commits, current verification and independent Review evidence accounting for the published content, matching authoritative remote PR identity/head/target, and successful current cleanup preflight. Applicable archival, external-custody, CI, review and required-action gates SHALL remain enforced. New edits, commits, decisions, resource replacements or cleanup-policy revisions SHALL invalidate affected readiness observations. A commit change MUST invalidate old merge authorization. Missing, stale, failed or incomplete observations MUST NOT establish readiness; ignore status alone MUST NOT establish cleanup readiness.

#### Scenario: Edits arrive while a merge form is pending

- **WHEN** local deliverable content changes after a merge form was presented
- **THEN** an answer for the old head cannot authorize merging the changed work, and the system reconciles the new revision before requesting its matching approval

#### Scenario: Local content changes during a forge read

- **WHEN** local content changes while remote readiness is being observed
- **THEN** the final local recheck refuses merge submission and invalidates the stale readiness result

#### Scenario: Remote branch changes independently

- **WHEN** the current remote PR head differs from the controller's retained publication
- **THEN** the system preserves local work, refuses push and merge against the changed identity, and requests reconciliation without force pushing

#### Scenario: All current identities match

- **WHEN** local and remote commits, current content evidence, cleanup preflight, authorization and forge gates all match under execution ownership
- **THEN** the controller submits a merge guarded by that exact remote head

#### Scenario: PR was merged outside the controller

- **WHEN** authoritative observation proves the owned PR was already merged
- **THEN** the controller verifies preservation and continues eligible retirement without merging again; additional unpublished edits are retained for an explicit follow-on decision rather than pushed into the merged PR

#### Scenario: External validation still owns the branch

- **WHEN** the external validation engine retains branch custody
- **THEN** native synchronization, publication, merge and resource removal remain blocked until supported custody recovery confirms ownership
