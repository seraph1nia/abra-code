# Spec Delta

## ADDED Requirements

### Requirement: Select independent proposal review at intake

For new full-spec work, Abra SHALL retain the Supervisor's selection of consequential proposals and honor an explicit user request for review at intake. Selection SHALL survive restart and remain independent of schema choice and human plan approval.

#### Scenario: User requests review on a normally automatic change

- **WHEN** a user requests review for full-spec work with optional plan approval
- **THEN** the selected execution waits for the proposal review outcome before Apply
- **AND** unselected or historical executions acquire no new review obligation

### Requirement: Obtain a fresh reading of an exact proposal

The controller SHALL admit an independent read-only reviewer for the selected plan revision before Apply. Its task-specific input SHALL be the exact written proposal and the review question. The reviewer SHALL explain the goal, boundaries and observable success from the proposal alone, then may inspect cited project evidence. Its retained report SHALL identify its source, its reading, and any material findings, evidence and decisions needed.

#### Scenario: Reader finds an assumption absent from the draft

- **WHEN** a rationale exists only in the author's conversation
- **THEN** the fresh session receives neither that conversation nor author summaries, earlier reviews or task-specific memory
- **AND** it can record the gap and cite a contradictory scenario without editing repository files or advancing work

#### Scenario: No material finding

- **WHEN** a current reviewer returns its reading with zero material findings
- **THEN** review completes for that revision and the existing plan policy determines the next step

#### Scenario: Findings have different owners

- **WHEN** a current report identifies both editorial feedback and an unresolved product decision
- **THEN** the planner receives the feedback and the human decision goes through the existing decision flow before Apply
- **AND** a changed plan goes through its configured approval and fresh review

### Requirement: Recover proposal review by revision

An unavailable selected review SHALL leave Apply pending until retry succeeds or a human explicitly continues for the current revision. Continue SHALL settle only the unavailable review. The controller SHALL preserve all other outstanding decisions, approval requirements and post-implementation checks.

#### Scenario: Restart after uncertain dispatch or report submission

- **WHEN** the controller resumes an uncertain attempt for the same revision
- **THEN** it reconciles retained admission and report evidence without duplicating the reviewer, findings, or decisions

#### Scenario: Retry or continue when review is unavailable

- **WHEN** a human retries the current unavailable review
- **THEN** the reviewer can run again and the change remains pending until it returns or the human explicitly continues
- **WHEN** the human explicitly continues
- **THEN** the recorded outcome identifies the revision and the human choice, and normal plan-approval policy still applies

#### Scenario: Superseded result or decision

- **WHEN** a result or continue request for plan A arrives after plan B supersedes it
- **THEN** it cannot satisfy review or authorize Apply for B, which has its own review

#### Scenario: Only the task checklist changed

- **WHEN** the execution's accepted planning inputs change the whole-plan fingerprint even though the proposal text is identical
- **THEN** the new plan requires fresh review, while a restart or generation rotation with the same fingerprint reuses the completed review and validates actions against current authority
