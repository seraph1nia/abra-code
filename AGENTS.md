# AbraCode

AbraCode’s SQLite work graph owns issue status, priority, repository association and dependencies. OpenSpec owns tracked planning artifacts and implementation tasks. OpenCode owns sessions and worktree inventory. The plugin owns execution relationships and guarded checkpoints.

Use controller tools from the central Supervisor session, whose public agent is Abra. Abra is the only conversational user entry point; worker inspection stays read-only. Workers use only their assigned worktree and role. Read managed repository instructions before editing. A worker must never authorize its own plan/merge, deliver changes, remove resources, or close issues.

Workflow references:

- [Orchestration](.agents/skills/orchestration/SKILL.md): ready work and lifecycle control.
- [OpenSpec execution](.agents/skills/openspec-execution/SKILL.md): Explore, Apply and Review checkpoints.
- [Onboarding](.agents/skills/project-onboarding/SKILL.md): inspect and explicitly register repositories.
- [Recovery](.agents/skills/recovery/SKILL.md): reconcile incomplete executions.

For work on this orchestrator, run `pnpm check`, `pnpm test`, and `pnpm test:e2e`. Tests use temporary repositories and must never push to user remotes. Use the [verification recipe](docs/verification/README.md) for disposable native journeys and retained evidence. Consult [API evidence](docs/supported-apis.md) before changing native integrations. Keep lifecycle gates in the controller, not solely in prompts.
