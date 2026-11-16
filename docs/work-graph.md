# Work graph storage

Issue listing hydrates rows and dependency edges in two SQL reads, rather than
one issue/dependency lookup per row. Finder search, total count and bounded
`LIMIT`/`OFFSET` row selection run in one read transaction; each page hydrates
only its selected rows' dependencies. Search retains JavaScript Unicode
lowercasing and literal substring semantics, including `%` and `_`.

Legacy finder ties use Node's `localeCompare`, which differs from SQLite binary
and ASCII collation for supported identifiers. A request-local pass over matching
IDs assigns that order; SQL then selects at most 50 complete rows using those
ranks. This preserves existing page order without reading every matching issue
body or keeping an authority cache. Metadata sorting remains O(N log N) in the
matching ID population; the number of SQL operations is constant. List/readiness
retain their existing priority/ID order.

Closure timestamps are batched by latest event sequence. Completion totals,
closure metadata, finder pages and issue/record collections participate in the
same revision-validated retained capture. Claim and intake dependency checks
hydrate dependencies in batches inside their original write transactions;
missing legacy dependencies remain refused. Normalized request bytes, request
identity, event ordering and batch/claim atomicity are unchanged.

The additive `issues_priority`, `issues_repository_status` and `issues_status`
indexes support list/filter/count paths. Database format version 7 remains
compatible with existing readers; no issue/request bytes are rewritten, and
unsupported future database versions are still refused.

AbraCode stores issues in `work_database`, defaulting to `<home>/.abracode/work.sqlite`. Node’s built-in SQLite module provides persistence; Effect owns scoped connections and typed failures. No separate database process or issue CLI is required. Manage work through the Supervisor’s `abra_work_*` tools.

Issues have explicit repository, workflow, status, priority, request ID, assignee and dependency fields. Dependencies are blocking issue IDs. New issues can depend only on existing issues, which prevents cycles without a graph library. Ready work is open, unclaimed and has only closed dependencies. Priority sorts ascending, then issue ID.

Creation commits the normalized request and issue together, with a unique request ID. A retry returns the same issue, including after a lost response or restart; different input with the same key raises `REQUEST_REBIND`. Claiming checks readiness and ownership within a write transaction. Status changes check the execution owner and expected previous status; repeating a successful transition is harmless. The issue history records creation, claims, blockers, resumption and closure. The controller still owns approvals, delivery and the requirement that cleanup precedes closure.

The database uses WAL, foreign keys, full synchronous commits and a five-second busy timeout. Write transactions contain only synchronous SQL and domain checks. They coordinate independent processes; in-memory Effect references or semaphores cannot replace this durability. OpenCode’s native plugin storage continues to own project registrations, execution relationships and approval receipts. SQLite stores the work graph only.

## Backup

Stop the service before copying the database, or use SQLite’s online backup API for a live copy. A live database may have committed content in its `-wal` file; copying only the main file can lose it. Back up native OpenCode storage and worktrees alongside the work database so execution relationships and filesystem evidence remain consistent. Keep `.abracode` private.

## OpenSpec planning choices

Full-openspec creation accepts an optional kebab-case `openspec_schema` and an affirmative `require_plan_approval: true`. The schema is selected at the owned worktree before Explore; omitting it follows that repository’s default for a new execution. Other workflows reject these choices, and `false` is not an approval override. Single and atomic batch request identities retain both optional fields, so changing/removing a supplied choice requires a new request ID.

Work database version 7 adds nullable schema/approval columns without rewriting historical `request_input` or batch receipt JSON. Existing omitted fields remain omitted, preserving old retry identities. Upgrade is additive; unsupported future versions are refused rather than downgraded. The native execution record captures effective approval policy separately before worker admission.

Selected task detail uses a separate revision-validated capture of one issue,
its direct dependency statuses and its exact execution record. Native activity
is then read only for that execution. It does not calculate fleet readiness or
scan lead history. `eligibility_observed: false` qualifies the compatibility
`eligible: false`: starting work still requires the controller's complete current
admission checks. Finder pages share pure retained projections and request-local
aggregate evidence with fleet observations, while skipping unused lead history.
Malformed selected records and unavailable native activity stay local and visible.
