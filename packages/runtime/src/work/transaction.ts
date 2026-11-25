import type { DatabaseSync } from "node:sqlite";

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
