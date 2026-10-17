---
name: project-onboarding
description: Register remote repositories or existing checkouts with AbraCode, inspect their instructions and checks, and prepare missing OpenSpec in an owned worktree.
---

For a repository URL, call `abra_project_onboard` with a stable `id`, `remote` set to that URL, and `action: inspect`. Derive a clear ID from the repository name and check `abra_project_list` for conflicts. AbraCode creates its own managed clone; do not ask the user to clone the repository or supply a local path. For an existing checkout, use its canonical absolute `path` instead.

Inspect the reported remote commit, AGENTS.md content, skills, OpenSpec configuration and proposed verification commands. Choose checks appropriate for the project. When onboarding is authorized, use `action: register`. Remote registrations follow the remote default branch unless `target_branch` selects a fixed target. `branch_policy: default` restores default-branch discovery. New issues fetch and pin their base; resumptions retain their original worktree, commit and delivery target.

Missing OpenSpec or checks do not prevent registration. Read `setup_blockers` in the report/list and configure verification through registration. If OpenSpec initialization is authorized, call `abra_project_setup` with `id`, `action: prepare`, and `initialize_openspec: true`. This initializes configuration in a native setup worktree, preserving existing instructions and skills. Inspect the returned setup, then use `action: deliver` for its branch/PR. `action: approve` requests/collects native human merge authorization; `action: finish` checks preservation and retires the worktree. A pending form stops merge. Errors retain resources; `abra_project_list` reports the saved setup and failure reason. Retry the same action after resolving its blocker.

Once setup reaches the target branch, re-register by `id` to refresh readiness if it was merged outside the setup flow. Preserved-branch delivery alone does not configure the default branch. The legacy `path` plus `initialize_openspec: true` behavior still initializes that checkout directly; commit and push those files to the target branch before starting work. Prefer the native setup flow for new initialization.

Use `abra_project_list` to confirm identity and policies. `abracode.yaml` entries are authoritative intended declarations; applying them remains explicit. Managed issues require exactly one `repository_id` metadata field or `repo:<id>` label. See [configuration](../../../docs/configuration.md).

Setup prerequisites depend on the requested policy: research-only needs no OpenSpec or coding checks; lightweight-fix needs verification but no OpenSpec; full-openspec keeps both prerequisites. Registration remains explicit for every policy. Do not initialize OpenSpec solely to run research or a lightweight fix.

Registration saves the declaration to the selected personal YAML before inspecting the repository. A saved declaration is not proof of successful registration: report pending/apply-failed/setup-blocked outcomes accurately. Updates preserve omitted settings and comments. A write/conflict error means reread the file and retry; never claim runtime-only success. Remote failure after save retains the declaration for repair and explicit retry. Cooperating edits serialize, and a detected independent file edit is preserved.

After a manual YAML edit, use `abra_config` with `action: apply`, or tell the operator to run `pnpm config:apply` with Abra idle. Use `action: status` / `pnpm config:status` to inspect each declaration's result. `pnpm config:validate` and `pnpm config:show` are offline checks only. Removing a declaration prevents new starts and reports retained/undeclared; it never deletes a registration, issue, clone, worktree or history. Restore the same ID and remote to reuse retained resources. Active work retains its original delivery target and captured settings.
