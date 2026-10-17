# Spec Delta

## ADDED Requirements

### Requirement: Admit PR feedback attention independently of routine waits

New substantive PR feedback or a newly policy-blocking CI failure SHALL create a durable diagnostic batch eligible independently of ordinary merge-approval and forge-readiness waits. The system SHALL persist its execution generation, observed head, finding revisions and native admission identity before prompting the retained Supervisor. Unchanged findings and repeated events MUST NOT create duplicate admissions. The existing finite diagnostic and attention-capacity budgets SHALL apply; exhausted diagnosis SHALL become a visible user-needed decision without resetting budgets when a head changes. Intentional pause and uncertain ownership SHALL prevent admission. Diagnostic admission MUST NOT itself authorize a repair, public reply or lifecycle checkpoint.

#### Scenario: PR awaits approval when feedback arrives

- **WHEN** substantive feedback arrives while a human merge decision is pending and diagnostic budget remains
- **THEN** one diagnostic batch is admitted without consuming, answering or replacing that merge decision

#### Scenario: Process stops after native admission

- **WHEN** a feedback prompt was admitted but the service stopped before persisting its admission result
- **THEN** recovery reuses the original prompt identity and batch rather than submitting a second independent diagnostic turn

#### Scenario: No diagnostic budget remains

- **WHEN** new actionable feedback arrives after the execution's diagnostic budget is consumed or configured as zero
- **THEN** the findings remain visible with a user-needed decision and no additional model turn is silently granted

#### Scenario: More feedback arrives during diagnosis

- **WHEN** another finding revision arrives while an earlier diagnostic batch is admitted
- **THEN** the additional feedback is retained for a subsequent bounded batch without mutating the first batch's identity or admitting simultaneous conflicting correction writers
