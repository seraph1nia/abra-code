import { randomUUID } from "node:crypto";
import { type DatabaseSync } from "node:sqlite";
import {
  type ThoughtWorkPage,
  type ThoughtWorkQuery,
  ThoughtWorkRow,
} from "@abracode/contracts/visibility/thoughts";
import { type Effect } from "effect";
import { decodeSync } from "../decode.ts";
import { type CrewError, ensure } from "../domain.ts";
import { runTransaction, sqlEffect } from "./sqlite.ts";

export class ThoughtReceipts {
  constructor(private readonly db: DatabaseSync) {}

  thoughtWork(
    query: typeof ThoughtWorkQuery.Type,
  ): Effect.Effect<typeof ThoughtWorkPage.Type, CrewError> {
    return sqlEffect(() => {
      const offset = query.offset ?? 0;
      const rows = this.db
        .prepare(`SELECT id,title,repository_id,json_extract(thought_source_json,'$.reference.wording_hash') AS wording_hash FROM issues
          WHERE json_extract(thought_source_json,'$.reference.instance')=? AND json_extract(thought_source_json,'$.reference.account')=? AND json_extract(thought_source_json,'$.reference.name')=?
          ORDER BY id LIMIT 21 OFFSET ?`)
        .all(query.instance, query.account, query.name, offset);
      return {
        entries: rows
          .slice(0, 20)
          .map((row) => decodeSync(ThoughtWorkRow, row, "Thought work row")),
        next_offset: rows.length > 20 ? offset + 20 : undefined,
      };
    });
  }

  reserveThought(
    key: string,
    digest: string,
  ): Effect.Effect<{ id: string; fresh: boolean }, CrewError> {
    return sqlEffect(() =>
      runTransaction(this.db, () => {
        const previous = this.db
          .prepare("SELECT digest, memo_id FROM thought_saves WHERE request_key = ?")
          .get(key);
        if (previous) {
          ensure(
            previous.digest === digest,
            "MEMOS_CONFLICT",
            "This save request already belongs to different wording.",
          );
          return { id: String(previous.memo_id), fresh: false };
        }
        const id = randomUUID();
        this.db
          .prepare("INSERT INTO thought_saves(request_key, digest, memo_id) VALUES (?, ?, ?)")
          .run(key, digest, id);
        return { id, fresh: true };
      }),
    );
  }
}
