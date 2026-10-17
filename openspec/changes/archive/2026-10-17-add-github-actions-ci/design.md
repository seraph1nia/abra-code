# Design

## Context

See `proposal.md` for motivation. `.github/workflows/test.yml` already contains a single `test` job on `ubuntu-latest`, read-only contents permissions, pinned Node 24.21.0, pnpm setup, a pnpm store cache, frozen installation, schema/license checks, static checks, tests, browser provisioning, and build. Its triggers are currently unrestricted `push` and `pull_request`.

`package.json` declares pnpm 11.28.5; `mise.toml` pins the same pnpm and Node versions. `prepare` patches TypeScript and Oxlint through Effect tooling. `pnpm check` composes Vite+ checks, TypeScript, Effect lint/diagnostics, and report-template type checking. `pnpm format:check` already provides a standalone formatting check. `pnpm config:schema` compares the committed schema without writing it unless `--write` is passed.

The native and installation tests use a disposable source installation with an offline copy from the pnpm store, a real local OpenCode server, a local model fixture, and local bare Git remotes. Native browser acceptance requires `pnpm browser:install --with-deps`. The installation test also uses the Linux `script` utility supplied by the Ubuntu runner.

## Goals / Non-Goals

**Goals:** Make the existing workflow's event scope explicit, expose formatting failures clearly, and bound obsolete/hung work while retaining one familiar required-check identity.

**Non-Goals:** Additional platforms or Node versions, job matrices, publishing/deployment, branch-protection configuration, new lint tools, action-version migration, live provider/forge checks, and report browser validation beyond the existing suite.

## Decisions

### Update the existing workflow in place

Keep the workflow name and job id `test`. Set `push.branches: [main]` and `pull_request.branches: [main]`; use GitHub's default PR activity types (opened, synchronize, reopened). Keep full check coverage without path filters. A second workflow would duplicate existing work and create another status identity.

### Reuse the existing installation sequence

Retain checkout, pnpm setup reading `packageManager`, and Node setup at 24.21.0 with `cache: pnpm`. Keep pnpm available before Node setup attempts to locate its store. Preserve `pnpm install --frozen-lockfile --prod=false` and lifecycle scripts; do not cache `node_modules` or disable the Effect patching step. This also populates the store for the offline fresh-install tests. Retain the existing action major versions; upgrades are separate maintenance.

### Use named steps and existing scripts

After setup/installation, run these steps sequentially:

1. `pnpm format:check` — explicit formatting feedback without automatic fixes.
2. `pnpm config:schema` — committed schema consistency, without `--write`.
3. `pnpm licenses:check` — existing license evidence and its regression tests.
4. `pnpm check` — lint, types, Effect diagnostics, and report-template types; do not add redundant `pnpm lint` or `pnpm typecheck` steps.
5. `pnpm report:browser:install --with-deps` — the reporter's pinned Playwright Chromium and Ubuntu libraries for its existing integration tests.
6. `pnpm test` — unit and integration projects.
7. `pnpm browser:install --with-deps` — native browser and Linux prerequisites.
8. `pnpm test:e2e` — native browser/server and fresh installation coverage.
9. `pnpm build` — plugin bundle validation.

Use readable step names, normal fail-on-error behavior, and no automatic fix/write flags. Provision reporter Chromium immediately before unit/integration tests and the native browser immediately before end-to-end tests. This avoids browser downloads when static checks fail. The earlier hosted run showed missing reporter Chromium; its setup was added with user approval during implementation. Splitting jobs would require repeated installations and store preparation for little benefit here.

### Bound execution simply

Set a 30-minute job timeout and workflow concurrency using `${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true`. PR refs are separate from branch refs, so updates supersede only the same PR/ref. Keep `permissions: contents: read` and ordinary `pull_request` events so fork contributions need no secrets or elevated token access. A superseded main run may be canceled; the newest main revision is validated.

### Keep documentation aligned

Add `pnpm format:check` to contributor checks and describe the main/PR trigger scope, one Linux job, and retained validation sequence in `docs/testing.md`. Preserve documentation about disposable repositories and local remotes. No new package script is needed.

## Risks / Trade-offs

- Browser/native tests and dependency downloads can be slow on cold runners → retain pnpm caching, provision only the browsers required by the existing suites, and start with a generous 30-minute timeout.
- One sequential job stops at the first failure → named steps make failures clear; contributors can run existing scripts independently.
- Explicit formatting may reveal existing formatting debt → fix only issues necessary for the agreed check during implementation; do not hide failures with automatic CI fixes.
- Workflow configuration alone cannot prove runner behavior → validate YAML/expressions locally and inspect the first eligible GitHub run when available; report that limitation if it cannot be observed.
- Node's workflow version must stay aligned with `mise.toml` → check alignment during implementation and future toolchain updates.

## Migration Plan

Update the existing workflow and documentation in one change. Validate workflow syntax, run the retained commands plus formatting, and confirm the next eligible PR/main run when available. No state migration is needed. Reverting the workflow/documentation restores the previous behavior. Do not push, create a PR, or change GitHub settings just to exercise CI without separate authorization.

## References

- [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax): branch filters, permissions, concurrency, and job timeout.
- [setup-node caching](https://github.com/actions/setup-node#caching-global-packages-data): pnpm store caching still requires installation.
- [pnpm action setup](https://github.com/pnpm/action-setup): package-manager selection from `package.json`.
