# Work graph storage and migration

AbraCode stores issues in `work_database`, defaulting to `<home>/.abracode/work.sqlite`. Node’s built-in SQLite module provides persistence; Effect owns scoped connections and typed failures. No separate database process or issue CLI is required. Manage work through the Supervisor’s `abra_work_*` tools.

Issues have explicit repository, workflow, status, priority, request ID, assignee and dependency fields. Dependencies are blocking issue IDs. New issues can depend only on existing issues, which prevents cycles without a graph library. Imports also validate the entire graph for cycles and missing dependencies. Ready work is open, unclaimed and has only closed dependencies. Priority sorts ascending, then issue ID.

Creation commits the normalized request and issue together, with a unique request ID. A retry returns the same issue, including after a lost response or restart; different input with the same key raises `REQUEST_REBIND`. Claiming checks readiness and ownership within a write transaction. Status changes check the execution owner and expected previous status; repeating a successful transition is harmless. The issue history records creation, claims, blockers, resumption and closure. The controller still owns approvals, delivery and the requirement that cleanup precedes closure.

The database uses WAL, foreign keys, full synchronous commits and a five-second busy timeout. Write transactions contain only synchronous SQL and domain checks. They coordinate independent processes; in-memory Effect references or semaphores cannot replace this durability. OpenCode’s native plugin storage continues to own project registrations, execution relationships and approval receipts. SQLite stores the work graph only.

## Upgrade from Beads

Before updating dependencies, stop the old AbraCode service and export its central workspace with the old `bd` binary:

```sh
pnpm service:stop
bd --directory /absolute/path/to/old/beads-workspace export --readonly --sandbox -o /absolute/path/to/issues.jsonl
```

If that binary is no longer installed, use `pnpm dlx @beads/bd@1.3.1` in place of `bd`. Keep the old `.beads` directory and a full Dolt backup if you need its history. The JSONL export carries issue data; it is not a Dolt backup.

Remove `beads_workspace` and `commands.beads` from `abracode.yaml`. Optionally set an absolute `work_database` path, then run from the central AbraCode checkout:

```sh
pnpm install --frozen-lockfile --prod=false
pnpm work:import /absolute/path/to/issues.jsonl
pnpm run doctor
pnpm start
```

The importer refuses to run while a coordinator holds the scheduler leadership lock. Import is one transaction: a missing dependency, cycle, duplicate identity, unsupported status/dependency type, or conflicting repository association rolls back the whole import. It preserves issue IDs, execution assignees and request IDs so existing native execution records retain their relationships. Legacy repository labels are converted to an explicit field. The original export, including notes, comments and timestamps, is retained in SQLite as migration evidence. It does not alter `.beads`.

Re-importing the exact same export is a no-op, even after an imported issue has progressed. A different export with colliding issue/request IDs is rejected; resolve the source rather than overwriting live work. Only blocking (`blocks`) dependencies and the four AbraCode statuses (`open`, `in_progress`, `blocked`, `closed`) are supported. Unsupported records require explicit source repair before import.

Startup and doctor require a completed import receipt when the central home contains `.beads`. This check still holds if an earlier failed startup already created an empty SQLite file. Reconciliation retains its execution/claim checks and never treats a missing work item as completed.

## Backup

Stop the service before copying the database, or use SQLite’s online backup API for a live copy. A live database may have committed content in its `-wal` file; copying only the main file can lose it. Back up native OpenCode storage and worktrees alongside the work database so execution relationships and filesystem evidence remain consistent. Keep `.abracode` private.
