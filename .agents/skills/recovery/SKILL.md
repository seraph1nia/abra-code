---
name: recovery
description: Recover interrupted AbraCode executions by reconciling work graph, native sessions/worktrees, OpenSpec and delivery evidence without repeating ambiguous mutations.
---

Start with `abra_work_status`, `abra_work_diagnostics` and `abra_work_reconcile` for the affected `issue_id`. The execution retains its worktree and session IDs. Reconciliation validates repository identity, claim ownership, session location, OpenSpec checkpoint and merge evidence.

`abra_work_diagnostics` returns assigned worker models, native error type/message/status, recent assistant text, available tool names and failed tool summaries. GPT-family workers use native `patch` instead of `edit`/`write`; diagnose missing editors from `available_tools.names` and do not request broader source-write permission for Explore. Use it to diagnose a worker failure; do not require access to global OpenCode log files or ask the user to retrieve an error that this tool can expose. `diagnostic_error` means a native read failed; a saved `last_worker_failure` can still identify an earlier failure. Diagnostics are evidence, not authorization to skip a gate.

Workers inherit the Supervisor model when no explicit role model is configured. The execution retains that inherited model. An explicit `workers.<role>.model` overrides it and is applied before retrying an idle session; repair unavailable models or provider authentication before retry.

Use `abra_work_control` with `resume` for an interrupted worker or `retry` after correcting a concrete blocker. Reuse recorded sessions. `recovery_required` means an operation cannot be safely explained; read [the runbook](../../../docs/recovery.md) before retrying. Never force-delete, reset user work, steal a claim, recreate a PR blindly, or interpret unknown outcomes as success.

A `cleaning` execution has verified delivery and pending cleanup or work graph closure. Retry `abra_work_finish`; do not rerun merge. Human authorization receipts remain tied to their exact plan or delivery fingerprint.

For research, inspect the retained scope/report receipt and use abra_work_report to validate the hash. Keep .abracode/reports with backups; never substitute native success for report preservation. For research/lightweight scope changes, quiesce the worker and use abra_work_scope with a complete contract, then collect the configured fresh plan approval. The original issue policy never changes.

AbraCode tool successes expose `{ok:true,result?:...}` as native structured output and matching JSON content. Rejected actions are native failed tools, with a safe code and recovery guidance; do not expect an `ok:false` success envelope. Routine classified waits remain successful data. Progress notifications are ephemeral observations, never checkpoint authorization. Inventory failures preserve the retained admission intent: inspect configured agent/model/variant at the worker location and repair it before an explicit retry; do not choose a substitute provider automatically.

For configuration recovery, distinguish saved YAML intent from applied registration with `abra_config` (`action: status`). Fix pending/failed entries and explicitly apply them; manual edits do not reconcile at startup. Preserve user edits after `CONFIG_CONFLICT` and reread before retrying. An omitted repository is retained/undeclared and cannot start new work; restore its stable declaration to reuse history rather than deleting resources. Active execution models/profiles and target policy are captured; changing Abra's UI model or restarting with new defaults does not replace them. Repair access for the captured selection before retrying. Abra remains the sole user conversation; worker evidence is inspected read-only.
