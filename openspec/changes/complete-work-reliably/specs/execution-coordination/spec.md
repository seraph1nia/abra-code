# Spec Delta

## ADDED Requirements

### Requirement: Finishing is a retained automatically advancing operation

Eligible executions SHALL progress through synchronization, preflight, matching approval, delivery preservation, authorized cleanup, native retirement and work-graph closure using controller-owned retained checkpoints. Satisfying one checkpoint SHALL make its next eligible checkpoint available to ordinary reconciliation without another conversational request. Pauses, current obligations, admission limits, ownership uncertainty and external custody SHALL remain enforced. Read-only inspection MUST NOT advance these checkpoints. Preflight inspection, native prompts, checks and network or filesystem operations SHALL preserve existing short global coordination and exclusive execution ownership boundaries.

#### Scenario: User answers the final required form

- **WHEN** a current approval or disposition is accepted and the execution has no other blocker or pause
- **THEN** ordinary reconciliation continues the next eligible finishing checkpoint without asking the user to call finish

#### Scenario: Restart follows a successful push

- **WHEN** the process stops after publishing a synchronized commit but before recording publication success
- **THEN** recovery identifies the exact intended remote commit and owned PR, records the matching result and continues without another independent commit, push or PR

#### Scenario: Restart follows merge or native retirement

- **WHEN** the process stops after merge or native worktree removal but before completing later checkpoints
- **THEN** recovery verifies the retained external postcondition and continues from preservation or closure without replaying the already completed mutation

#### Scenario: Pause arrives during finishing

- **WHEN** the execution is paused during synchronization, preflight or finalization
- **THEN** ownership and in-flight results retain their normal generation checks, no new dependent mutation starts, and resume revalidates all affected evidence

### Requirement: Synchronization and disposition retain exact operation identity

Automatic synchronization SHALL retain the input content revision, prior published head, owned PR, accepted scope, generation, admission count and expected postconditions before work begins. Each execution SHALL permit at most two automatically admitted synchronization attempts without a new explicit authorization. Changed heads or service restart MUST NOT replenish that allowance; recovering the same attempt or observing unchanged inputs MUST NOT consume it again. This allowance SHALL authorize processing existing attributable edits only, not new implementation work or a widening of repair policy. Native disposition collection SHALL persist its question, target and form identity before submission and SHALL validate the same identity before applying its result. Potentially submitted mutations MUST be reconciled before replacement operations are admitted.

#### Scenario: Two controllers observe the same late edit

- **WHEN** concurrent controllers attempt to reconcile the same content revision
- **THEN** only one attempt is durably admitted and the other observes retained ownership without consuming another attempt or submitting another writer

#### Scenario: The second synchronization attempt cannot stabilize work

- **WHEN** two automatic attempts have been admitted and a further revision requires synchronization
- **THEN** the controller presents a current explicit decision before any further attempt and retains the consumed history

#### Scenario: Answer targets an old execution or directory

- **WHEN** a native disposition answer refers to an older generation, replaced directory or superseded target
- **THEN** the answer remains historical evidence and grants no authority over the current worktree or newly observed files

#### Scenario: Remote mutation outcome is uncertain

- **WHEN** publication or merge may have succeeded but its response is unavailable
- **THEN** the controller preserves that uncertainty and reconciles its exact expected postcondition before starting another publication or merge
