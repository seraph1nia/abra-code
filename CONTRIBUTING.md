# Contributing to AbraCode

Shared browser-safe contracts live in `packages/contracts`; pure React/catalog
rendering and tokens live in `packages/presentation`. Consume their explicit
`@abracode/*` exports through direct `workspace:*` dependencies. Application
source must not reach into another workspace, including for types. `pnpm check`
checks both shared packages, both applications and the workspace import rules.
Focused checks are `pnpm contracts:check` and `pnpm presentation:check`.
After workspace-only dependency moves with unchanged supplier resolutions,
`pnpm licenses:refresh --reachability-only` updates distribution reachability;
`pnpm licenses:refresh --changed-only` refreshes changed suppliers while preserving
verified unchanged evidence. New/changed suppliers require the existing review
process; neither mode grants a license review.

Use the Linux Node and pnpm versions pinned in `mise.toml`. Install with `pnpm install --frozen-lockfile --prod=false`. Application runtime tooling is installed locally; developer dependencies are required for this source distribution.

Read [AGENTS.md](AGENTS.md), [architecture](docs/architecture.md), [API evidence](docs/supported-apis.md), [testing](docs/testing.md) and the relevant OpenSpec change before editing. Preserve controller-owned approvals, execution identity and native resource ownership. Contributor fixes do not authorize production delivery or resource deletion.

For implementation, regression coverage and suite selection, load
[testing](.agents/skills/testing/SKILL.md) (`$testing` or native `abra-testing`).
Use `pnpm test:one <test-file>` or `pnpm test:affected <source-files>` while
implementing, plus relevant package checks. `pnpm test:fast`, `pnpm test:unit`,
`pnpm test:integration` and `pnpm test:native` select explicit tiers.
Run the complete suite once on finished work with `pnpm test:all`; it builds the
web assets and includes every fast, unit, integration and E2E scenario.
A focused pass does not replace final acceptance.

Required final checks:

```sh
pnpm config:schema
pnpm licenses:check
pnpm check
pnpm test:all
pnpm build
```

Install the existing browser prerequisites once before browser/native tests:
`pnpm report:browser:install` and `pnpm browser:install` (CI adds `--with-deps`).
The test time budget includes test fixture setup and cleanup; first-time supplier
and browser provisioning is separate. See [testing](docs/testing.md) for coverage,
resource isolation and runtime measurements.

GitHub Actions runs this sequence in one Linux job on pushes to `main` and pull requests targeting `main`. `pnpm check` includes formatting, one strict type-aware lint, dependency-ordered TypeScript, Effect diagnostics and React report-export and web type checking. Checks report failures without automatically fixing files. Superseded runs for the same PR/ref are canceled, and each job has a 30-minute timeout.

Tests use temporary homes/repositories, a deterministic local model endpoint and local bare Git remotes. They must never push to user remotes or use personal credentials. Reporter integration tests need `pnpm report:browser:install`; native browser acceptance additionally needs `pnpm browser:install`. CI adds `--with-deps` to both setup commands to provision Ubuntu browser libraries; use your distribution's browser libraries locally. Ordinary static checks must not provision browsers.

Keep `abracode.yaml`, provider secrets and `.abracode/` private. Commit the example/schema and application defaults instead. New dependencies, copied instructions and assets need licensing evidence and notices; follow [licensing](docs/licensing.md). Contributions to project-owned files are offered under the root MIT license; retain any existing upstream terms and attribution.
