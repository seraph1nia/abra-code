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

For a projection or contract edit, start with `pnpm test:fast` (pure data,
controlled streams and real in-memory SQLite; no Git/browser/native service).
Run only affected package checks and focused behavior tests while implementing.
Batch related edits; run the full acceptance commands once after implementation.
`pnpm check:packages` uses pnpm's dependency order. To check a shared contract and
all consumers use:

```sh
pnpm --filter '...@abracode/contracts' --filter '!abracode' --workspace-concurrency=1 -r run check
pnpm typecheck
```

For tracked changes relative to a branch, pnpm also supports `--filter '...[main]'`;
include untracked new workspaces explicitly. Root/configuration changes require
all packages. Focused checks are not full acceptance.

Required final checks:

```sh
pnpm config:schema
pnpm licenses:check
pnpm check
pnpm report:browser:install --with-deps
pnpm test
pnpm browser:install --with-deps
pnpm test:e2e
pnpm build
```

GitHub Actions runs this sequence in one Linux job on pushes to `main` and pull requests targeting `main`. `pnpm check` includes formatting, one strict type-aware lint, dependency-ordered TypeScript, Effect diagnostics and React report-export and web type checking. Checks report failures without automatically fixing files. Superseded runs for the same PR/ref are canceled, and each job has a 30-minute timeout.

Tests use temporary homes/repositories, a deterministic local model endpoint and local bare Git remotes. They must never push to user remotes or use personal credentials. Reporter integration tests need `pnpm report:browser:install`; native browser acceptance additionally needs `pnpm browser:install`. CI adds `--with-deps` to both setup commands to provision Ubuntu browser libraries; use your distribution's browser libraries locally. Ordinary static checks must not provision browsers.

Keep `abracode.yaml`, provider secrets and `.abracode/` private. Commit the example/schema and application defaults instead. New dependencies, copied instructions and assets need licensing evidence and notices; follow [licensing](docs/licensing.md). Contributions to project-owned files are offered under the root MIT license; retain any existing upstream terms and attribution.
