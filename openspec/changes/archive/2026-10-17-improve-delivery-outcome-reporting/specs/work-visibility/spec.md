# Spec Delta

## MODIFIED Requirements

### Requirement: Present waits and next actions explicitly

Ticket views and status tools SHALL distinguish workflow phase, worker activity, external operation, routine wait, actionable failure and unsafe recovery. Each blocker SHALL expose its owner or dependency, relevant evidence and the next clearing action. Normal CI/review waits and contended approval/finish observations MUST NOT appear as recovery failures. A delivery awaiting external confirmation SHALL be labeled unconfirmed or in progress rather than definitively unmerged. A preserved delivery with ordinary cleanup blockers SHALL identify the remaining retirement action separately from the delivered result.

#### Scenario: Ticket awaits CI

- **WHEN** a delivered ticket is waiting on a named check
- **THEN** the operator sees the check reason and next observation rather than a generic recovery-required label

#### Scenario: Execution has stale ownership evidence

- **WHEN** mutation is stopped because the owned identity cannot be verified
- **THEN** the ticket remains visible under attention with the identity conflict and a recovery action

#### Scenario: Merged delivery awaits file disposition

- **WHEN** a PR delivery receipt proves preservation and ordinary files block retirement
- **THEN** the view identifies delivery as verified, cleanup as blocked with retained path evidence and next action, and issue closure as pending

## ADDED Requirements

### Requirement: Delivery tools expose independent evidenced outcomes

Supervisor approval, finish and status tools and native ticket detail SHALL expose consistent independent observations for matching human approval, delivery preservation, cleanup and issue closure. Observations SHALL identify their execution generation, delivered-content identity when available, observation time and relevant evidence availability. A recorded approval MUST NOT imply merge completion; a forge-reported merge without verified preservation MUST NOT imply retirement is safe; completed delivery MUST NOT imply issue closure. Busy or stale observations MUST state their limits. Successful classified waits SHALL retain the native success envelope while explicitly identifying what remains incomplete. Rejected authorization, stale content, unsafe ownership, uncertain effects and unexpected defects MUST retain their native failure semantics; available committed stage evidence SHALL remain discoverable with the applicable recovery action.

#### Scenario: Approval succeeds before automatic delivery

- **WHEN** merge approval collection returns a persisted matching approval and delivery has not yet been confirmed
- **THEN** the response reports approval recorded and delivery unconfirmed or waiting with a next observation, without claiming that finalization failed or completed

#### Scenario: Merge succeeds and cleanup is blocked

- **WHEN** finish verifies a merge and subsequently finds ordinary unapproved ignored files
- **THEN** its successful classified outcome reports delivery verified, cleanup blocked and closure pending, with the same retained diagnostics available through status and ticket detail

#### Scenario: A native retirement failure follows verified delivery

- **WHEN** retirement fails for an unsafe identity or native removal error after preservation was committed
- **THEN** the native tool remains failed with its actual code and recovery guidance, and the retained delivery evidence stays visible without requiring another merge

#### Scenario: The service restarts between stage transitions

- **WHEN** a status or ticket read occurs after restart with approval and delivery receipts retained but retirement incomplete
- **THEN** the independent outcomes are reconstructed from committed evidence rather than treating the latest tool error or conversation text as the delivery outcome

#### Scenario: A status observation becomes stale

- **WHEN** delivery advances after a previous status response or the service becomes unavailable
- **THEN** subsequent available reads use newer committed evidence and cached views identify their age or unavailable freshness instead of repeating an authoritative awaiting-merge claim

#### Scenario: Preserved branch or research report has no PR merge

- **WHEN** the execution uses branch delivery or a research-only report receipt
- **THEN** its outcome describes the applicable preservation evidence without inventing a GitHub merge or human merge approval
