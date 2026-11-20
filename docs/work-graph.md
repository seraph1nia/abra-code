# Work graph storage

Issue listing hydrates rows and dependency edges in two SQL reads, rather than
one issue/dependency lookup per row. Finder search, total count and bounded
`LIMIT`/`OFFSET` row selection run in one read transaction; each page hydrates
only its selected rows' dependencies. Search retains JavaScript Unicode
lowercasing and literal substring semantics, including `%` and `_`.

Format v9 orders finder pages by ascending priority and then by ascending issue ID using SQLite's binary collation. An uppercase ASCII letter precedes its lowercase counterpart across runtime locales. Existing issue links retain their targets. An offset into a set of tied issues can return different rows after the upgrade. Search still uses Unicode lowercasing.

Closure timestamps are batched by latest event sequence. Completion totals,
closure metadata, finder pages and issue/record collections participate in the
same revision-validated retained capture. Claim and intake dependency checks
hydrate dependencies in batches inside their original write transactions;
missing legacy dependencies remain refused. Normalized request bytes, request
identity, event ordering and batch/claim atomicity are unchanged.

The priority/ID index and its repository, status and repository/status variants support bounded pages. Startup replaces the v8 rank indexes and removes its rank column and locale metadata in the existing transaction. The service refuses a database from a newer format.

AbraCode stores issues in `work_database`, defaulting to `<home>/.abracode/work.sqlite`. Node’s built-in SQLite module provides persistence; Effect owns scoped connections and typed failures. No separate database process or issue CLI is required. Manage work through the Supervisor’s `abra_work_*` tools.

Issues have explicit repository, workflow, status, priority, request ID, assignee and dependency fields. Dependencies are blocking issue IDs. New issues can depend only on existing issues, which prevents cycles without a graph library. Ready work is open, unclaimed and has only closed dependencies. Priority sorts ascending, then issue ID.

Creation commits the normalized request and issue together, with a unique request ID. A retry returns the same issue, including after a lost response or restart; different input with the same key raises `REQUEST_REBIND`. Claiming checks readiness and ownership within a write transaction. Status changes check the execution owner and expected previous status; repeating a successful transition is harmless. The issue history records creation, claims, blockers, resumption and closure. The controller still owns approvals, delivery and the requirement that cleanup precedes closure.

The database uses WAL, foreign keys, full synchronous commits and a five-second busy timeout. Write transactions contain only synchronous SQL and domain checks. They coordinate independent processes; in-memory Effect references or semaphores cannot replace this durability. OpenCode’s native plugin storage continues to own project registrations, execution relationships and approval receipts. SQLite stores the work graph only.

## Backup

Before upgrading, stop all old service processes and writers that share the database. Make a consistent pre-upgrade backup with SQLite's backup API or the SQLite CLI `.backup` command. Preserve the matching binary, native OpenCode storage and worktrees alongside it. A live WAL can contain committed changes, so copying only the main database file is insufficient.

To roll back, stop all new writers, preserve the current state separately, and restore the consistent backup in a clean location with its matching binary and related storage. Keep the database and its WAL files from the same snapshot. Keep `.abracode` private.

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

### Intake read costs

The controller reads selected issues and their direct dependency evidence under
the same record lock and bounded graph-revision check as fleet observation.
Every admission reads current project, execution and setup diagnostics. Starting
also rechecks capacity before reservation and claims the issue transactionally.

The selected-readiness regression runs each request with 0 and 1,000 unrelated
issues. Counts below include the entire controller command. Both sizes produce
the same counts and read zero fleet closure histories or daily completion totals.

| Command                                             | Hydrated issues | Direct readiness edges | Project / execution / setup scans |
| --------------------------------------------------- | --------------: | ---------------------: | --------------------------------- |
| Create one issue or a one-item batch                |               1 |                      0 | 1 / 1 / 1                         |
| Two-item batch with a local dependency              |               2 |                      1 | 1 / 1 / 1                         |
| Start a fresh issue                                 |               3 |                      0 | 1 / 3 / 3                         |
| Refuse a start on capacity or invalid retained data |               1 |                      0 | 1 / 1 / 1                         |
| Replay single intake after closure                  |               2 |                      0 | 1 / 1 / 1                         |

Previously, a single create hydrated 1,001 rows. A subsequent one-item batch
hydrated 1,001 rows to validate the graph and 1,002 to report readiness.

Batch insertion validates the local DAG and checks distinct referenced existing
IDs inside the write transaction. Every new edge originates at a new issue.
An empty dependency table establishes integrity immediately. On reopening a
populated graph or seeing another connection's commit, the next new batch checks
both endpoints of each historical edge and verifies acyclicity. The connection
retains that proof only after commit. A warm one-item insertion in the integrity
regression visits zero historical edges and hydrates zero issues, with 1,000
unrelated issues each depending on the same parent. Identical receipt replays
still return their original key-to-issue mapping.
