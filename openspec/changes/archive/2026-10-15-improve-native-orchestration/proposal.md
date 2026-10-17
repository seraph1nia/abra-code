# Proposal

## Why

OpenCrew has a useful native OpenCode/Effect foundation, but normal CI waits can become permanent recovery stops, slow operations serialize unrelated tickets, and unchecked external/durable data weakens lifecycle guarantees. Address those findings first, then bring Firstmate's strongest operating lessons into this smaller runtime: preserved research outcomes, explicit waits and decisions, progress-aware supervision, and bounded repair loops.

## What Changes

- Decode CLI output, configuration, plugin-owned records, tool input and custom wire data with Effect Schemas; derive TypeScript types from those schemas and version/migrate durable records without manufacturing authorization or missing evidence.
- Separate routine waits, retryable failures and identity/evidence conflicts; automatically recheck pending CI/reviews without moving healthy work into recovery.
- Replace global locking around slow checks and external operations with durable operation intents, short coordination commits and execution-specific ownership; keep independent-process locks and cancellation guarantees.
- Distinguish active worker capacity from retained execution/worktree limits, so idle approvals and blocked PRs do not reserve model capacity.
- Deepen the workflow module and remove controller reach-through from setup, tools and observers; adopt Effect's scoped process implementation while retaining bounded output, configurable deadlines and process-group cleanup.
- Add durable worker questions, declared waits, progress evidence and deduplicated attention delivery to the persistent Supervisor; keep routine reconciliation free of model turns and bound unattended corrective work.
- Execute explicitly selected research-only and lightweight-fix policies alongside the unchanged full-openspec default. Preserve research reports independently of disposable worktrees and support deliberate follow-on implementation.
- Improve exact-head GitHub readiness, required/advisory check diagnostics, merge/squash/rebase preservation evidence, intent-based PR descriptions and bounded check/review feedback rounds.
- Retain conservative cleanup by default and permit only explicitly configured, proven-owned generated-path disposal after verified preservation.
- Project reasons, next actions, decisions, reports, capacity and operation progress through the existing native TUI and management tools.
- **BREAKING (configuration semantics):** `max_workers` becomes an active-worker limit; explicit retained-execution limits are introduced. Upgrade defaults preserve the old upper bound until an operator deliberately increases retained capacity.

## Capabilities

### New Capabilities

- `typed-contracts`: Validated external inputs, versioned durable data, typed failure classification and safe compatibility behavior.
- `execution-coordination`: Recoverable operations, short coordination locks, routine waits, active/retained capacity and scoped process ownership.
- `native-supervision`: Durable decisions and waits, progress-aware attention, bounded native Supervisor delivery and corrective actions.
- `work-policies`: Full OpenSpec, research reports, lightweight changes and explicit policy selection and handoff.
- `delivery-evidence`: Exact-head readiness, configured merge methods, preservation proofs, useful PR content and bounded feedback.
- `safe-retirement`: Ownership-checked resource retirement with conservative defaults and narrowly authorized generated-path cleanup.
- `work-visibility`: Native presentation of workflow outcomes, waiting reasons, decisions, reports, resource limits and next actions.

### Modified Capabilities

None. The initialized project has no canonical capability specs; these deltas introduce contracts for both retained behavior and the proposed additions.

## Impact

Implementation affects `src/domain.ts`, `config`, `process.ts`, `storage`, `workflow`, `scheduler`, `recovery`, `work`, `git`, `openspec`, `opencode`, `visibility`, worker instructions/skills and their existing tests. Update architecture, configuration, API evidence, operations, recovery and acceptance documentation, explicitly replacing the documented MVP limits this change removes.

Retain OpenCode 2.0.28, Effect 4.0.1, OpenSpec 1.13.2, Node SQLite, Git and the existing machine-readable forge adapter. SQLite owns work and dependencies; OpenSpec owns full-spec artifacts/tasks; OpenCode owns sessions/worktree inventory; the plugin owns execution evidence and coordination. Add no Firstmate scripts, wrapper toolchains, alternative backlog, terminal backend, distributed scheduler, public relay, quota router or generic workflow engine. Acceptance uses temporary repositories and local/fake endpoints, with `pnpm check`, `pnpm test`, `pnpm test:e2e` and relevant native renderer/build checks.
