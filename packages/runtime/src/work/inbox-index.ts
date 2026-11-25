import { runTransaction } from "./transaction.ts";
import type { DatabaseSync } from "node:sqlite";
import { Effect, Schema } from "effect";
import {
  InboxSummary,
  InboxLink,
  type InboxTarget,
  type InboxQuery,
} from "@abracode/contracts/visibility/github-inbox";
import { IssueId, type RepositoryId } from "@abracode/contracts/identities";
import { CrewError, ensure } from "../domain.ts";
import { decodeSync } from "../decode.ts";

export const inboxTables = `
CREATE TABLE IF NOT EXISTS github_items (
 partition TEXT NOT NULL, node TEXT NOT NULL, source_id TEXT NOT NULL, project TEXT NOT NULL, kind TEXT NOT NULL,
 state TEXT NOT NULL, updated INTEGER NOT NULL, seen INTEGER NOT NULL, summary TEXT NOT NULL,
 PRIMARY KEY(partition,node));
CREATE INDEX IF NOT EXISTS github_finder ON github_items(partition,state,kind,updated DESC);
CREATE INDEX IF NOT EXISTS github_expiry ON github_items(seen) WHERE state!='OPEN';
CREATE TABLE IF NOT EXISTS github_scans (stream TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS github_cooldowns (scope TEXT PRIMARY KEY, until_ms INTEGER NOT NULL, message TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS github_links (
 source TEXT PRIMARY KEY, issue_id TEXT NOT NULL UNIQUE REFERENCES issues(id),
 role TEXT NOT NULL, revision TEXT, intent TEXT NOT NULL);
`;
export const freshMs = 300000,
  dayMs = 86400000;
export type SourceLink = {
  source: string;
  role: "pickup" | "review";
  intent: string;
  revision?: string;
};
export const sourceKey = (target: InboxTarget, host: string) =>
  JSON.stringify([host, target.repo_node, target.kind, target.item_node]);
const Scan = Schema.Struct({
  requested: Schema.optional(Schema.Boolean),
  cursor: Schema.optional(Schema.String),
  mode: Schema.Literals(["open", "history", "delta"]),
  start: Schema.Finite,
  last: Schema.Finite,
  full: Schema.Finite,
  watermark: Schema.Finite,
  high: Schema.Finite,
  repo: Schema.String,
  viewer: Schema.String,
  attempt: Schema.Finite,
  retry: Schema.Finite,
  error: Schema.optional(Schema.String),
  denied: Schema.Boolean,
});
export type Scan = typeof Scan.Type;
/** The graph also calls source/link inside its own synchronous SQL transaction. */
function indexFailure(cause: unknown): CrewError {
  if (cause instanceof CrewError) return cause;
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (String(cause.code).startsWith("ERR_SQLITE") || cause.code === "ERR_INVALID_STATE")
  )
    return new CrewError("INBOX_STORAGE", "The local GitHub inbox database operation failed");
  if (cause instanceof TypeError && "code" in cause && cause.code === "ERR_INVALID_URL")
    return new CrewError("INBOX_DATA", "GitHub item has an invalid URL");
  throw cause;
}
export const indexEffect = <A>(action: () => A) => Effect.try({ try: action, catch: indexFailure });
export class InboxIndex {
  constructor(private db: DatabaseSync) {}
  failedScan(stream: string, scan: Scan, limitedCredential?: string) {
    runTransaction(this.db, () => {
      if (limitedCredential) this.backoff(limitedCredential, scan.retry, scan.error!);
      this.save(stream, scan);
    });
  }
  needsLabelScan(partition: string, kind: string) {
    return !!this.db
      .prepare(
        "SELECT 1 FROM github_items WHERE partition=? AND kind=? AND json_extract(summary,'$.labels_complete')=0 LIMIT 1",
      )
      .get(partition, kind);
  }
  scan(key: string): Scan | undefined {
    const row = this.db.prepare("SELECT data FROM github_scans WHERE stream=?").get(key);
    return row ? decodeSync(Schema.fromJsonString(Scan), row.data, "GitHub scan") : undefined;
  }
  save(key: string, state: Scan) {
    this.db
      .prepare("INSERT OR REPLACE INTO github_scans VALUES (?,?)")
      .run(key, JSON.stringify(state));
  }
  page(
    key: string,
    partition: string,
    items: readonly InboxSummary[],
    scan: Scan,
    now: number,
    sweep?: { kind: string; start: number },
  ) {
    runTransaction(this.db, () => {
      const upsert = this.db.prepare(`INSERT INTO github_items VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(partition,node) DO UPDATE SET state=excluded.state,updated=excluded.updated,seen=excluded.seen,summary=excluded.summary
      WHERE excluded.updated>=github_items.updated`);
      for (const item of items) {
        const updated = Date.parse(item.updated_at);
        ensure(
          Number.isFinite(updated),
          "INBOX_DATA",
          "GitHub item has an invalid update timestamp",
        );
        upsert.run(
          partition,
          item.item_node,
          sourceKey(item, new URL(item.url).host),
          item.repository_id,
          item.kind,
          item.state,
          updated,
          now,
          JSON.stringify(item),
        );
      }
      if (sweep)
        this.db
          .prepare(
            "DELETE FROM github_items WHERE partition=? AND kind=? AND state='OPEN' AND seen<?",
          )
          .run(partition, sweep.kind, sweep.start);
      this.db
        .prepare(
          "DELETE FROM github_items WHERE state!='OPEN' AND seen<? AND NOT EXISTS (SELECT 1 FROM github_links WHERE source=github_items.source_id)",
        )
        .run(now - 30 * dayMs);
      this.save(key, scan);
    });
  }
  cooldown(scope: string, now: number) {
    const row = this.db
      .prepare("SELECT until_ms,message FROM github_cooldowns WHERE scope=? AND until_ms>?")
      .get(scope, now);
    return row ? { retry: Number(row.until_ms), error: String(row.message) } : undefined;
  }
  backoff(scope: string, retry: number, error: string) {
    this.db
      .prepare("INSERT OR REPLACE INTO github_cooldowns VALUES(?,?,?)")
      .run(scope, retry, error);
  }
  revoke(partition: string, retry: number, message: string) {
    runTransaction(this.db, () => {
      this.db.prepare("DELETE FROM github_items WHERE partition=?").run(partition);
      this.db
        .prepare("DELETE FROM github_scans WHERE json_extract(stream,'$[0]')=?")
        .run(partition);
      this.backoff(partition, retry, message);
    });
  }
  isPrivateReview(issue: IssueId) {
    return !!this.db
      .prepare("SELECT 1 FROM github_links WHERE issue_id=? AND role='review'")
      .get(issue);
  }
  source(link: SourceLink) {
    try {
      const row = this.db
        .prepare("SELECT issue_id,intent FROM github_links WHERE source=?")
        .get(link.source);
      if (!row) return;
      ensure(
        row.intent === link.intent,
        "INBOX_INTENT",
        "This GitHub item already has an assignment with different instructions",
      );
      return decodeSync(IssueId, row.issue_id, "GitHub source link");
    } catch (cause) {
      throw indexFailure(cause);
    }
  }
  link(issue: IssueId, link: SourceLink) {
    try {
      this.db
        .prepare("INSERT INTO github_links VALUES(?,?,?,?,?)")
        .run(link.source, issue, link.role, link.revision ?? null, link.intent);
    } catch (cause) {
      throw indexFailure(cause);
    }
  }
  links(item: InboxSummary, deliveries: readonly DeliveryLink[]) {
    const row = this.db
      .prepare(
        "SELECT role,issue_id,status,revision FROM github_links JOIN issues ON issues.id=issue_id WHERE source=?",
      )
      .get(sourceKey(item, new URL(item.url).host));
    return this.projectLinks(
      row,
      deliveries.filter((d) => d.repository_id === item.repository_id && d.url === item.url),
    );
  }
  private projectLinks(
    row: Record<string, unknown> | undefined,
    deliveries: readonly DeliveryLink[],
  ) {
    const links: Array<typeof InboxLink.Type> = [];
    if (row?.role)
      links.push(
        decodeSync(
          InboxLink,
          {
            role: row.role,
            issue_id: row.issue_id,
            status: row.status,
            revision: row.revision ?? undefined,
          },
          "GitHub assignment",
        ),
      );
    for (const d of deliveries)
      links.push({ role: "delivery", issue_id: d.issue_id, status: d.status });
    return links;
  }
  find(scopes: readonly string[], query: InboxQuery, deliveries: readonly DeliveryLink[]) {
    const args: string[] = [JSON.stringify(scopes), query.state ?? "OPEN"];
    const filters = ["partition IN (SELECT value FROM json_each(?))", "state=?"];
    if (query.kind) {
      filters.push("kind=?");
      args.push(query.kind);
    }
    if (query.search) {
      filters.push(
        "instr(abracode_lower(json_extract(summary,'$.title') || ' ' || project || '#' || json_extract(summary,'$.number')),?)>0",
      );
      args.push(query.search.toLowerCase());
    }
    if (query.label) {
      filters.push(
        "EXISTS (SELECT 1 FROM json_each(summary,'$.labels') WHERE abracode_lower(value)=?)",
      );
      args.push(query.label.toLowerCase());
    }
    if (query.role) {
      const assigned = "EXISTS(SELECT 1 FROM github_links WHERE source=github_items.source_id";
      const delivered =
        "EXISTS(SELECT 1 FROM json_each(?) WHERE json_extract(value,'$.url')=json_extract(summary,'$.url') AND json_extract(value,'$.repository_id')=project)";
      if (query.role === "linked") {
        filters.push("(" + assigned + ") OR " + delivered + ")");
        args.push(JSON.stringify(deliveries));
      } else if (query.role === "unassigned") {
        filters.push("NOT " + assigned + ") AND NOT " + delivered);
        args.push(JSON.stringify(deliveries));
      } else if (query.role === "delivery") {
        filters.push(delivered);
        args.push(JSON.stringify(deliveries));
      } else {
        filters.push(assigned + " AND role=?)");
        args.push(query.role);
      }
    }
    const where = " FROM github_items WHERE " + filters.join(" AND ");
    return runTransaction(
      this.db,
      () => {
        const total = Number(this.db.prepare("SELECT count(*) AS n" + where).get(...args)!.n);
        const byUrl = new Map<string, DeliveryLink[]>();
        for (const d of deliveries) {
          const key = JSON.stringify([d.repository_id, d.url]);
          const matches = byUrl.get(key);
          if (matches) matches.push(d);
          else byUrl.set(key, [d]);
        }
        const entries = this.db
          .prepare(
            "SELECT page.summary,l.role,l.issue_id,i.status,l.revision FROM (SELECT summary,source_id,updated,partition,node" +
              where +
              " ORDER BY updated DESC,partition,node LIMIT 50 OFFSET ?) page LEFT JOIN github_links l ON l.source=page.source_id LEFT JOIN issues i ON i.id=l.issue_id ORDER BY page.updated DESC,page.partition,page.node",
          )
          .all(...args, query.offset ?? 0)
          .map((row) => {
            const item = decodeSync(
              Schema.fromJsonString(InboxSummary),
              row.summary,
              "GitHub summary",
            );
            return {
              ...item,
              links: this.projectLinks(
                row,
                byUrl.get(JSON.stringify([item.repository_id, item.url])) ?? [],
              ),
            };
          });
        return { entries, total };
      },
      false,
    );
  }
}
export type DeliveryLink = {
  repository_id: RepositoryId;
  url: string;
  issue_id: IssueId;
  status: string;
};
