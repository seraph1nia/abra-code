# Spec Delta

## ADDED Requirements

### Requirement: Retained updates preserve independently committed changes

Each execution update SHALL identify its owned changes and applicable revision, generation and operation. A stale replacement MUST be rejected without mutation; a permitted scoped update SHALL apply to current retained state and preserve independently committed fields, including field deletion. Concurrent controllers MUST enforce the same contract across processes.

#### Scenario: Stale replacement follows a newer update

- **WHEN** an execution is read, newer retry instructions are committed, and the older execution is submitted with an unrelated error update
- **THEN** the stale replacement is refused or its explicitly owned error update preserves the newer instructions
- **AND** no unowned field is restored or deleted by the stale value

#### Scenario: Independent obligations change during finishing

- **WHEN** a decision is committed while another operation prepares finishing evidence
- **THEN** committing that finishing evidence preserves the decision and any other independently committed evidence

#### Scenario: Update crosses a control boundary

- **WHEN** pause, replacement or another control action changes the applicable generation or operation before a prepared update commits
- **THEN** the prepared update is rejected without changing the new owner's state or admitting another side effect

#### Scenario: Two processes update distinct evidence

- **WHEN** independent processes concurrently update permitted disjoint execution fields
- **THEN** the committed result retains both changes or reports an explicit conflict requiring a fresh update without silently losing either committed value

### Requirement: Refactoring retains evidence and immutable identities

Internal restructuring SHALL preserve supported stored identities, approval bindings, captured policy and schema evidence, histories, uncertain effects, unknown additive evidence and original legacy records. New update interfaces MUST enforce the existing append-only and immutable-evidence rules. Unsupported data MUST remain preserved and unavailable for mutation.

#### Scenario: Existing execution resumes after upgrade

- **WHEN** an installation upgrades while work has a pending approval, uncertain admission, external custody or incomplete cleanup
- **THEN** restart retains those exact obligations and identities without replay, fabricated historical evidence or new authorization

#### Scenario: Scoped update attempts to rewrite history

- **WHEN** a scoped write removes a prior reply, changes captured report inputs or replaces an immutable approval or publication identity
- **THEN** validation rejects the write and preserves the original record

#### Scenario: Future additive evidence is retained

- **WHEN** a compatible record containing unrecognized additive evidence receives a supported owned-field update
- **THEN** that evidence remains intact according to the supported compatibility decoder rather than being silently discarded

### Requirement: Boundary projections retain typed meaning

Application boundaries SHALL validate their fixed operation inputs and outputs from owned contracts. Browser, native and saved-document projections SHALL retain intentional bounds, omissions, brands, timestamp meaning and classified failures. Internal restructuring MUST NOT expose an arbitrary native operation proxy or accept additional mutation authority.

#### Scenario: One resource crosses native and browser transports

- **WHEN** an owned task, decision or artifact is projected through both supported transports
- **THEN** its identities and consumed fields agree while documented browser bounds and excluded private fields remain enforced

#### Scenario: Malformed operation reaches a typed boundary

- **WHEN** a request contains an invalid selection, unsupported operation or forbidden extra field
- **THEN** the existing declared failure contract rejects it before native mutation or foreign-resource access

#### Scenario: Controlled clock supplies a new adapter receipt

- **WHEN** the supplied clock advances and an adapter generates a new receipt or observation timestamp
- **THEN** the new time uses that clock while existing retained and native timestamps keep their original meaning
