# Spec Delta

## ADDED Requirements

### Requirement: Account for automatic communication turns explicitly

Response-only reminders, lead management and optional supervisor reasoning SHALL consume finite existing diagnostic and management/worker capacity as applicable. Manual posture SHALL admit no new automatic reminder; attended automatic and unattended postures SHALL admit one only within captured diagnostic authority. Posture changes SHALL NOT grant approval, resume, repair or delivery authority, reset recovery budgets or discard unresolved human decisions. An escalated response incident SHALL remain durable and inspectable even when no model notification budget remains.

#### Scenario: Repeated unchanged reconciliation exhausts no new turns

- **WHEN** the same unresolved response is observed repeatedly after its one reminder or budget refusal
- **THEN** no further automatic model turn is admitted and the incident still names its clearing action

#### Scenario: Manual posture observes a missing response

- **WHEN** a missing answer is verified under manual posture
- **THEN** it remains visible for explicit controller action without waking a worker automatically

#### Scenario: Required decision survives exhausted diagnostics

- **WHEN** no optional reasoning budget remains and a human-owned decision is open
- **THEN** its native form and retained decision remain available without treating diagnostic exhaustion as approval
