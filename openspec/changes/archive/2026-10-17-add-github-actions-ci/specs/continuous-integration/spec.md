# Spec Delta

## Purpose

Give contributors automatic, reproducible feedback on code proposed for or pushed to the main branch through the repository's existing validation commands.

## ADDED Requirements

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
