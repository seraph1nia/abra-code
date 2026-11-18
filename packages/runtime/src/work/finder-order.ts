import type { DatabaseSync } from "node:sqlite";
import { ensure } from "../domain.ts";

const collator = new Intl.Collator();
const collation = JSON.stringify([collator.resolvedOptions(), process.versions.icu]);
const compare = (a: string, b: string) => collator.compare(a, b) || (a < b ? -1 : Number(a > b));
// These sentinels are exactly representable by both JavaScript and SQLite.
const end = 2 ** 52;

function rebalance(db: DatabaseSync, ids: readonly string[]) {
  const step = Math.floor(end / (ids.length + 1));
  ensure(step > 1, "WORK_ORDER", "Finder ordering has no space for another issue");
  const update = db.prepare("UPDATE issues SET finder_rank = ? WHERE id = ?");
  for (const [index, id] of ids.entries()) update.run((index + 1) * step, id);
}

/** Called within the work graph's startup transaction, before any reader can use the index. */
export function initializeFinderOrder(db: DatabaseSync, addRankColumn: boolean) {
  if (addRankColumn)
    db.exec("ALTER TABLE issues ADD COLUMN finder_rank INTEGER NOT NULL DEFAULT 0");
  db.exec(`
    CREATE TABLE IF NOT EXISTS finder_order (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), collation TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS issues_finder_rank ON issues(finder_rank);
    CREATE INDEX IF NOT EXISTS issues_finder_priority ON issues(priority, finder_rank);
    CREATE INDEX IF NOT EXISTS issues_finder_repository ON issues(repository_id, priority, finder_rank);
    CREATE INDEX IF NOT EXISTS issues_finder_status ON issues(status, priority, finder_rank);
    CREATE INDEX IF NOT EXISTS issues_finder_repository_status ON issues(repository_id, status, priority, finder_rank);
  `);
  if (
    addRankColumn ||
    db.prepare("SELECT collation FROM finder_order").get()?.collation !== collation
  ) {
    const ids = db
      .prepare("SELECT id FROM issues")
      .all()
      .map((row) => String(row.id));
    rebalance(db, ids.sort(compare));
    db.prepare("INSERT OR REPLACE INTO finder_order VALUES (1, ?)").run(collation);
  }
}

export function requireFinderOrder(db: DatabaseSync) {
  ensure(
    db.prepare("SELECT collation FROM finder_order").get()?.collation === collation,
    "WORK_ORDER",
    "Finder ordering changed in another process. Restart with the installation's locale.",
  );
}

/** Allocate a position using indexed seeks under the issue insert's writer transaction. */
export function allocateFinderRank(db: DatabaseSync, id: string): number {
  requireFinderOrder(db);
  const seek = db.prepare(
    "SELECT id, finder_rank FROM issues WHERE finder_rank BETWEEN ? AND ? ORDER BY finder_rank LIMIT 1",
  );
  let lower = 0;
  let upper = end;
  let first = 1;
  let last = end - 1;
  while (first <= last) {
    const middle = first + Math.floor((last - first) / 2);
    const row = seek.get(middle, last);
    if (row && compare(String(row.id), id) < 0) {
      lower = Number(row.finder_rank);
      first = lower + 1;
    } else {
      if (row) upper = Number(row.finder_rank);
      last = middle - 1;
    }
  }
  if (upper - lower > 1) return lower + Math.floor((upper - lower) / 2);

  // Exhaustion is local to a crowded gap. Relabel in established order and
  // retry in the same transaction so readers never see mixed ranks.
  rebalance(
    db,
    db
      .prepare("SELECT id FROM issues ORDER BY finder_rank")
      .all()
      .map((row) => String(row.id)),
  );
  return allocateFinderRank(db, id);
}
