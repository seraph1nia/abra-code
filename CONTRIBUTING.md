# Contributing to AbraCode

Use the Linux Node and pnpm versions pinned in `mise.toml`. Install with `pnpm install --frozen-lockfile --prod=false`. Application runtime tooling is installed locally; developer dependencies are required for this source distribution.

Read [AGENTS.md](AGENTS.md), [architecture](docs/architecture.md), [API evidence](docs/supported-apis.md), [testing](docs/testing.md) and the relevant OpenSpec change before editing. Preserve controller-owned approvals, execution identity and native resource ownership. Contributor fixes do not authorize production delivery or resource deletion.

Required checks:

```sh
pnpm format:check
pnpm config:schema
pnpm licenses:check
pnpm check
pnpm report:browser:install --with-deps
pnpm test
pnpm browser:install --with-deps
pnpm test:e2e
pnpm build
```

GitHub Actions runs this sequence in one Linux job on pushes to `main` and pull requests targeting `main`. `pnpm check` includes linting, TypeScript, Effect diagnostics and report-template type checking. Checks report failures without automatically fixing files. Superseded runs for the same PR/ref are canceled, and each job has a 30-minute timeout.

Tests use temporary homes/repositories, a deterministic local model endpoint and local bare Git remotes. They must never push to user remotes or use personal credentials. Reporter integration tests need `pnpm report:browser:install`; native browser acceptance additionally needs `pnpm browser:install`. CI adds `--with-deps` to both setup commands to provision Ubuntu browser libraries; use your distribution's browser libraries locally. Ordinary static checks must not provision browsers.

Keep `abracode.yaml`, provider secrets and `.abracode/` private. Commit the example/schema and application defaults instead. New dependencies, copied instructions and assets need licensing evidence and notices; follow [licensing](docs/licensing.md). Contributions to project-owned files are offered under the root MIT license; retain any existing upstream terms and attribution.
