# Proposal

## Why

AbraCode already has a Linux GitHub Actions workflow, but it runs on every branch push and every pull request, and formatting is not identified as a separate check. Contributors need a simple, predictable pipeline for `main` and PRs targeting `main` that reuses the project's existing validation commands.

## What Changes

- Update `.github/workflows/test.yml` in place to run on pushes to `main` and pull requests whose base is `main`.
- Keep one Ubuntu job with the pinned Node/pnpm toolchain, pnpm dependency caching, and a frozen installation including developer dependencies and lifecycle scripts.
- Add an explicitly named formatting check; retain `pnpm check` for lint, TypeScript, Effect diagnostics, and report-template checking without duplicating its subcommands.
- Retain configuration-schema consistency checking, license verification, unit/integration tests, native browser provisioning, native/installation end-to-end tests, and the plugin build. Provision reporter Playwright Chromium before its existing integration tests.
- Give steps readable names, bound the job duration, cancel superseded runs for the same PR/ref, and retain read-only repository permissions.
- Align contributor/testing documentation with the workflow's triggers and checks.

## Capabilities

### New Capabilities

- `continuous-integration`: Automatic, reproducible validation of pushes to `main` and PRs targeting `main`, with failures surfaced through a single GitHub Actions job.

### Modified Capabilities

None. Existing release-distribution requirements remain unchanged; this workflow continues running their existing checks.

## Impact

- Files: `.github/workflows/test.yml`, `CONTRIBUTING.md`, and the CI description in `docs/testing.md`.
- Reuses existing package scripts, locked dependencies, test fixtures, and browser setup. No application behavior, dependency changes, publishing, or deployment.
- Preserve the existing workflow/job identity (`test`) to reduce disruption to any external required-check configuration. Branch-protection changes are outside this proposal.
