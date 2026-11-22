# Spec Delta

## ADDED Requirements

### Requirement: Retain captured worker tool eligibility across projections

Managed worker session permissions, model tool visibility and execution-time tool checks SHALL honor the same tool eligibility for a captured role profile. Historical captures SHALL keep their original permissions when the current role gains a tool. Authored denials and contribution restrictions SHALL apply alongside current assignment, phase and resource checks.

#### Scenario: A Review capture predates the review changes tool

- **WHEN** a Review session resumes with a supported captured profile that predates `abra_review_changes`
- **THEN** native session permissions retain the historical restriction, the tool is absent from model context, and an execution request for it is refused.
- **AND** a current Review profile that permits the tool can use it subject to its ordinary assignment and resource checks.

#### Scenario: A profile contains contributions and authored denials

- **WHEN** a contribution declares an allowed read action and the capture permits both the contribution ID and its action
- **THEN** the active worker can see and request it only within the native resource grant.
- **WHEN** an authored denial covers the ID or its action
- **THEN** the tool is unavailable to that profile and a direct execution request is refused, including after session recovery.
