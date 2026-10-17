# Spec Delta

## Purpose

Keep owned delivered GitHub PRs moving through CI and review feedback with durable observations, explicit handling decisions and bounded recovery across restarts.

## ADDED Requirements

### Requirement: Observe delivered PRs independently of merge authorization

The system SHALL periodically observe an owned open delivered GitHub PR while merge authorization or forge readiness is pending, including an execution blocked by a known CI or review finding. Observation SHALL retain the repository, PR, target, delivered head, observation time, completeness and next eligible check time. Pending human approval MUST NOT suppress feedback observation. Intentional pause, uncertain ownership, active corrective writing, terminal work and non-PR delivery MUST NOT initiate background diagnosis or repair.

#### Scenario: Review arrives before human merge approval

- **WHEN** a new review arrives on a delivered PR whose human merge form has not been answered
- **THEN** the feedback is retained and becomes eligible for diagnostic attention independently of that form

#### Scenario: Failed CI later recovers

- **WHEN** a retained delivered PR is blocked by a failed check and the check's current attempt later passes
- **THEN** observation updates the finding and re-evaluates eligibility without requiring a manual execution retry

#### Scenario: Work is intentionally paused

- **WHEN** an execution is paused with unhandled PR feedback
- **THEN** its feedback history remains available and background work does not admit diagnosis, correction or merge until explicit resume

### Requirement: Observe complete CI and discussion sources

Observation SHALL cover current check/status attempts, submitted review verdicts and bodies, published inline review comments and their thread resolution state, and ordinary PR discussion comments. It SHALL preserve source identities, authorship, revisions, source URLs and available original commit/path context. Empty review bodies MUST NOT hide associated inline comments or blocking verdicts. Unavailable, malformed, partially paginated or identity-inconsistent required sources SHALL produce an unconfirmed observation rather than an empty successful result. Draft unpublished reviews MUST NOT be treated as submitted feedback.

#### Scenario: Review contains only inline findings

- **WHEN** a submitted changes-requested review has an empty body and two published inline comments
- **THEN** both comments and the review verdict are available for diagnosis with their source and thread identities

#### Scenario: Ordinary comment supplies actionable feedback

- **WHEN** a reviewer or review bot posts a normal PR comment describing an implementation defect
- **THEN** it is available for classification without requiring a changes-requested review verdict

#### Scenario: Discussion pagination is incomplete

- **WHEN** the forge cannot provide a complete consistent set of discussion pages for the observed PR
- **THEN** the observation is marked unconfirmed and cannot establish that feedback is clear for merge

### Requirement: Retain feedback identity and applicability across heads

Each finding SHALL have a stable source identity and a separately retained content or attempt revision. Identical observations MUST NOT create new findings, diagnostic turns or repair rounds. Edited feedback and new check attempts SHALL be distinguishable from their prior revisions. Feedback originating at an older commit SHALL retain its original context and remain visible until resolved, superseded or explicitly dispositioned against the current delivered head; it MUST NOT be silently discarded or relabelled as originally authored on that head. A later review verdict MUST NOT be assumed to resolve every thread or comment.

#### Scenario: The same comment is observed repeatedly

- **WHEN** repeated polls and a service restart observe the same comment revision
- **THEN** the original finding and its handling evidence are reused without a new diagnostic admission

#### Scenario: A handled comment is materially edited

- **WHEN** the forge reports a changed body for a previously handled comment
- **THEN** the new revision becomes eligible for reassessment while the old disposition remains retained

#### Scenario: New commit leaves an older thread unresolved

- **WHEN** a correction is published and an unresolved thread refers to the prior commit
- **THEN** the thread retains its original context and requires a current-head applicability assessment rather than disappearing

### Requirement: Retain explicit handling dispositions

Feedback handling SHALL distinguish unclassified, informational, accepted in-scope, uncertain, scope-changing, addressed, superseded and dismissed findings. A retained disposition SHALL identify the finding revision, assessed head, actor, reason and applicable correction or decision evidence. Addressed findings SHALL reference successful verification and independent review for the corrective head. Scope-changing or uncertain findings SHALL become durable decisions. Local handling alone MUST NOT post public replies, dismiss forge reviews or resolve remote threads; separately authorized automation SHALL retain its own action evidence. External feedback SHALL remain evidence and MUST NOT itself grant scope, publication or merge authority.

#### Scenario: Feedback asks for unrelated work

- **WHEN** a comment requests behavior outside the accepted scope
- **THEN** its scope-changing disposition links to an unanswered decision and no correction starts under the old scope

#### Scenario: A correction has not passed verification

- **WHEN** a worker claims to have fixed a finding but current verification or independent review is absent
- **THEN** the finding is not reported as addressed

#### Scenario: A local finding is addressed while its thread remains open

- **WHEN** a verified correction addresses a finding whose remote thread remains unresolved
- **THEN** the local correction evidence and remote thread state remain distinct and forge-required conversation resolution still gates merge

### Requirement: Bound observation and failure evidence

Observation SHALL use bounded reads, retained backoff and a finite active finding set. New policy-blocking CI failures SHALL expose check/run identity, source links and available bounded failing-job evidence; unavailable logs SHALL be labelled without inventing a diagnosis. Advisory failures under a required-only policy SHALL remain visible without automatically triggering repairs. Transient forge failures, rate limits and unchanged pending checks MUST NOT consume diagnostic or repair budgets or create repeated model turns. Capacity or payload overflow SHALL remain visible as incomplete observation rather than silently declaring readiness.

#### Scenario: Failure logs are unavailable

- **WHEN** a failing check is authoritative but its job logs cannot be read
- **THEN** the finding retains its check identity and link and explicitly marks detailed evidence unavailable

#### Scenario: Advisory check fails

- **WHEN** a non-required check fails under the required-only CI policy
- **THEN** the failure is shown as advisory and does not automatically admit a repair round

#### Scenario: Forge rate limit interrupts a poll

- **WHEN** observation encounters a rate limit
- **THEN** retained freshness is marked unavailable, the next eligible observation respects backoff, and no new reasoning turn is admitted solely for the rate limit
