# typed-contracts Delta

## ADDED Requirements

### Requirement: Planning evidence has validated immutable provenance

Baseline, recovery and adoption records SHALL use versioned validated contracts binding their exact content, identities, generation and control intent. Owned writes MUST preserve immutable snapshots, prior approvals, violation history and independent updates. Incomplete, conflicting, unavailable or future evidence MUST remain preserved and unavailable for unsafe mutation. A content digest MUST NOT be interpreted as recoverable historical bytes.

#### Scenario: Stale baseline result is committed

- **WHEN** capture finishes after its execution generation, operation or applicable record ownership changed
- **THEN** persistence rejects the stale result without overwriting newer decisions, pause state, baseline evidence or history

#### Scenario: An update attempts to rewrite a failed attempt

- **WHEN** a write replaces a captured source tree, removes a prior violation or changes original approval/adoption bindings
- **THEN** validation refuses that rewrite and retains the previous record

#### Scenario: A legacy error alleges a source edit without a retained baseline

- **WHEN** a historical old-base error misattributes retained Apply source to formatting-only Explore
- **THEN** the original allegation/error remains preserved without being upgraded into proof of worker source mutation or reconstructed historical content

#### Scenario: Retained source objects are missing

- **WHEN** a baseline record names content whose reconstructable objects or retention binding are unavailable
- **THEN** planning and historical recovery remain stopped with an actionable diagnostic rather than recapturing current files

### Requirement: Legacy planning records retain their original meaning

Recognized legacy records SHALL remain readable without invented baseline or authorization evidence, changed identity, captured policy or approval history. Initial Explore SHALL retain its applicable legacy boundary. A controlled replan lacking a valid attributable baseline MUST fail closed or use explicitly authorized prospective recovery. Read compatibility MUST NOT be represented as permission for old writers to mutate new-format attempts.

#### Scenario: Legacy replan has dirty source and no baseline

- **WHEN** an older stranded controlled-planning execution lacks reconstructable attributable pre-Explore content
- **THEN** loading or retrying it neither synthesizes a baseline nor treats its current source as historically authorized

#### Scenario: Initial Explore has no controlled baseline

- **WHEN** a supported initial planning execution lacks the new optional evidence
- **THEN** its existing trusted base and outside-change guard remain enforced

#### Scenario: A compatible record contains additive unknown evidence

- **WHEN** a supported scoped update adds planning evidence to a retained record
- **THEN** unknown additive evidence, legacy originals, captured schema/policy, session/worktree IDs and historical receipts remain preserved

#### Scenario: Older code reads new evidence

- **WHEN** a prior supported reader inspects a compatible record containing a controlled baseline attempt
- **THEN** historical data remains readable under its documented limits and mutation requires a compatible tested controller rather than an inferred safe downgrade

### Requirement: Adoption targets do not weaken other authority contracts

Pre-delivery adoption SHALL have a distinct exact target and native authorization binding. Existing plan/merge, finishing-publication adoption and external-run custody contracts MUST retain their required evidence. Worker and historical-worker sessions MUST remain unable to authorize adoption. Supported observer/form projections SHALL preserve target identity without introducing arbitrary native operations or new UI authority.

#### Scenario: Finishing adoption has no publication

- **WHEN** a caller supplies pre-delivery evidence to an existing publication-adoption contract
- **THEN** its publication requirement remains enforced and only the distinct guarded pre-delivery operation can offer prospective planning adoption

#### Scenario: Worker attempts authorization

- **WHEN** an active or historical managed worker attempts to answer/consume an adoption authorization
- **THEN** the operation is refused without creating authority or advancing the execution

#### Scenario: Native form refers to another target

- **WHEN** form metadata, decision identity, session or exact content binding does not match the retained adoption target
- **THEN** the answer cannot be collected as valid authorization

### Requirement: Controller activation preserves retained work

Activation of baseline-aware code SHALL require an exact independently reviewed/tested candidate, actual applicable user authorization, identified running installation and confirmed writer quiescence. Consistent retained-record export, native inventory, source objects/evidence and SQLite backup SHALL be preserved and restoration tested. Workers MUST NOT restart, reload or install into the operator service during planning or disposable verification.

#### Scenario: Source is edited but the service is already running

- **WHEN** an owned repair worktree contains the new implementation
- **THEN** no claim is made that the running controller has changed and activation remains a separate authorized operator stage

#### Scenario: Running installation or quiescence is unknown

- **WHEN** source/plugin/executable/configuration identity or native writer stop cannot be confirmed
- **THEN** activation remains blocked with its exact operator-owned prerequisite while all work and current settings remain retained

#### Scenario: Rollback would discard later evidence

- **WHEN** new-format attempts or subsequent work/effects exist after the pre-upgrade backup
- **THEN** rollback cannot restore that backup or enable incompatible writers as a shortcut and compatible forward recovery remains required

#### Scenario: An unrelated issue is paused during maintenance

- **WHEN** backup, activation rehearsal or explicit later recovery concerns another execution
- **THEN** the paused issue's claim, resources, policy, identities, obligations and pause remain intact without automatic capacity or configuration changes
