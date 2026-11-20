# Spec Delta

## ADDED Requirements

### Requirement: Evaluate readiness for selected work

For intake and start by issue identity, the controller SHALL evaluate the selected issues and their direct dependencies with current admission evidence. Adding unrelated issues SHALL add zero unrelated issue rows to that readiness read. Global record health, authority, capacity, and transactional claim checks SHALL still determine whether a start can proceed.

#### Scenario: Create work in a populated graph

- **WHEN** a caller creates one issue or a batch among 1,000 unrelated issues
- **THEN** each returned item carries the readiness and blockers that the complete readiness query would give it at the same committed state, with its original identity and result ordering
- **AND** the selected readiness read fetches zero unrelated issue rows and requests neither fleet closure history nor daily completion totals

#### Scenario: A remote blocker affects a selected start

- **WHEN** a different execution consumes the last applicable slot, an unrelated malformed retained record blocks admission, or the required scheduling authority becomes unavailable after the selected issue appeared eligible
- **THEN** the controller applies the current blocker and admits zero new workers for the selected issue

#### Scenario: Intake is retried after closure

- **WHEN** an identical creation request is retried after its issue closes
- **THEN** intake returns the original issue identity and retains the existing omission of readiness for closed work
