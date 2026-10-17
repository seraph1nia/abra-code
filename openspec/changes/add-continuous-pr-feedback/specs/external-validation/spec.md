# Spec Delta

## Purpose

Use no-mistakes as an optional external validation engine while retaining OpenCrew's scope, exclusive writer ownership, native evidence gates and controller-owned publication.

## ADDED Requirements

### Requirement: Select and validate the external engine explicitly

Coding projects SHALL be able to select native validation or the optional no-mistakes engine independently of quality profile and merge authority. The external selection, executable/protocol compatibility, finite run/fix limits and integration-owned skipped stages SHALL be snapshotted per execution. A missing, incompatible, uninitialized or unavailable engine SHALL block only explicitly selected external validation and MUST NOT silently fall back to native validation. Initialization or repair of external gate configuration SHALL require an explicitly authorized central setup action. Reading or planning an integration MUST NOT start or alter a real external run.

#### Scenario: Engine is not installed

- **WHEN** no-mistakes is selected but its supported executable is unavailable
- **THEN** the execution retains a configuration blocker while native-only projects remain usable

#### Scenario: Existing project has no engine setting

- **WHEN** a legacy project is loaded after upgrade
- **THEN** it retains native validation without starting an external daemon or installing repository hooks

### Requirement: Retain exclusive external branch custody

Before starting external validation, the controller SHALL retain an idle owned worktree, a clean implementation commit, accepted intent/scope, execution generation and launch identity. While an external run owns the branch, native Apply, publication, correction and cleanup MUST NOT write to or replace that branch. The integration SHALL omit external rebase, push, PR and CI-monitor stages so the pinned base, publication authority and CI automation remain controller-owned. External fixes SHALL retain their exact resulting head and custody evidence; a successful process exit or agent statement MUST NOT prove custody return or validation success.

#### Scenario: Native correction is requested during external validation

- **WHEN** the external engine still owns an active run for the branch
- **THEN** the controller refuses a concurrent corrective writer and retains the external run's gate or progress state

#### Scenario: Pipeline fixes change the implementation head

- **WHEN** external validation fixes code and returns a supported result
- **THEN** the controller adopts only the verified preserved head through the engine's offered guarded synchronization and retains every pipeline fix commit

### Requirement: Drive finite external gates through retained decisions

The integration SHALL decode supported machine-output records, bind them to the saved run/launch/generation and expose progress, gates, findings and outcome without treating an elapsed wait as failure. New runs and responses SHALL be controller-owned and durably prepared. Mechanical in-scope fixes SHALL obey snapshotted finite external limits. Findings that challenge accepted scope, protected paths or verification requirements SHALL require a matching explicit decision. Blanket yes/skip behavior MUST NOT derive from quality profile, repair authority or merge autonomy. An uncertain gate response SHALL be reconciled from exact run/step state before any further response.

#### Scenario: External run parks for a scope decision

- **WHEN** the external engine reports a finding that changes accepted product intent
- **THEN** a durable user-owned decision is surfaced and no generic approve, skip or unattended-yes response answers it

#### Scenario: External response is lost

- **WHEN** an answer may have advanced a gate but the response was not retained
- **THEN** the controller inspects the saved run and current step before sending another answer and cannot accidentally answer the next gate

#### Scenario: Run hold expires without an outcome

- **WHEN** a supported bounded wait returns while the external run remains active
- **THEN** the controller retains the same run identity and continues bounded observation without restarting the run or consuming a new run budget

### Requirement: Reverify adopted external results before delivery

An external validation receipt SHALL retain submitted/adopted heads, run identity, intent digest, gate decisions, configured stage exclusions and actual outcome. Adoption SHALL require the engine's explicit custody/synchronization proof and matching local/remote ownership. After adoption, configured repository verification and independent native Review SHALL run against the resulting content before required archival and delivery. Expected integration stage exclusions SHALL be distinguished from unauthorized skipped checks or accepted overrides. No external outcome SHALL authorize merge, close work or replace preservation evidence.

#### Scenario: External engine reports checks passed

- **WHEN** the external engine reports success with the integration-owned stage exclusions
- **THEN** OpenCrew records that result and still requires its own current verification, independent Review, archival and merge authorization

#### Scenario: Pipeline result contains an unexpected override

- **WHEN** the outcome includes skipped validation stages or overrides outside the integration contract
- **THEN** the controller requests a decision and does not record ordinary successful validation

### Requirement: Recover external runs without resource loss

Restart SHALL reconcile the original external run, branch custody and launch receipt before retrying any start, response, abort, synchronization or cleanup action. Pausing an execution SHALL suppress further automatic external gate answers without implying the external process has stopped; it SHALL expose whether external execution is still active. Cancellation and invalidating scope changes SHALL retain supported abort confirmation and guarded custody recovery before native writing or retirement. The controller MUST NOT delete external-owned worktrees, discard preserved fixes, restart a shared daemon or rewrite gate records as a recovery shortcut.

#### Scenario: Service restarts during a live run

- **WHEN** OpenCrew restarts while the external engine is working
- **THEN** it reconnects to the retained run and branch instead of creating another run or replacing the native execution

#### Scenario: Pause arrives during external work

- **WHEN** a user pauses an execution whose external process is still running
- **THEN** further controller answers stop, actual external liveness remains visible and the branch is not released to another writer without custody confirmation

#### Scenario: User invalidates the accepted scope

- **WHEN** an explicit scope change makes the active external run obsolete
- **THEN** the controller confirms supported termination and custody return before revising implementation and retains the obsolete run's evidence
