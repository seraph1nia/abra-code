# Design

## Context

See `proposal.md` for motivation and scope. Relevant observations from the current checkout:

- `scripts/start.ts` already prepends `<home>/node_modules/.bin` to the managed service PATH and selects an isolated `OPENCODE_CONFIG_DIR`. Installing a skill into a user's default global OpenCode configuration therefore does not establish worker availability.
- `src/opencode/skills.ts` explicitly registers portable skills from the central `.agents/skills` tree. Workers currently receive `crew-openspec-execution`; registration does not copy files into managed repositories.
- `src/opencode/role-policy.ts` derives native permissions, visible tools, execution checks and capability requirements. Only Apply currently permits shell tooling. Adding a skill alone cannot change that.
- `WorkerContexts.prepare` already captures immutable assignment text, required skill IDs and native session identity. Native admission resolves skills at the worker location and validates actual request tools.
- The canonical Research contract rejects every shell command. The pending `unify-worker-policy-and-context` delta also gives Explore no shell authority and preserves read-only Review/Research. Its implementation is the baseline for this proposal; the browser exception is an intentional subsequent policy change, not a reinterpretation of that change's acceptance criteria.

Upstream evidence inspected on 2026-10-17: agent-browser's published package and [package manifest](https://github.com/vercel-labs/agent-browser/blob/main/package.json) report version `0.39.1` with Node 24+/pnpm 11+ requirements. Its [skill stub](https://github.com/vercel-labs/agent-browser/blob/main/skills/agent-browser/SKILL.md) delegates usage instructions to `agent-browser skills get core`. The pinned [OpenCode 2.0.28 shell tool](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/tool/plugin/shell.ts) checks parsed command resources through native permissions and supplies `OPENCODE_SESSION_ID` to the subprocess environment. Record runtime acceptance evidence in `docs/supported-apis.md` during implementation; source inspection alone is not a passed native test.

## Goals / Non-Goals

**Goals:** Direct CLI use from all four worker roles; one centrally maintained skill; one installation per OpenCrew home/service user; clear browser naming and screenshot conventions; and small changes through existing policy/context seams.

**Non-Goals:** A `crew_browser` tool, an MCP integration, a custom shell parser, an OS sandbox, a browser ownership database, automated preview-server provisioning, durable screenshot attachments, personal Chrome profile reuse, or direct browser execution by the central Supervisor. The Supervisor can delegate browser work through the existing worker lifecycle.

## Decisions

### 1. Pin the CLI centrally and provision Chrome explicitly

Add exact `agent-browser@0.39.1` to the root development dependencies, matching how OpenCrew installs its other local CLIs with `--prod=false`. Review and allow its native postinstall in `pnpm-workspace.yaml` and update the lockfile. Keep the existing service PATH arrangement; do not install globally or add dependencies to managed projects.

Add a root `browser:install` script invoking the pinned executable's `install` command. Document running it once as the same user that runs the service, or using a compatible system browser selected with `AGENT_BROWSER_EXECUTABLE_PATH`. Keep Chrome provisioning separate from routine dependency installation, service startup and worker admission. Headless use needs a browser and its Linux libraries; it does not require a separate display server or a Rust source build.

The current host is CachyOS/Arch based. Upstream's [Linux dependency installer](https://github.com/vercel-labs/agent-browser/blob/main/cli/src/install.rs) handles apt/dnf/yum, not pacman. Document distribution-appropriate system Chromium/library setup rather than advertising `install --with-deps` as a working CachyOS command. Keep the browser executable selection in the service environment and restart the service after changing it.

Extend `scripts/doctor.ts` with a bounded `--version` check of the absolute central executable and setup guidance. Avoid `agent-browser doctor` in routine checks because upstream doctor can clean stale daemon files even without `--fix`. Do not make missing Chrome block ordinary non-browser work. Validate browser launch separately with a named smoke session against a local fixture.

The existing `.github/workflows/test.yml` installs dependencies and runs the repository checks. Add explicit browser/system-library provisioning on its Ubuntu runner before browser-dependent E2E checks, rather than hiding provisioning inside tests. A missing browser in that acceptance run is a setup failure, not a silently skipped passing smoke test.

Alternative: global npm installation. It works for standalone OpenCode, but introduces a second version source and is unnecessary with the existing managed PATH.

### 2. Register one thin portable skill

Create `.agents/skills/browser/SKILL.md`, registered as `crew-browser` by the existing registry. Add it to central and worker registration lists, preserving all current entries. Add `crew-browser` to policy-required worker skills across full-spec, lightweight and research workflows. Registration and capability resolution continue to be independent of model-observed skill loading.

The skill tells workers to load `agent-browser skills get core` before browser use, then follows upstream's snapshot/reference workflow. Keep OpenCrew-specific content short: when browser use is relevant, the assigned session name, screenshot location, role scope, reporting failures, and closing only the worker's named browser. Specialized upstream workflows can be loaded from the CLI when relevant; do not install a suite of global skills or duplicate the full upstream manual. The central Supervisor sees discovery guidance but is told to delegate rather than invoke shell commands.

### 3. Use the native shell tool and existing command permissions

Extend the authoritative role policy to distinguish development shell access from browser-only command access. Expose the pinned native `shell` tool to Explore, Review and Research and require it in their effective-tool checks. Keep Apply's existing shell alternatives and development permissions.

For browser-only roles, emit native allow rules for the bare `agent-browser` command and `agent-browser *` resources, under the existing default deny. Do not emit a blanket `shell/*` allow merely because `shell` became visible. Native command scanning and permission evaluation handle unrelated commands; reuse the existing active-session and execution-time tool guards. Confirm this behavior against the real pinned server, including a browser command combined with an unrelated command. Do not add another command parser or browser API.

Update `.opencode/agents/{explore,review,research}.md`, `src/workflow/prompts.ts` and shared execution guidance so blanket shell prohibitions instead explain the browser exception. Preserve existing native edit scopes and controller-owned lifecycle operations. Treat CLI execution as trusted same-user automation: command permissions and native file-tool guards do not constitute filesystem isolation for arbitrary CLI arguments or shell redirections. The skill must require repository read-only behavior for Review/Research and planning-only repository edits for Explore.

### 4. Supply session and evidence conventions in captured context

In context assembly, derive a valid browser name as `opencrew-<native-session-id>` and include it in the retained assignment text. Workers use `agent-browser --session <assigned-name> ...` on every browser operation. This needs no shell environment hook or new storage schema. Continuing the same native session reuses its browser name; a replacement session receives a new name. Do not use agent-browser's shared default session or automatically attach to a personal browser.

Supply `<home>/.opencrew/browser/<native-session-id>/` as the screenshot directory, outside managed repository trees. The skill uses the CLI's screenshot-directory option so the directory is created by browser use, and references the returned absolute screenshot paths. Permit native file reads for this session's directory explicitly when creating the worker session; do not grant access to the whole browser evidence tree or all temporary directories. Make the browser evidence exception explicit in the common guidance about file locations.

A short context nudge names `crew-browser` and recommends the CLI for website interaction and application behavior checks. Keep detailed command usage lazy. Workers close only their named browser when finished; no automatic daemon sweeper or cleanup state machine is added. Screenshots are scratch files, not durable research report attachments. Reporting must state relevant observations and limitations rather than relying on the future existence of a scratch path.

Application startup stays with existing authority: Apply can start its scoped development server; other roles can inspect an available URL or report a missing prerequisite. This change does not manage preview ports or grant those roles arbitrary server-start commands.

### 5. Preserve existing recovery semantics

Skill/tool requirements flow through the existing preflight and request-time checks. A missing CLI is diagnosed through setup or the actual browser invocation; no per-admission browser launch is introduced. Browser failures use existing worker questions/progress reporting.

The role-policy digest changes. Never rewrite uncertain admissions, old contexts or accepted scope to make them compatible. Existing admission evidence remains authoritative; an incompatible old policy requires the current explicit-new-turn recovery path. A service restart does not replay a browser action or change a worker's browser session name.

## Risks / Trade-offs

- Native shell permission behavior differs from the current blanket role filter → verify browser success and unrelated-command refusal through the actual OpenCode 2.0.28 tool executor before considering all-role access complete.
- A skill is behavioral guidance, not a security boundary → retain the documented trusted-process model and repository edit/lifecycle gates; do not claim protection from hostile same-user processes.
- CLI/native binary or browser setup can be incomplete → allow the reviewed pnpm build script, check the exact executable and document explicit browser setup; avoid silent global fallback.
- A worker can forget its browser name or crash before closing → supply a concrete name and repeated examples, validate isolation in acceptance, and document manual close of that exact name. A browser supervisor is outside this change.
- Screenshot evidence is local and temporary → keep reports useful through recorded findings and disclose path availability rather than promising durable attachments.
- Parallel policy work can leave contradictory specs → sync `unify-worker-policy-and-context` first, then apply this change's complete `worker-policy` replacement. Do not rewrite that predecessor as part of this proposal.

## Migration Plan

1. Complete/sync the predecessor policy/context change and verify the `worker-policy` base requirement before applying this dependent delta.
2. Install the pinned central dependency with its reviewed native build permission, then run explicit browser setup or select the system executable. Use a fresh named session for the local smoke check and close only that session.
3. Deploy the shared skill, command permissions and context changes together. Restart the managed service and start deliberate new worker turns where needed; retain old admission evidence.
4. Validate all worker roles in disposable foreign repositories and run the required repository checks. Keep existing repository check commands and report contracts intact.
5. Roll back by reverting this change's dependency, skill and policy/context changes together and restarting the service. Do not rewrite retained contexts or delete browser caches, user profiles or unrelated sessions as part of rollback.
