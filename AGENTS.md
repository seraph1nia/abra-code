# Developing AbraCode

AbraCode’s SQLite work graph owns issue status, priority, repository association and dependencies. OpenSpec owns tracked planning artifacts and implementation tasks. OpenCode owns sessions and worktree inventory. The plugin owns execution relationships and guarded checkpoints.

The app's agent definitions, role policy and bundled instructions belong to `packages/agents`. Runtime skills live in `packages/agents/assets/skills/` and retain their native `abra-*` IDs. Keep app operating procedures there; this file and `.agents/skills/` guide contributors developing AbraCode.

For implementation, regression tests and final verification, load [testing](.agents/skills/testing/SKILL.md) (`$testing`). Run focused tests while editing; run `pnpm check` and `pnpm test:all` on completed work before handoff. Tests use temporary repositories and must never push to user remotes. Use the [verification recipe](docs/verification/README.md) for disposable native journeys and retained evidence. Consult [API evidence](docs/supported-apis.md) before changing native integrations. Keep lifecycle gates in the controller, not solely in prompts.

OpenSpec 2's six generated development workflows have one shared copy under `.agents/skills/`; invoke them by skill name, such as `openspec-propose` or `openspec-apply-change`. Generated skills are refreshed by the CLI; do not customize their bodies or restore tool-specific skill/command copies. APM installs the other developer skills from `apm.yml`. See [instruction ownership](docs/openspec.md) for the runtime/development boundary.

For interactive browser verification and evidence, use the APM-installed [agent-browser skill](.agents/skills/agent-browser/SKILL.md) and the project-local CLI. Load `pnpm exec agent-browser skills get core` before browsing. Use a task-owned named session, retain reproduction steps and snapshots with requested screenshots, and close only that session. Keep automated browser regressions in the existing test suite.
