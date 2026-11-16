# Spec Delta

## ADDED Requirements

### Requirement: Focused feedback preserves complete acceptance coverage

Contributors SHALL have a documented fast test tier that needs no browser, native service, remote credentials or repository lifecycle. Required full checks SHALL retain integration, native, installation and browser acceptance coverage after test reorganization. Dependency-aware checks MUST include affected shared packages and consumers; a focused pass MUST NOT be reported as complete acceptance.

#### Scenario: Contributor changes a pure projection

- **WHEN** the documented fast tier runs in the supported installed toolchain without browser or native-service prerequisites
- **THEN** its pure and in-memory behavior checks complete without launching those resources

#### Scenario: Shared contract changes

- **WHEN** validation selects work affected by a shared package change
- **THEN** the owning package and affected application/runtime consumers are checked rather than treating the shared package as an isolated leaf

#### Scenario: Test suite is reorganized

- **WHEN** behavior tests move between fast, integration and native tiers
- **THEN** the full validation commands continue to execute every required behavioral scenario and any failures retain a nonzero result

### Requirement: Measure synchronization and rendering costs reproducibly

Verification SHALL record revision, toolchain, fixture population, command scope and comparable before/after measurements for resource reads, emitted/refetched state, initial browser assets and export preparation. It SHALL distinguish deterministic call counts from real latency. Performance checks MUST NOT pass by omitting supported features, moving eager bytes between chunks or excluding required work.

#### Scenario: Task detail is measured among unrelated active work

- **WHEN** the task-read fixture increases unrelated retained issues and native workers
- **THEN** measurements show no unrelated native-session or lead observations and no fleet-readiness pass for the selected task

#### Scenario: Initial browser load is compared

- **WHEN** a production build is compared with its recorded baseline using identical fixture and compression settings
- **THEN** all initially requested scripts and modulepreloads are included and deferred capability behavior is exercised separately

#### Scenario: Export preparation is measured

- **WHEN** multiple saved documents use one renderer identity
- **THEN** measurements distinguish shared application preparation from document-specific diagram preparation and prove that later exports do not compile another application

#### Scenario: History benchmark is retained

- **WHEN** communication or query boundaries are restructured
- **THEN** the existing 35 communication distributions retain their bounded native-read behavior with fixture limitations stated

### Requirement: Final refactor evidence matches retained source

Acceptance evidence SHALL identify the final source and required check results, exercise disposable native/browser restart and offline-export journeys, and retain named evidence outside removed fixture resources. Prior review results or deleted scratch screenshots MUST NOT stand in for final proof. No test SHALL push to user remotes, restart the operator service or silently use a paid provider.

#### Scenario: Final checks follow staged implementation

- **WHEN** all planned refactor stages are implemented on a frozen source revision
- **THEN** the required check, unit/integration, end-to-end, build, configuration-schema and licensing results are recorded for that source

#### Scenario: Disposable journey finishes cleanup

- **WHEN** native and browser fixtures remove their owned installations and processes
- **THEN** retained results and named desktop/narrow-screen screenshots remain accessible outside those removed resources with cleanup status recorded

#### Scenario: Prerequisite is unavailable

- **WHEN** an acceptance journey cannot run because a required browser or local tool is absent
- **THEN** evidence identifies the missing prerequisite and the journey remains unverified instead of using prior source results or substituting another provider
