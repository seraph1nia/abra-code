# Tasks

## 1. Refine the existing CI workflow

- [x] 1.1 Update `.github/workflows/test.yml` in place with push/PR branch filters for `main`, keeping the `test` workflow/job identity, one Ubuntu job, and read-only contents permissions; verify the event mapping against the spec's main, PR-base, and unrelated-branch scenarios using YAML inspection and an Actions workflow validator such as actionlint.
- [x] 1.2 Add readable step names and `pnpm format:check`, retaining pinned Node/pnpm setup, the pnpm store cache, frozen installation with developer dependencies/lifecycle scripts, and existing schema, licensing, aggregate static checks, unit/integration tests, browser setup, end-to-end tests, and build; verify commands and order against `package.json`, versions against `mise.toml`, reporter Chromium setup before `pnpm test`, and native browser setup before `test:e2e`.
- [x] 1.3 Configure a 30-minute job timeout and cancellation of superseded runs using workflow/ref concurrency; validate expressions and confirm unrelated PR/branch refs produce distinct groups, with no failure suppression or automatic formatting/lint fixes.
- [x] 1.4 Update `CONTRIBUTING.md` and `docs/testing.md` with explicit formatting validation, trigger scope, and the retained CI sequence; verify documented commands match the workflow and preserve isolated-test/local-remote guidance.

## 2. Validate the complete pipeline

- [x] 2.1 Run `pnpm install --frozen-lockfile --prod=false`, `pnpm format:check`, `pnpm config:schema`, `pnpm licenses:check`, `pnpm check`, `pnpm report:browser:install --with-deps`, `pnpm test`, `pnpm browser:install --with-deps`, `pnpm test:e2e`, and `pnpm build`; verify successful exit codes, record pre-existing or environment failures accurately, and keep test pushes confined to disposable local remotes.
- [x] 2.2 Validate the final workflow syntax and run `openspec validate add-github-actions-ci --strict`; inspect an eligible GitHub run if available for named-step feedback and end-to-end completion, otherwise explicitly record hosted-run verification as pending without pushing or changing GitHub settings solely to trigger it.

## Validation evidence (2026-10-17)

- Passed: frozen dependency installation, formatting, configuration-schema consistency, license evidence (759 locked components and 19 distributed source files), aggregate `pnpm check` (including zero Effect errors/warnings), and plugin build.
- The initial static check encountered readonly `status` assignments in concurrently edited attention code/tests. Those files were corrected independently; the repeated aggregate check passed. This change did not edit them.
- `pnpm browser:install --with-deps` failed locally because this host has none of the supported system package managers (`apt-get`, `dnf`, `yum`). The workflow targets Ubuntu; its setup still requires hosted confirmation.
- Actionlint 1.7.12, `git diff --check`, and strict OpenSpec validation passed. Inspection confirms both event branch filters target `main`, the default PR activity types remain in force, and workflow/ref groups distinguish main and separate PR refs.
- Hosted verification of this workflow revision is pending. The only existing run, 39042711123, predates these edits and failed with missing reporter Playwright Chromium as well as unrelated test failures. No GitHub write or user-remote push was performed.
- Approved and implemented: provision the existing reporter integration suite's Playwright Chromium with `pnpm report:browser:install --with-deps` before `pnpm test`. Proposal, spec, design and contributor/testing docs now include that prerequisite.
- Unit/integration tests passed (317 tests in 53 files), and end-to-end tests passed (2 tests in 2 files). Ubuntu system dependency provisioning remains a hosted verification limitation; both commands were attempted locally and their environment failures are recorded, as required by task 2.1.

- The reporter setup with `--with-deps` was attempted locally: Playwright selected Ubuntu as a fallback for this unsupported distribution, then failed because system installation required interactive sudo. No attempt to supply sudo credentials was made. Browser-only `pnpm report:browser:install` passed and the production reporter helper launched Chromium 156.0.8078.4 successfully; Ubuntu dependency installation remains for the next hosted run.
