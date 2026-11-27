# Spec Delta

## ADDED Requirements

### Requirement: Complete a short scope through labeled fields

A person clarifying lightweight or research work SHALL see the known goal, acceptance criteria and constraints and be able to supply missing information through labeled fields. Validation SHALL identify incomplete fields and preserve entered values. The resulting scope SHALL retain its revision identity and captured approval policy.

#### Scenario: Only acceptance is missing

- **WHEN** a lightweight issue has a goal and constraints but no acceptance criterion
- **THEN** the form preserves the supplied values, asks for observable acceptance and permits submission without hand-authoring JSON
- **AND** a valid clarification satisfies only the scope question, with the separate approval gate honored where configured

#### Scenario: Resume an older clarification

- **WHEN** the controller resumes a previously delivered scope form or an already retained valid scope answer
- **THEN** it can collect that exact binding or use the retained contract under its original policy without duplicating the question

### Requirement: Author compact plans for human reading

New compact-plan guidance SHALL ask for a brief outcome, boundaries, consequential choices and acceptance, with short action labels in the tracked checklist. Detailed behavioral scenarios and verification evidence SHALL have an appropriate source that the plan can reference. Compact planning SHALL preserve strict validation, archive behavior and the detailed schema option.

#### Scenario: Start new compact work while an older execution is active

- **WHEN** new work selects the concise guidance and another execution already has a captured schema and template digest
- **THEN** new plans receive the revised instructions and the older execution can resume against its original schema inputs
- **AND** neither path requires a duplicate worker-authored summary or delivery document
