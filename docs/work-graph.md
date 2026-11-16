# Work graph storage

AbraCode stores issues in `work_database`, defaulting to `<home>/.abracode/work.sqlite`. Node’s built-in SQLite module provides persistence; Effect owns scoped connections and typed failures. No separate database process or issue CLI is required. Manage work through the Supervisor’s `abra_work_*` tools.

Issues have explicit repository, workflow, status, priority, request ID, assignee and dependency fields. Dependencies are blocking issue IDs. New issues can depend only on existing issues, which prevents cycles without a graph library. Ready work is open, unclaimed and has only closed dependencies. Priority sorts ascending, then issue ID.

Creation commits the normalized request and issue together, with a unique request ID. A retry returns the same issue, including after a lost response or restart; different input with the same key raises `REQUEST_REBIND`. Claiming checks readiness and ownership within a write transaction. Status changes check the execution owner and expected previous status; repeating a successful transition is harmless. The issue history records creation, claims, blockers, resumption and closure. The controller still owns approvals, delivery and the requirement that cleanup precedes closure.

The database uses WAL, foreign keys, full synchronous commits and a five-second busy timeout. Write transactions contain only synchronous SQL and domain checks. They coordinate independent processes; in-memory Effect references or semaphores cannot replace this durability. OpenCode’s native plugin storage continues to own project registrations, execution relationships and approval receipts. SQLite stores the work graph only.

## Backup

Stop the service before copying the database, or use SQLite’s online backup API for a live copy. A live database may have committed content in its `-wal` file; copying only the main file can lose it. Back up native OpenCode storage and worktrees alongside the work database so execution relationships and filesystem evidence remain consistent. Keep `.abracode` private.

## OpenSpec planning choices

Full-openspec creation accepts an optional kebab-case `openspec_schema` and an affirmative `require_plan_approval: true`. The schema is selected at the owned worktree before Explore; omitting it follows that repository’s default for a new execution. Other workflows reject these choices, and `false` is not an approval override. Single and atomic batch request identities retain both optional fields, so changing/removing a supplied choice requires a new request ID.

Work database version 7 adds nullable schema/approval columns without rewriting historical `request_input` or batch receipt JSON. Existing omitted fields remain omitted, preserving old retry identities. Upgrade is additive; unsupported future versions are refused rather than downgraded. The native execution record captures effective approval policy separately before worker admission.
