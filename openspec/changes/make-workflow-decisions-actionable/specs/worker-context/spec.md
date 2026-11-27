# Spec Delta

## ADDED Requirements

### Requirement: Distinguish applicable decisions from historical answers

A fresh assignment SHALL identify the accepted contract and applicable decisions with their scope and generation. A carried-forward answer SHALL identify its origin and applicability to the current contract. Conflicting or superseded history SHALL stay inspectable without being presented as current instructions. Exact retries SHALL retain their original captured inputs.

#### Scenario: A revised contract changes an earlier answer

- **WHEN** generations one and two answer the same question differently and a new Apply starts for generation two
- **THEN** the assignment identifies the governing answer and its provenance
- **AND** if the conflict cannot be resolved from the accepted contract and recorded decisions, the ambiguity is surfaced before dependent work proceeds

#### Scenario: Retry an already admitted message

- **WHEN** recovery reconciles an existing request after a new decision or a prompt-format change
- **THEN** its captured text, request identity, admission and response obligations keep their original meaning
- **AND** fresh lightweight and research assignments refer to their short contracts and applicable evidence without full-spec authoring instructions
