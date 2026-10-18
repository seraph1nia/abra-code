# AbraCode

AbraCode is a local coding orchestrator powered by **OpenCode 2.0.28** and **OpenSpec 1.13.2**. Talk to **Abra**, your persistent supervisor. Abra coordinates independent workers, while a deterministic controller owns claims, approvals, checks, delivery and recovery.

Each issue has one owned worktree. SQLite owns the work graph, OpenSpec owns planning artifacts and implementation tasks, and OpenCode owns persistent sessions and worktree inventory. Work and decisions survive service restart.

## Requirements

The first release supports **Linux**. The tested environment is Linux x86-64 with glibc, Node **24.21.0**, pnpm **11.28.5**, Git **2.56.0** and util-linux `flock` **2.42.4**. Other Linux combinations are not covered by that acceptance result; macOS and Windows are unsupported.

| Capability                    | Requirements                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Core application              | Linux, supported Node, pinned pnpm, Git, `flock`, an authenticated model provider with tool-capable models         |
| Commits and repository access | Git user name/email and credentials/access for the selected remotes                                                |
| GitHub PR delivery            | GitHub CLI (`gh`, tested 2.102.0), `gh auth login`, repository/PR permissions; CI/review permissions as applicable |
| Browser assignments           | Explicit Chrome/Chromium setup and Linux browser libraries                                                         |
| Managed project checks        | That project's own languages, package managers and verification tools                                              |
| Optional external validation  | Separately installed/configured no-mistakes v1.84.0; native validation is the default                              |

The frozen install supplies local OpenCode, OpenSpec and agent-browser executables and application skills. No global OpenCode, OpenSpec, Bun, Rust build or author-local agent wrapper is required. This source distribution uses development dependencies at runtime: install with `--prod=false`.

## Install and launch

Clone this repository into a dedicated installation directory, then run from its root:

```sh
pnpm install --frozen-lockfile --prod=false
cp abracode.example.yaml abracode.yaml
# Edit models.default to a model supported by your provider.
pnpm config:validate
pnpm service:start
pnpm auth
pnpm doctor
pnpm start
```

`pnpm start` starts/discovers the dedicated service and opens **Abra** in an interactive terminal. Repeated launches reuse that service and conversation. `pnpm service:start` starts only the background service and bootstraps Abra, which allows authentication before the first model request. Existing native provider credentials can make `pnpm auth` unnecessary. Credentials belong in native auth storage or environment variables, never in the YAML.

[mise](https://mise.jdx.dev/walkthrough.html) can install the pinned Node/pnpm versions: run `mise trust` and `mise run setup`. It is an alternative toolchain installer, not an additional runtime requirement. Create/configure `abracode.yaml` before diagnostics. See [configuration](docs/configuration.md) and [operations](docs/operations.md).

## Configuration

One ignored personal file selects models, repositories and policies. The tracked [example](abracode.example.yaml) and [schema](abracode.schema.json) document it.

```yaml
version: 1
models:
  default: { providerID: your-provider, id: your-model }
  overrides:
    apply: { providerID: your-provider, id: your-implementation-model, variant: high }
repositories: []
```

Overrides are complete selections. The five override keys are `supervisor`, `explore`, `apply`, `review` and `research`; Supervisor is **Abra**. A variant is the selected model's native reasoning-effort option, not a universal setting. Omit it for that model's default. Models and variants are validated against native inventory before work; there is no silent provider/model fallback.

| Path                                                                 | Ownership                                                                                             |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `abracode.example.yaml`, `abracode.schema.json`, skills and defaults | Tracked application assets                                                                            |
| `abracode.yaml`                                                      | Ignored personal models, repository declarations and policies                                         |
| `.abracode/`                                                         | Ignored database, service registration, generated host config, clones, worktrees and scratch evidence |
| Native provider auth storage / environment                           | Credentials                                                                                           |

`ABRACODE_HOME` selects the installation root; `ABRACODE_CONFIG` selects another personal YAML path. Protect alternate personal files yourself. `pnpm config:validate` and `pnpm config:show` (also `--json`) work offline without creating state, starting services or calling a provider. `pnpm doctor` inspects the environment separately; an unverified capability is not proof of readiness.

Apply manual repository edits with `pnpm config:apply` while the service is running and Abra is idle; inspect outcomes with `pnpm config:status`. Restart with `pnpm service:restart` after changing process/model settings. Active executions keep captured selections and policies; new work receives the new applied settings.

## Talk to Abra

Ask Abra to add a repository URL or supported existing checkout. Abra saves the declaration in the same YAML and inspects/registers it. You do not need to clone managed remote repositories yourself. A saved declaration can still need registration, OpenSpec setup or verification commands; the tools expose those blockers. No project checks or initialization run just because an entry exists in YAML.

Then ask for a goal. Abra can record several related tasks together, preserve their dependencies and schedule independent work within global and repository capacity. For example:

> Investigate intermittent API tests, improve error handling, and research authentication regressions. Keep the investigations independent and forward relevant findings to the implementation worker.

> With attended automatic supervision configured, keep working within the accepted scopes and bring me decisions that require my authority.

> Register a backend project lead for the API repository. Ask it to inspect the queued work and propose routine follow-ups.

Full OpenSpec work follows Explore, plan approval, Apply, verification, independent Review, OpenSpec archive and controller-owned delivery. Required CI/review and a bound human merge form precede merge and safe retirement. Worker completion messages do not replace those gates.

| Role                 | Responsibility                                                        | Boundary                                                |
| -------------------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| **Supervisor: Abra** | Discuss goals, manage work, present questions and checkpoint forms    | No direct implementation or development shell           |
| **Explore**          | Investigate and prepare the assigned OpenSpec change                  | Edits only that planning change                         |
| **Apply**            | Implement accepted work and use project tooling                       | Writes only in the owned worktree under its role policy |
| **Review**           | Independently assess implementation and report findings               | Read-only repository scope                              |
| **Research**         | Investigate a question and submit a retained report                   | Read-only repository scope; no code-delivery PR         |
| **Controller**       | Enforce ownership, capacity, approvals, checks, delivery and recovery | Deterministic code; no model selection                  |

Workers operate behind Abra. Inspect their activity, model, recent evidence and reports in **Workers**; they have no conversational entry point in AbraCode. Managed worker prompts require a matching retained controller intent. Ask questions and give instructions through Abra; required approvals still use native human forms.

Full OpenSpec is the shipped default. Explicit `research-only` retains findings without implementation; explicit `lightweight-fix` uses a short accepted scope with verification and independent Review. Automatic scheduling and automatic repair are disabled by default. See [work policies](docs/architecture.md), [configuration](docs/configuration.md) and the shipped [operational skills](.agents/skills/orchestration/SKILL.md).

Set `supervision_mode` in the personal YAML to `manual`, `attended-automatic` or
`unattended`, then restart the dedicated service while workers are idle. Abra can
explain the resolved posture and its current blockers.
Explicit automatic modes enable scheduling within the existing admission rules;
manual mode disables new automatic dispatch. When no posture is selected, the
legacy `auto_schedule` setting applies (default false). Contradictory settings are
rejected. Unattended operation continues authorized work while
retaining human-owned questions and approvals. Project leads keep scoped native
context across tasks; registration alone authorizes proposals and eligible routine
answers. Work creation still requires Abra's acceptance. See
[postures and scheduling](docs/operations.md#operational-supervision-modes) and
[project leads](docs/operations.md#optional-project-leads).

Agents exchange controller-correlated requests, explicit acknowledgements,
answers and findings through native OpenCode queues. Native admission and worker
acknowledgement are separate. A verified missing required response permits one
response-only reminder within the existing diagnostic budget, followed by a
durable escalation. Ambiguous native state preserves the obligation. Inspect the
original identity through Abra; see [messaging](docs/verification/features/messaging.md).

For different task needs, ask Abra to select a dispatch profile or explicit
per-task models before admission. Active workers retain their captured selections;
changing defaults does not silently change running work. See
[model configuration](docs/configuration.md#model-selection-and-authentication).

For first use, register one project and ask Abra to check readiness, configure a
posture if automatic operation is wanted, then give it a small multi-task goal. Open Work home to inspect progress,
answer retained questions through Abra's forms, read reports and authorize delivery
when requested. Browser use, project leads and visual reporting are optional.

## Work views and optional browser use

Use `/abra` for Work home, `/abra-find` for a ticket, `/abra-session` to inspect a worker, `/abra-spec` for Plan, and `/abra-refresh` to refresh. Work home shows fleet counts, attention and scoped project leads. Overview/Plan/Diff/Workers/Feedback/Communication remain read-only. Native queued/running status, keyboard navigation and disconnected snapshots remain visible; conversation actions return to Abra.

For browser assignments, explicitly run `pnpm browser:install` as the service user, or select a compatible existing Chrome/Chromium through `AGENT_BROWSER_EXECUTABLE_PATH`. Install required Linux system libraries separately. Routine diagnostics do not provision or launch a browser, and non-browser work does not require Chrome. See [browser setup](docs/operations.md#browser-cli).

The [reporter template](templates/reporter/README.md) builds offline HTML reports and validates Mermaid during authoring. Its browser/build prerequisites are separate from ordinary use. OpenCode graphical clients may preview a linked local HTML file; AbraCode does not replace their host branding or require publishing reports.

If work stops progressing, ask Abra to inspect the original issue and retained
request before retrying. Use the runbooks for
[missing replies and uncertain admission](docs/recovery.md#worker-communication-recovery),
[interrupted workers](docs/recovery.md#owned-operations-and-stop-confirmation),
[unavailable leads](docs/operations.md#optional-project-leads),
[scheduler admission](docs/operations.md#batch-intake),
[model availability](docs/configuration.md#model-selection-and-authentication),
[pending approvals](docs/operations.md#reading-approval-and-finish-outcomes),
[report builds](docs/operations.md#portable-visual-reports) and
[blocked worktree retirement](docs/recovery.md#interrupted-retirement).

## Updates and fresh-install boundary

This release starts fresh: it does not import OpenCrew state, reuse its service or delete `.opencrew/`, `projects.yaml`, sessions or worktrees. Use a new clone and stop an old service separately before operating on overlapping resources. Old `OPENCREW_*` configuration names do not select the AbraCode installation.

For subsequent AbraCode updates, stop the service, preserve `abracode.yaml` and `.abracode/`, update the checkout, reinstall with the frozen lockfile and `--prod=false`, validate configuration, and restart. Back up retained state before updates; database downgrades are not guaranteed. See [recovery](docs/recovery.md).

## Contributing and license

Read [CONTRIBUTING.md](CONTRIBUTING.md), [API evidence](docs/supported-apis.md) and [testing](docs/testing.md). Required checks are `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, `pnpm config:schema` and `pnpm licenses:check`. Tests use temporary repositories, local bare remotes and a deterministic local provider; they never push to user remotes. Recorded results and verification limits are in [release acceptance](docs/release-acceptance.md).

AbraCode-owned material is [MIT licensed](LICENSE). Third-party dependencies and adapted upstream instructions retain their own terms. Read [third-party notices](THIRD_PARTY_NOTICES.md) and [licensing evidence](docs/licensing.md) before redistributing bundled tools or modifying upstream material. This source release is installed from a clone; npm publication and standalone binaries are deferred.
