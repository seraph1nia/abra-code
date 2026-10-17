# Spec Delta

## MODIFIED Requirements

### Requirement: Validate worker selection at its native location

Before admitting a new worker prompt, the system SHALL resolve its configured or inherited agent and model against the native inventory at the assigned worktree location, validate model tool capability and required skills, and reject required tools outside its authoritative role policy. Actual required tool availability SHALL additionally be checked against the effective tools before the worker's provider request. A missing selection, unavailable skill or incompatible capability SHALL produce an actionable location-specific configuration blocker without silently substituting an agent, model, provider or skill or widening permissions. If inventory is unavailable, admission SHALL retain its intent and identity for a later explicit or ordinary eligible recovery rather than optimistically submitting the prompt. Recovery of an already admitted prompt SHALL observe native inbox/transcript evidence before treating current inventory drift as a reason to submit again; request-time authorization SHALL continue to apply.

#### Scenario: Configured agent does not exist in the worker location

- **WHEN** a configured worker agent exists centrally but is absent from the assigned worktree's native inventory
- **THEN** the controller reports the location-specific selection error before submitting the worker prompt and preserves owned resources and recovery identities

#### Scenario: Selected model cannot execute required tools

- **WHEN** the resolved model inventory declares that the selected model lacks tool capability required by the worker role
- **THEN** admission is blocked with a specific capability diagnostic and no alternative model is selected automatically

#### Scenario: Valid inventory does not prove provider availability

- **WHEN** an inventory-valid selection later encounters a provider or credential failure
- **THEN** normal native failure observation and the existing explicit retry policy apply without treating preflight as provider-success evidence

#### Scenario: Required skill is unavailable at the assigned location

- **WHEN** worker selection is valid but a required skill cannot be resolved at the worker location
- **THEN** admission stops before prompt submission with the requirement source and clearing action while preserving the issue claim, worktree and retry identity

#### Scenario: Effective tool availability differs from preflight

- **WHEN** the worker prompt has been admitted but the actual request lacks every alternative in a required tool group
- **THEN** the provider request is blocked with a retained capability diagnostic without substituting tools or granting a wider role

#### Scenario: Inventory changes after uncertain successful admission

- **WHEN** native inbox/transcript evidence proves the retained prompt was already admitted and current inventory has changed
- **THEN** recovery recognizes the existing admission without replaying it and subsequent request-time checks retain their normal authority
