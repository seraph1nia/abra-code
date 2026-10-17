# Spec Delta

## Purpose

Manage GitHub PR drafts, review requests, discussion follow-through and CI reruns through explicit automation policy and recoverable controller-owned actions.

## ADDED Requirements

### Requirement: Authorize and retain outward PR actions independently

Draft publication, ready transitions, reviewer requests, public discussion replies, thread resolution and CI reruns SHALL have separately configured authority retained at execution admission. Existing projects SHALL retain final-ready publication and disable new outward automation by default. A quality profile or feedback comment MUST NOT enable these actions. Each mutation SHALL retain its exact repository, PR/head or applicable run/thread identity, policy authority, request identity, prepared payload and observed result. Unknown outcomes SHALL be reconciled before retry; ambiguous effects MUST NOT be repeated blindly. Workers and observer reads MUST NOT perform these mutations.

#### Scenario: Automatic discussion handling is disabled

- **WHEN** the Supervisor classifies and repairs a finding without public-reply authority
- **THEN** no public comment or thread mutation occurs and a manual next action remains visible

#### Scenario: Public reply response is lost

- **WHEN** a prepared reply may have been posted but its command response was lost
- **THEN** recovery inspects the exact discussion for its retained action identity and content before permitting a retry

### Requirement: Publish drafts without bypassing delivery gates

An explicitly selected draft policy SHALL support publication of an owned draft after implementation becomes idle and a stable provisional commit is retained, before final verification, independent Review and archival. The draft summary SHALL distinguish pending from completed gates. Automatic ready transitions SHALL require successful current-content verification, independent Review, full-spec archival where applicable and matching owned PR identity. A manual-ready policy SHALL retain a user-owned wait until an authorized ready action. Draft publication MUST NOT close the issue, prove final delivery, permit merge or retire the worktree. Externally changed draft state SHALL be reconciled without falsely advancing missing gates.

#### Scenario: Early draft has failing verification

- **WHEN** an owned draft exists and repository verification fails
- **THEN** the same draft is retained with pending/failed evidence and cannot be automatically marked ready

#### Scenario: Draft passes all delivery gates

- **WHEN** current verified/reviewed content has completed required archival and automatic-ready authority is enabled
- **THEN** the existing owned PR is updated and marked ready exactly once without creating another PR

#### Scenario: Human marks the draft ready early

- **WHEN** a human marks the PR ready while controller gates remain incomplete
- **THEN** the observed ready state does not substitute for verification, Review, archival or merge authorization

### Requirement: Request configured reviewers without repeated notifications

The system SHALL expose reviewer suggestions with evidence and permit requests only to explicitly configured or selected users/teams under manual or on-ready authority. It SHALL check current eligibility and existing requested/submitted review state before requesting. Repeated polls and restart MUST NOT repeatedly notify the same reviewers for the same request lifecycle. Re-request after a correction SHALL require separate policy or an explicit user action. Rejected requests SHALL retain their reason without blocking unrelated inspection or claiming a review was obtained.

#### Scenario: Configured reviewers are requested when ready

- **WHEN** an owned PR first becomes ready under on-ready reviewer authority
- **THEN** eligible configured reviewers are requested and the resulting request evidence is retained

#### Scenario: Reviewer already submitted a review

- **WHEN** reconciliation follows an uncertain request and finds the requested person's subsequent submitted review
- **THEN** it treats the request lifecycle as satisfied instead of issuing another notification

### Requirement: Reply with evidence and resolve only addressed threads

Public reply automation SHALL publish only retained, bounded content tied to a finding revision and assessed head. Automatic success replies SHALL identify the corrective commit and actual verification/Review evidence and SHALL wait until that commit is published to the owned PR. Edited feedback SHALL invalidate an unsent reply for its earlier revision. Automatic thread resolution SHALL require independently enabled authority, successful current-head corrective evidence, no unhandled comments in that thread and fresh permission to resolve it. Replies and resolution MUST remain separate receipts; neither SHALL dismiss a changes-requested review or claim a human approved the code. The system SHALL recognize its own replies and avoid responding to them in a feedback loop.

#### Scenario: Fix exists only locally

- **WHEN** a local correction has passed verification but is not yet published
- **THEN** no automatic public reply claims that the PR contains the fix and no thread is automatically resolved

#### Scenario: A reviewer adds another objection before resolution

- **WHEN** a thread receives a new substantive comment after a resolution action was prepared
- **THEN** the stale action is refused and the new revision returns to assessment

#### Scenario: Verified correction has reply and resolution authority

- **WHEN** the corrective head is published, all thread findings are addressed and current permissions permit resolution
- **THEN** the evidence-backed reply and subsequent thread resolution are recorded independently against the current thread revision

### Requirement: Retry CI with finite independent authority

GitHub Actions reruns SHALL use an explicit allowlist and finite per-execution rerun budget, independent of diagnostic and code-repair budgets. Automatic reruns SHALL require a retained eligible transient/infrastructure failure classification, the exact current PR head and a completed failed/cancelled Actions run attempt. Missing checks, advisory failures, active runs, unknown ownership, code defects and non-Actions statuses MUST NOT be automatically retried. The system SHALL prefer failed-job reruns, retain the prior and resulting attempt identities, and wait for the new attempt before diagnosis or another rerun. A rerun request MUST NOT imply CI success or reset any budget.

#### Scenario: Allowed infrastructure failure is retried

- **WHEN** a completed current-head Actions attempt matches configured retry authority and budget remains
- **THEN** one rerun is requested and the next attempt is observed without consuming a code-repair round

#### Scenario: Rerun response is uncertain

- **WHEN** the rerun request may have succeeded but no response was retained
- **THEN** the system reconciles run attempts and remains uncertain if no authoritative result is available rather than submitting another rerun blindly

#### Scenario: Repeated retry does not recover CI

- **WHEN** the allowed rerun budget is exhausted and CI still fails
- **THEN** the execution retains the failure and a diagnostic or user-needed next action without issuing another automatic rerun
