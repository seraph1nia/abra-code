# continuous-integration Specification

## Purpose

Give contributors automatic, reproducible feedback on code proposed for or pushed to the main branch through the repository's existing validation commands.

## Requirements

### Requirement: Validate main and pull requests targeting main

The repository SHALL run its CI workflow for pushes to `main` and for pull requests opened, reopened, or updated with `main` as their base branch. Pushes to other branches and pull requests targeting other branches MUST NOT trigger this workflow.

#### Scenario: Main receives a push

- **WHEN** a commit is pushed to `main`
- **THEN** the CI validation job runs for that push

#### Scenario: Pull request targets main

- **WHEN** a pull request targeting `main` is opened, reopened, or updated
- **THEN** the CI validation job runs for the pull request's current revision

#### Scenario: Work targets another branch

- **WHEN** a branch other than `main` receives a push or a pull request targets another base branch
- **THEN** that event does not start this workflow

### Requirement: Reproduce installation and contributor checks

CI SHALL install the workspace on Linux with the project's pinned Node and pnpm versions using its frozen lockfile, including developer dependencies and required installation lifecycle scripts. CI SHALL check formatting, linting, TypeScript types, Effect diagnostics, report-template types, configuration-schema consistency, license evidence, unit/integration tests, native/installation end-to-end tests, and the plugin build. A failed installation or check MUST fail the job; formatting and lint checks MUST NOT automatically rewrite committed files to conceal failures.

#### Scenario: Clean checkout passes validation

- **WHEN** the frozen installation and every required check succeed on a clean checkout
- **THEN** CI reports a successful validation job

#### Scenario: Validation fails

- **WHEN** installation, formatting, linting, type checks, schema consistency, license verification, tests, or build fails
- **THEN** CI reports a failed job with the failing step identifiable in its logs

#### Scenario: Lockfile does not match manifests

- **WHEN** package manifests require a dependency resolution different from the committed lockfile
- **THEN** the frozen installation fails rather than updating the lockfile

### Requirement: Run isolated checks with bounded resources

CI SHALL run checks with read-only repository permissions and no personal provider or forge credentials. Reporter Playwright Chromium prerequisites SHALL be provisioned before unit/integration tests execute, and end-to-end browser prerequisites SHALL be provisioned before native browser acceptance executes. Test repositories and pushes SHALL remain disposable and local. The job SHALL have a finite timeout, and a newer run for the same pull request or branch ref SHALL cancel a superseded run without canceling runs for unrelated refs.

#### Scenario: Reporter integration checks run on a fresh runner

- **WHEN** CI reaches unit/integration tests on a fresh runner
- **THEN** the reporter's pinned Playwright Chromium and required system libraries are available for its existing integration tests

#### Scenario: End-to-end checks run on a fresh runner

- **WHEN** CI reaches native/installation end-to-end tests
- **THEN** browser prerequisites and locally installed CLIs are available and tests use local model fixtures and disposable repositories

#### Scenario: Another revision supersedes a run

- **WHEN** a new run starts for the same PR or branch ref while an earlier run remains active
- **THEN** the earlier run is canceled and unrelated PR/ref runs are unaffected

#### Scenario: A command hangs

- **WHEN** validation exceeds the configured job timeout
- **THEN** GitHub Actions terminates the job rather than allowing unbounded execution

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
