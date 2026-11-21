# Spec Delta

## ADDED Requirements

### Requirement: Distinguish unavailable preparation from an uncertain provider attempt

Fresh preparation for a captured definition SHALL establish its required catalog before recording an attempt. Only the owner of the durable start claim may invoke the provider. Recovery SHALL validate the recorded assignment and stage before deciding whether to return a completed capture or report uncertainty.

#### Scenario: Catalog is unavailable before a new attempt

- **WHEN** a new preparation cannot acquire the required catalog
- **THEN** it reports an unavailable prerequisite, creates no started receipt and invokes no provider
- **AND** restoring the catalog permits the same assignment identity to be prepared once

#### Scenario: A valid receipt already exists

- **WHEN** preparation finds a matching complete capture or a matching start with no recorded completion
- **THEN** recovery can reuse the complete capture without consulting a live catalog, while an existing start remains uncertain and unadmitted
- **AND** neither path invokes the provider again under that identity

#### Scenario: A completed receipt lacks its payload

- **WHEN** the stored receipt claims completion but its prepared payload is absent or its assignment binding is invalid
- **THEN** recovery preserves the receipt, reports corrupt or conflicting evidence and refuses automatic provider invocation
