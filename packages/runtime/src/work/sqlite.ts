import { dirname } from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { type AbsolutePath, type Timestamp, timestamp } from "@abracode/contracts/identities";
import { Effect } from "effect";
import { CrewError, ensure } from "../domain.ts";
import { mkdir } from "../filesystem.ts";
import { inboxTables } from "./inbox-index.ts";

export type Row = Record<string, SQLOutputValue>;

export const LATEST_WORK_SCHEMA_VERSION = 11;

export const sqlEffect = <A>(action: (at: Timestamp) => A) =>
  timestamp.pipe(
    Effect.flatMap((at) => Effect.try({ try: () => action(at), catch: CrewError.from })),
  );

export function runTransaction<A>(db: DatabaseSync, action: () => A, write = true): A {
  db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      if (db.isTransaction) db.exec("ROLLBACK");
    } catch {
      // Preserve original error if rollback fails or already rolled back.
    }
    throw error;
  }
}

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

function assertSupportedVersion(version: number): void {
  ensure(
    Number.isInteger(version) && version >= 0 && version <= LATEST_WORK_SCHEMA_VERSION,
    "WORK_DATABASE_VERSION",
    `Unsupported work database version ${String(version)}`,
  );
}

function applyMigrations(db: DatabaseSync): void {
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
      assignee TEXT
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
    "CREATE TABLE IF NOT EXISTS thought_saves (request_key TEXT PRIMARY KEY, digest TEXT NOT NULL, memo_id TEXT NOT NULL UNIQUE)",
  );
  const columns = db.prepare("PRAGMA table_info(issues)").all();
  const hasColumn = (name: string) => columns.some((c) => c.name === name);
  if (!hasColumn("scope_json")) db.exec("ALTER TABLE issues ADD COLUMN scope_json TEXT");
  if (!hasColumn("thought_source_json"))
    db.exec("ALTER TABLE issues ADD COLUMN thought_source_json TEXT");
  db.exec(
    `CREATE INDEX IF NOT EXISTS issues_thought_source ON issues(json_extract(thought_source_json,'$.reference.instance'),json_extract(thought_source_json,'$.reference.account'),json_extract(thought_source_json,'$.reference.name'),id)`,
  );
  if (!hasColumn("report_reference_json"))
    db.exec("ALTER TABLE issues ADD COLUMN report_reference_json TEXT");
  if (!hasColumn("quality_profile")) db.exec("ALTER TABLE issues ADD COLUMN quality_profile TEXT");
  if (!hasColumn("dispatch_json")) db.exec("ALTER TABLE issues ADD COLUMN dispatch_json TEXT");
  if (!hasColumn("openspec_schema")) db.exec("ALTER TABLE issues ADD COLUMN openspec_schema TEXT");
  if (!hasColumn("require_plan_approval")) {
    db.exec(
      "ALTER TABLE issues ADD COLUMN require_plan_approval INTEGER CHECK (require_plan_approval IS NULL OR require_plan_approval = 1)",
    );
  }
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
  if (hasColumn("finder_rank")) {
    db.exec(`
      DROP INDEX IF EXISTS issues_finder_rank;
      DROP INDEX IF EXISTS issues_finder_priority;
      DROP INDEX IF EXISTS issues_finder_repository;
      DROP INDEX IF EXISTS issues_finder_status;
      DROP INDEX IF EXISTS issues_finder_repository_status;
      DROP TABLE IF EXISTS finder_order;
      ALTER TABLE issues DROP COLUMN finder_rank;
    `);
  }
  db.exec(`PRAGMA user_version = ${LATEST_WORK_SCHEMA_VERSION}`);
}

export function openWorkDatabase(path: AbsolutePath | ":memory:") {
  return Effect.gen(function* () {
    if (path !== ":memory:") yield* mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const db = yield* Effect.acquireRelease(
      sqlEffect(() => new DatabaseSync(path)),
      (connection) => sqlEffect(() => connection.close()).pipe(Effect.orDie),
    );
    // SQLite lower() is ASCII-only; preserve the existing JavaScript Unicode search.
    db.function("abracode_lower", { deterministic: true }, (value) => String(value).toLowerCase());
    const validatedVersion = yield* sqlEffect(() => {
      db.exec(
        "PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;",
      );
      const currentVersion = readUserVersion(db);
      assertSupportedVersion(currentVersion);
      if (currentVersion === LATEST_WORK_SCHEMA_VERSION) {
        const empty = !db.prepare("SELECT 1 FROM dependencies LIMIT 1").get();
        return empty ? readDataVersion(db) : undefined;
      }
      return runTransaction(db, () => {
        const lockedVersion = readUserVersion(db);
        assertSupportedVersion(lockedVersion);
        if (lockedVersion < LATEST_WORK_SCHEMA_VERSION) applyMigrations(db);
        const empty = !db.prepare("SELECT 1 FROM dependencies LIMIT 1").get();
        return empty ? readDataVersion(db) : undefined;
      });
    });
    return { db, validatedVersion };
  });
}
