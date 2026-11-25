import { runTransaction } from "./transaction.ts";
import { dirname } from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { type AbsolutePath, type Timestamp, timestamp } from "@abracode/contracts/identities";
import { Effect } from "effect";
import { CrewError, ensure } from "../domain.ts";
import { mkdir } from "../filesystem.ts";
import { inboxTables } from "./inbox-index.ts";

export type Row = Record<string, SQLOutputValue>;

const workSchemaVersion = 1;
// Distinguishes the fresh schema from the historical database also numbered 1.
const workApplicationId = 0x41425241;

export const sqlEffect = <A>(action: (at: Timestamp) => A) =>
  timestamp.pipe(
    Effect.flatMap((at) => Effect.try({ try: () => action(at), catch: CrewError.from })),
  );

export { runTransaction } from "./transaction.ts";
export function readUserVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get();
  ensure(
    row && typeof row.user_version === "number",
    "WORK_DATABASE_VERSION",
    "Missing user_version",
  );
  return row.user_version;
}

export function readDataVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA data_version").get();
  ensure(row && typeof row.data_version === "number", "WORK_DATABASE", "Missing data_version");
  return row.data_version;
}

function initialize(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL,
      workflow_policy TEXT NOT NULL,
      request_id TEXT NOT NULL UNIQUE,
      request_input TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 4),
      status TEXT NOT NULL CHECK (status IN ('open','in_progress','blocked','closed')),
      assignee TEXT,
      scope_json TEXT,
      report_reference_json TEXT,
      thought_source_json TEXT,
      quality_profile TEXT,
      dispatch_json TEXT,
      openspec_schema TEXT,
      require_plan_approval INTEGER CHECK (require_plan_approval IS NULL OR require_plan_approval = 1)
    );
    CREATE TABLE IF NOT EXISTS dependencies (
      issue_id TEXT NOT NULL REFERENCES issues(id),
      dependency_id TEXT NOT NULL REFERENCES issues(id),
      PRIMARY KEY (issue_id, dependency_id),
      CHECK (issue_id <> dependency_id)
    );
    CREATE TABLE IF NOT EXISTS work_events (
      sequence INTEGER PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES issues(id),
      kind TEXT NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT NOT NULL,
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS work_events_issue ON work_events(issue_id, sequence);
    CREATE INDEX IF NOT EXISTS work_events_completion ON work_events(kind, at, issue_id);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS issues_priority ON issues(priority, id);
    CREATE INDEX IF NOT EXISTS issues_repository_status ON issues(repository_id, status, priority, id);
    CREATE INDEX IF NOT EXISTS issues_repository_priority ON issues(repository_id, priority, id);
    CREATE INDEX IF NOT EXISTS issues_status ON issues(status, priority, id);
  `);
  db.exec(inboxTables);
  db.exec(
    "CREATE TABLE IF NOT EXISTS thought_saves (request_key TEXT PRIMARY KEY, digest TEXT NOT NULL, memo_id TEXT NOT NULL UNIQUE, can_submit INTEGER NOT NULL DEFAULT 1 CHECK(can_submit IN (0,1)))",
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS issues_thought_source ON issues(json_extract(thought_source_json,'$.reference.instance'),json_extract(thought_source_json,'$.reference.account'),json_extract(thought_source_json,'$.reference.name'),id)`,
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS work_batches (
      request_id TEXT PRIMARY KEY,
      request_input TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS batch_items (
      batch_request_id TEXT NOT NULL REFERENCES work_batches(request_id),
      client_key TEXT NOT NULL,
      issue_id TEXT NOT NULL UNIQUE REFERENCES issues(id),
      PRIMARY KEY(batch_request_id, client_key)
    );
  `);
  db.exec(
    `PRAGMA application_id = ${workApplicationId}; PRAGMA user_version = ${workSchemaVersion}`,
  );
}

function isCurrentDatabase(db: DatabaseSync): boolean {
  const version = readUserVersion(db);
  const application = db.prepare("PRAGMA application_id").get()?.application_id;
  if (version === workSchemaVersion && application === workApplicationId) return true;
  ensure(
    version === 0 && application === 0 && !db.prepare("SELECT 1 FROM sqlite_schema LIMIT 1").get(),
    "WORK_DATABASE_VERSION",
    `Unsupported work database version ${version}. Use a fresh work database.`,
  );
  return false;
}

export function openWorkDatabase(path: AbsolutePath | ":memory:") {
  return Effect.gen(function* () {
    if (path !== ":memory:") yield* mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const db = yield* Effect.acquireRelease(
      sqlEffect(() => new DatabaseSync(path)),
      (connection) =>
        sqlEffect(() => connection.close()).pipe(
          Effect.catch((error) => Effect.logWarning("Resource cleanup failed", error)),
        ),
    );
    // SQLite lower() is ASCII-only; preserve the existing JavaScript Unicode search.
    db.function("abracode_lower", { deterministic: true }, (value) => String(value).toLowerCase());
    const validatedVersion = yield* sqlEffect(() => {
      db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
      if (!runTransaction(db, () => isCurrentDatabase(db), false)) {
        runTransaction(db, () => {
          if (!isCurrentDatabase(db)) initialize(db);
        });
      }
      db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
      return runTransaction(
        db,
        () => {
          const empty = !db.prepare("SELECT 1 FROM dependencies LIMIT 1").get();
          return empty ? readDataVersion(db) : undefined;
        },
        false,
      );
    });
    return { db, validatedVersion };
  });
}
