# Contributing to AbraCode

Use the Linux Node and pnpm versions pinned in `mise.toml`. Install with `pnpm install --frozen-lockfile --prod=false`. Application runtime tooling is installed locally; developer dependencies are required for this source distribution.

Read [AGENTS.md](AGENTS.md), [architecture](docs/architecture.md), [API evidence](docs/supported-apis.md), [testing](docs/testing.md) and the relevant OpenSpec change before editing. Preserve controller-owned approvals, execution identity and native resource ownership. Contributor fixes do not authorize production delivery or resource deletion.

Required checks:

```sh
pnpm check
pnpm test
pnpm test:e2e
pnpm build
pnpm config:schema
pnpm licenses:check
```

Tests use temporary homes/repositories, a deterministic local model endpoint and local bare Git remotes. They must never push to user remotes or use personal credentials. Browser acceptance additionally needs the explicit `pnpm browser:install` setup and Linux browser libraries; ordinary static checks must not provision them.

Keep `abracode.yaml`, provider secrets and `.abracode/` private. Commit the example/schema and application defaults instead. New dependencies, copied instructions and assets need licensing evidence and notices; follow [licensing](docs/licensing.md). Contributions to project-owned files are offered under the root MIT license; retain any existing upstream terms and attribution.
