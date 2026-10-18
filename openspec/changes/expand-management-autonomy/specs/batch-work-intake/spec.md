# Spec Delta

## ADDED Requirements

### Requirement: Commit delegated intake and budget usage together

Delegated task creation SHALL use ordinary atomic batch validation, dependency resolution and stable request identities. Admission SHALL atomically bind the accepted batch/items to the exact authorizing lead registration and grant revision, enforce and consume the grant's remaining new-task allowance and retain provenance in the existing work graph. Invalid scope, dependency, policy, grant or budget SHALL leave neither partial work nor partial usage. A retry after commit/receipt loss SHALL return the original mapping and usage without creating tasks or charging the grant again; changed content or authority binding under the same identity SHALL be refused. Revoked authority SHALL never admit a new batch; an authorized read of an already committed receipt SHALL remain distinguishable from a new mutation. Lead-scoped dependency references SHALL identify authorized existing issues or local items without cross-project disclosure.

#### Scenario: Commit succeeds before lead receipt is saved

- **WHEN** the work graph commits a delegated batch and usage but the process dies before its lead-facing receipt is saved
- **THEN** an identical authorized lookup/retry reconstructs the original mapping and one budget debit after restart

#### Scenario: Batch is larger than remaining budget

- **WHEN** a valid batch contains more tasks than the grant permits
- **THEN** the entire transaction fails and neither tasks nor usage are partially committed

#### Scenario: Duplicate request follows grant revocation

- **WHEN** an authorized controller inspects a previously committed delegated request after its grant was revoked
- **THEN** the historical receipt and provenance remain available without authorizing new task creation or another debit

#### Scenario: Dependency falls outside lead scope

- **WHEN** a delegated task references an existing issue outside the grant's repository scope
- **THEN** admission fails atomically without disclosing unrelated project evidence
