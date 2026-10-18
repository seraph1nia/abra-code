# Configuration

`abracode.yaml` is the ignored personal source for models, repository declarations and policies. Copy the tracked `abracode.example.yaml`; `abracode.schema.json` is generated from the same Effect input contract. Required fields are `version: 1` and `models.default`. Unknown keys, duplicate YAML keys, malformed values and duplicate repository identities are errors.

`ABRACODE_HOME` selects the installation root; `ABRACODE_CONFIG` selects another YAML path relative to that root or an absolute path. Every reader/writer uses that selected file. A running service remains bound to its startup file; selecting another path requires stopping it and restarting with the new `ABRACODE_CONFIG`. Launch/auth/attach/apply refuse a mismatched service rather than using another file. Credentials remain in native authentication storage or environment variables. Protect alternate personal paths and their atomic sibling `<filename>.*.tmp` files with your own ignore rules.

`pnpm config:validate` validates offline; `pnpm config:show` displays effective safe settings and per-role provenance. Both support `--json`. Neither starts services, opens/creates databases, registers repositories, provisions tools, executes checks or calls providers. Live readiness remains unverified. `pnpm doctor` is a separate read-only environment check and uses an existing service for live observations when available.

## Defaults and file ownership

The shipped workflow is full-openspec, scheduling is manual, active and retained execution limits are 2, Explore/Review capacities are 2, research capacity follows Explore, reconciliation is 30 seconds, attention capacity is 1, both approvals are required, and automatic repair is off. Existing verification/delivery policies remain enforced. Explicit state paths are absolute; otherwise database/clones/worktrees live beneath `.abracode/`. Local OpenSpec defaults to `<home>/node_modules/.bin/openspec`; the configured forge executable defaults to `gh`.

The example, schema, prompts and operational skills are tracked. `/abracode.yaml` and `/.abracode/` have exact ignore entries; the narrow rooted `/abracode.yaml.*.tmp` rule also protects interrupted atomic writes of the personal file. The generated OpenCode file at `.abracode/config/opencode/opencode.json` is disposable: edit the personal YAML, not generated host settings. There is no second tracked file containing personal model choices.

## Apply declarations explicitly

Ask **Abra** to add or update a repository, or edit `repositories` and run `pnpm config:apply` while the dedicated service is running and Abra is idle. The command is a direct authenticated controller operation, not an LLM prompt. `pnpm config:status` reports current outcomes. Process-wide model/host changes require `pnpm service:restart`.

A saved declaration is not proof of registration. Status returns at most 128 outcomes per page, with `total` and optional `next_page`; pass `page` to `abra_config` or `--page N` to `pnpm config:status` for retained history. Status distinguishes declared/pending, registered/ready, registered/setup-blocked, apply-failed and retained/undeclared. Add/update saves YAML first, preserving comments and unrelated values. Atomic writes serialize cooperating writers and detect external edits; a write conflict needs rereading and retry. If remote inspection fails after save, the declaration remains pending with a concrete failure. Retry reuses stable identity and existing resources. No initialization or verification command execution is implied by declaration/application.

Manual edits never clone/fetch/register during ordinary startup or static checks. A missing, changed or unapplied declaration blocks new work. Removing one preserves history and active resources while blocking new starts; restoring the same identity reuses its registration. Cleanup remains a separate guarded action. Repository rebinding and equivalent SSH/HTTPS duplicates are rejected.

## Register remote repositories

A repository URL is enough; the Supervisor derives a stable ID and AbraCode manages the local clone. Inspect first:

```json
{
  "id": "agent-plugins",
  "remote": "https://github.com/seraph1nia/agent-plugins",
  "action": "inspect"
}
```

Inspection fetches the remote target and reads its committed instructions, skills, OpenSpec and check proposals at the reported SHA without running project checks. Register with selected verification and policies:

```json
{
  "id": "agent-plugins",
  "remote": "https://github.com/seraph1nia/agent-plugins",
  "action": "register",
  "verification": [["pnpm", "test"]],
  "plan_approval": true,
  "merge_approval": true,
  "max_workers": 1,
  "delivery": "github-pr"
}
```

The example verification command is a placeholder: choose commands from this repository's inspection. Omit `target_branch` to follow the current remote default branch. An explicit target selects `branch_policy: fixed`; `branch_policy: default` restores discovery from remote HEAD. Each new execution fetches that target and pins its SHA in both the execution record and `refs/abracode/bases/<execution-id>` before native worktree creation. Saved base refs remain for recovery/history. Failed discovery/fetch blocks execution instead of using stale refs. Resume retains its original SHA and delivery target even if the remote or registry changes.

Existing checkouts remain supported: supply `path` instead of `remote`. Their existing local target selection remains fixed unless changed explicitly. Legacy records without `branch_policy` remain fixed, and active legacy delivery targets are saved before updating a registration. No existing checkout is moved or reset.

Update policies or refresh inspection with an ID-only registration; omitted settings retain registered values:

```json
{ "id": "agent-plugins", "action": "register" }
```

Registration is permitted when setup is missing. `setup_blockers` explains missing OpenSpec or verification in onboarding and `abra_project_list`; `abra_work_ready` exposes those blockers before claims. Provisioning also rechecks OpenSpec at its fetched base. Duplicate repository identities across IDs and stable-ID rebinding are rejected, including equivalent GitHub HTTPS/SSH URLs. No shared OpenSpec store is created.

## Initialize missing OpenSpec

After explicit authorization, call `abra_project_setup`:

```json
{ "id": "agent-plugins", "action": "prepare", "initialize_openspec": true }
```

This creates a native setup worktree from a pinned remote commit and runs `openspec init --tools none --no-animation`. Only configuration and the CLI's directory placeholders may change; existing AGENTS.md, skills and source stay intact. The managed cache remains clean. Inspect the prepared setup, then deliver it:

```json
{ "id": "agent-plugins", "action": "deliver" }
```

GitHub delivery creates/rediscovers a setup PR. `action: approve` requests a native human merge form and collects its answer. Required CI/review and the exact delivered head still gate merge. `action: finish` verifies preservation and performs non-force native cleanup; it cannot bypass a required form. Setup does not claim or close issues. Inspect saved setup/error evidence with `abra_project_list`; retry the same action after resolving a blocker. Restart preserves the recorded worktree, target and approval receipts.

A configured `branch` delivery can preserve the setup branch and retire its worktree without merging. That alone leaves the default branch unconfigured: merge it through your normal process and re-register to refresh readiness. If setup is merged through the guarded GitHub flow, readiness is refreshed automatically. Configuration must be present at the fetched target before normal workers start.

For convenience, `remote` registration with authorized `initialize_openspec: true` prepares the same setup worktree; delivery is a separate action. The legacy `path` initialization flag still initializes that checkout directly. Commit and push its configuration to the target before normal work, or use the native setup flow instead.

## Model selection and authentication

One explicit model default applies to Supervisor (the public agent **Abra**), Explore, Apply, Review and Research. Complete selections under `models.overrides.<role>` replace it:

```yaml
version: 1
models:
  default: { providerID: your-provider, id: your-model }
  overrides:
    apply: { providerID: your-provider, id: your-implementation-model, variant: high }
    review: { providerID: your-provider, id: your-review-model }
repositories: []
```

`variant` is a supported native model option for reasoning effort. Omission uses that selected model's default, never a variant inherited from another model. Invalid provider/model/variant or required tool capabilities block work without substitution. Static validation cannot prove live model availability or provider authentication.

The controller captures resolved worker selections, capability prerequisites, repository settings and provenance before admitting work. Later config edits and restart affect new executions; active work and uncertain admissions retain their captured settings/context. Abra's session-local UI model choice does not redefine worker defaults. A changed active assignment needs the explicit controller recovery/change route. Diagnostics distinguish configured and captured models from the latest actual model response.

Use `pnpm service:start` then `pnpm auth` for native provider authentication. GitHub credentials remain in `gh auth`/its supported environment. Both are separate from configuration and do not belong in YAML. Native service auth stays in the private service registration; never copy it into a managed repository.

## Operational choices

For a minimal first run, the model default and one registered project are enough.
Profiles, leads, browser prerequisites and visual-report setup are optional. The
[first-use sequence](../README.md#talk-to-abra) and
[operational controls](operations.md#operational-supervision-modes) explain when
to select each option.

| Choice               | Default / precedence                                                                              | Applies to                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Worker model         | Task model/profile, project model/profile, role override, then `models.default`                   | Captured at new execution admission; no silent fallback                                      |
| Dispatch profile     | Named role/model catalog entry; selected explicitly by task/project `dispatch`                    | Model selection only; no tool or approval authority                                          |
| Supervision posture  | Omitted preserves legacy settings; explicit `manual`, `attended-automatic` or `unattended`        | Process setting after restart                                                                |
| Automatic scheduling | False without a posture; explicit automatic postures enable it and manual disables it             | Central scheduler readiness and capacity rules                                               |
| Diagnostics / repair | Project `diagnostic_turns: 1`, `repair_rounds: 0`, captured by executions                         | Shared finite management/response-recovery budgets; manual suppresses new optional reasoning |
| Project leads        | No registrations by default; register through `abra_lead_control`, not invented YAML              | Scoped context, proposals and eligible routine answers                                       |
| Human gates          | Plan and merge required by default; explicit project/profile policy determines standing authority | Native exact-input forms remain authoritative                                                |

`legacy` is a status label, not an accepted `supervision_mode` value. A posture
conflicting with explicit `auto_schedule` is rejected. Repository declaration
changes use `pnpm config:apply`; process/model/posture changes require service
restart. Existing executions retain captured models and effective policies.
See [task dispatch examples](operations.md#task-model-selections-and-profiles)
and [approval policy](#quality-profiles-and-independent-automation).

Missing-response recovery reuses diagnostic policy and allows at most one
response-only reminder per original request. There are no separate
`communication.missing_reply_recovery` or retry-count YAML keys.

## Verification commands and deadlines

Existing argument arrays remain valid. Execution snapshots normalize them to a structured command with a 15-minute verification deadline. Individual checks can specify `argv`, `deadline_ms`, `env` and `max_output_bytes`:

```yaml
verification:
  - [pnpm, check]
  - argv: [pnpm, test]
    deadline_ms: 1200000
    max_output_bytes: 8388608
    env:
      CI: "true"
```

Deadlines and output limits must be positive integers. Ordinary Git/discovery commands retain their 120-second deadline. Output retention defaults to 8 MiB separately for stdout and stderr; diagnostic tails are bounded at 8 KiB. Only adapters explicitly handling documented semantic exits may allow nonzero exits; verification still requires exit zero. Later project edits do not change an active execution's snapshotted commands.

## Active versus retained capacity

The shipped omitted `max_executions` value preserves the corresponding old `max_workers` ceiling. To permit idle PRs or paused work while one worker runs, deliberately raise retained capacity globally and in the project registration:

```yaml
max_workers: 1
max_executions: 4
```

Register the repository with `max_workers: 1, max_executions: 4` as well. The controller still admits one active turn globally and per repository; idle work retains claims and counts toward four retained executions. Pending/uncertain native admission continues to reserve its worker slot until native evidence confirms idle/stop. Explore and Review budgets apply independently. Readiness identifies the active, retained or role limit and the executions consuming it. `pnpm doctor` and `abra_project_list` show effective limits.

## GitHub delivery policy

Project registration accepts `merge_method: merge | squash | rebase` (default `merge`), `ci_policy: all-reported | required` (default `all-reported`) and `allow_no_checks: false` by default. These settings are snapshotted per execution; changing the registry does not change an active merge method or loosen its checks.

`all-reported` requires every current reported check to pass or be skipped/neutral. `required` permits advisory failures only after applicable legacy protection and active repository/organization rules have been discovered, including check application identity. Missing check contexts remain waiting even if every reported check passed. Unreadable, inconsistent or unsupported requirements never imply success. No-check delivery requires explicit authorization and confirmed absence of required and reported checks. Required review, draft/mergeability and exact-head approval gates remain in force.

Example explicit project registration fields:

```json
{
  "id": "api",
  "action": "register",
  "merge_method": "squash",
  "ci_policy": "required",
  "allow_no_checks": false
}
```

A prohibited merge method or merge-queue requirement produces a specific wait. The controller does not change methods, enable a queue, use administrator bypass or interpret arbitrary error prose as permission.

`generated_paths` is an empty-by-default array of exact relative generated directories, for example `[node_modules, dist]`. It is snapshotted when work is admitted. Roots, parent traversal, patterns, overlapping directories and repository/agent control paths are invalid. Changing a registration does not widen an existing execution's cleanup authority.

Cleanup inspects each selected directory without following directory links, refuses tracked descendants, nested repositories, special files and escaping links, and records directory identity before deletion. Contained dependency links are unlinked as entries. Other ignored/untracked files remain blockers. Authorize only reproducible generated directories; never use a whole-checkout or blanket ignored-file policy.

Supervision defaults to one diagnostic turn and zero automatic repair rounds per execution. Repository `diagnostic_turns` and `repair_rounds` accept 0–5 and are snapshotted. `progress_timeout_ms` may specify positive millisecond thresholds for `explore`, `apply`, `review`, `research`, and `operation` together; defaults are 15 minutes for read/planning roles, 30 minutes for Apply, and five minutes for controller operations. An owned verification command uses its explicit deadline instead. The captured Supervisor selection supplies attention in the retained Abra session. Missing sessions never cause a replacement Supervisor to be invented.

`research_capacity` defaults to `explore_capacity`; `workers.research` selects native agent/capability prerequisites; `models.overrides.research` selects its model. Research remains read-only regardless of model selection.

`attention_capacity` defaults to 1 admitted-but-unhandled diagnostic incident globally. Pending incidents remain visible and do not consume diagnostic turns until a slot is reserved. Record handled/user-needed disposition to release the slot; admission does not imply resolution.

## Quality profiles and independent automation

Project registration and work creation accept `quality_profile: strict | standard | quick`. Strict requires full-openspec and defaults to all-reported CI with plan approval. Standard accepts either coding workflow and defaults to required-only CI with plan approval. Quick requires explicitly selected lightweight-fix with a complete scope and defaults to required-only CI with standing plan authority. Every coding workflow retains verification and independent Review. A profile never selects a workflow or changes merge authority.

Task profile selection takes precedence over a project profile. Explicit project `ci_policy` and `plan_approval` overrides are retained and shown as custom. An explicit profile registration applies that preset before overrides in the same request; omitting the profile preserves existing policy. Legacy projects remain unprofiled. Research ignores project coding profiles and rejects an explicit task coding profile. Active executions retain effective values and profile provenance through restart and registry edits.

Independent settings are `publication` (`ready`, `draft-until-verified`, `manual-ready`), `reviewers` (explicit `users`, `teams`, `request: manual | on-ready`, and `rerequest_after_correction`), `discussion` (`replies: manual | verified`, `resolve_threads: manual | addressed`), `ci_retry` (`max_reruns` 0–5 and exact `.github/workflows/*.yml` or `.yaml` paths), and `validation` (`engine: native | no-mistakes`, `max_runs` 1–6). Omission preserves final-ready publication, manual public actions, zero reruns and native validation. These settings never imply each other's authority. YAML changes require explicit application; active executions retain captured settings.

### GitHub publication and review automation

These settings are independent of quality profile and merge approval. Omitting them retains final-ready publication, manual discussion/reviewer actions, no Actions retries and native validation.

```yaml
publication: draft-until-verified # ready | draft-until-verified | manual-ready
reviewers:
  users: [alice]
  teams: [api]
  request: on-ready # manual | on-ready
  rerequest_after_correction: false
discussion:
  replies: verified # manual | verified
  resolve_threads: addressed # manual | addressed
ci_retry:
  max_reruns: 1 # 0..5, reserved across heads and restart
  workflows: [.github/workflows/ci.yml]
validation:
  engine: native
  max_runs: 1 # 1..6, separate from repair/rerun budgets
```

Draft publication happens after idle Apply. Pending check, Review and archival evidence appears in the managed PR section. Final publication updates that section while preserving manually authored content and reuses the same owned PR. `draft-until-verified` authorizes a ready transition after final native gates; `manual-ready` keeps that transition behind `abra_work_pr_action` and its bound human form. Setup and research do not acquire early publication from a coding profile.

Configured reviewers require exact-repository eligibility. `abra_work_reviewers` offers evidence from supported simple CODEOWNERS globs and bounded recent authorship; unsupported patterns and unavailable eligibility are disclosed. Suggestions send no request. Pending requests and submitted same-head reviews reconcile notification receipts. Requests after a correction require the separate `rerequest_after_correction` setting.

Verified replies use only the published corrective head and retained native verification/Review evidence. Resolution requires fresh thread revisions and permission; enabling replies does not enable resolution. Automatic resolution waits for its configured evidence reply to be confirmed. Manual actions show exact targets and text in a native approval form. Custom reply text always requires that manual form, even when verified automatic replies are enabled.

An automatic rerun requires a policy-blocking current-head GitHub Actions failure, a retained transient/infrastructure disposition and an exact workflow allowlist match. It reruns failed jobs, without debug logging. Missing required contexts, advisory checks, code defects and active attempts are ineligible. Each prepared retry reserves its own budget slot; it does not consume a code-repair round.

### Optional external validation

```yaml
validation:
  engine: no-mistakes
  max_runs: 2
  bin: no-mistakes # optional executable; no installation is inferred
  home: /srv/abracode/no-mistakes # optional NM_HOME; defaults to NM_HOME or ~/.no-mistakes
```

The initial supported protocol is exactly no-mistakes v1.84.0. Selection performs no initialization, hook installation or daemon restart and never falls back to native validation. An unavailable executable, uninitialized repository, stopped daemon or unsupported finite fix configuration becomes a blocker for that selected execution. Effective per-stage fix limits must be integers from 0 through 10; zero disables automatic fixes and adapter fix requests for that stage. The run receipt retains those limits, configuration digest, executable and runtime home.

Use `abra_work_validation` with `action: preflight` to inspect prerequisites. Explicit `setup` requires a concrete approval form describing repository metadata/hooks/remotes, possible user-skill installation and daemon startup. Do not use setup to alter an active run. External gates have their own bound human forms; no quality profile implies `--yes`, skipped validation or accepted scope/protected-path exceptions. Truncated gate content cannot be answered as complete evidence.

AbraCode always excludes external `rebase,push,pr,ci` stages and suppresses public intent drafting. It retains the pinned base and owns publication and CI. Engine output is never evaluated as shell. Unsupported adoption instructions, missing preserved commits or extra skips/overrides retain a recovery blocker. Adopted results must pass native checks and independent Review before archive, delivery and fresh head-bound merge approval.

## Required worker capabilities

Worker profiles accept `required_skills` (up to 32 exact native skill IDs) and `required_tools` (up to 32 groups of up to 16 alternatives). Every group requires at least one available tool. Declarations add prerequisites to the role defaults; they never grant permissions, remove defaults, install skills or change the assigned role.

```yaml
workers:
  apply:
    agent: build
    required_skills: [project-conventions]
    required_tools:
      - any_of: [patch, edit, write]
      - any_of: [bash, shell]
```

The named skill must resolve with usable content in the assigned worktree's native inventory. A central-only skill is insufficient. Configure the target repository's native discovery or repair an explicitly registered skill; AbraCode does not copy project instructions or search unrelated agent homes. Full-spec roles require `abra-openspec-execution`; research and lightweight work require no OpenSpec setup. Apply requires a development shell (`bash` or `shell`). Browser guidance and browser-only shell access remain available to all workers, but ordinary admission does not require them. Workers load `abra-browser` when browser work is needed and report missing prerequisites for that work without installing them.

For assignments that must use a browser, explicitly add `abra-browser` to the selected worker profile's `required_skills`. Its guidance is then checked before admission, and the effective browser shell tool becomes required (`shell` for Explore/Review/Research; Apply keeps its development-shell alternative). Shared skills remain registered at worker locations without copying repository control files.

New coding admissions also require bundled engineering guidance: Explore full-spec selects `abra-codebase-design`, `abra-domain-modeling` and `abra-verification`; Apply full-spec/lightweight selects those plus `abra-diagnosing-bugs` and `abra-blast-radius`; Review selects design, verification and blast radius. Research-only has no new coding prerequisites. Availability is a prerequisite; invocation is conditional on the task. See [triggers and scope](engineering-skills.md). Retained prompts validate exactly their captured skill/tool requirements and provenance without acquiring new defaults; a deliberate fresh turn captures current defaults. The permission-policy hash is unchanged by guidance alone.

Requirements outside the role ceiling are configuration errors, including a forbidden alternative mixed with a permitted one. Tools are checked against actual model-visible names before the provider request, so GPT-family `patch` can satisfy editing after native removal of `edit`/`write`. Skill availability is recorded separately from observed loading. New configuration applies to new executions; active work and uncertain submissions retain their captured settings and identities.

Role policy revisions invalidate incompatible captured contexts rather than silently rewriting them. After upgrading, use diagnostics and an explicit new worker turn when an existing admission reports `CONTEXT_POLICY`; do not replay an incompatible retained prompt.

## Browser setup

AbraCode pins `agent-browser@0.39.1` in its central development dependencies. Node 24+ and pnpm 11+ are already supplied by the toolchain. Use `pnpm install --frozen-lockfile --prod=false`; `allowBuilds` permits the reviewed package postinstall to prepare the platform native executable (downloading the matching GitHub release if absent). No Rust build, global CLI or managed-repository dependency is required. The managed service already prepends `<home>/node_modules/.bin` to PATH.

As the service user, run `pnpm browser:install` once to download Chrome, or set `AGENT_BROWSER_EXECUTABLE_PATH` to an absolute compatible system Chrome/Chromium executable before starting the service. Restart an idle service after changing its environment. Linux also needs the browser's system libraries; see [operator instructions](operations.md#browser-cli). Headless use needs no separate display server. Routine `pnpm doctor` checks only the absolute central CLI's version with a five-second deadline; it does not install, launch or repair browsers. Chrome is required for browser assignments, not ordinary worker admission.

### Execution-specific cleanup decisions

Captured `generated_paths` remain the repository defaults selected at execution creation. A native finishing form can add exact inspected generated directories for that execution only; it does not edit configuration or broaden later executions. Receipts bind generation, native form/session, worktree and directory device/inode/birth identity. Contents may regenerate in that same directory; replaced directories, new siblings, tracked descendants, nested repositories, escaping links, special files and repository control paths fail safety inspection. An ignore rule alone grants no disposal permission. Preserve arbitrary files or select exact regular files for pre-merge inclusion instead.

Synchronization of existing edits has two retained automatic attempts independent of diagnostic and repair budgets. An additional native exact-input receipt grants one extra assessment; restarting or changing a head never resets accounting. Revalidation still requires configured checks, independent Review, applicable planning approval and fresh exact-head merge authorization.
