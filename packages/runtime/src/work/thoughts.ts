import { sha256 } from "../digest.ts";
import { WorkGraphError } from "../errors.ts";
import type { WorkGraph } from "./graph.ts";
import type { ThoughtSave } from "@abracode/contracts/visibility/thoughts";
import { createHmac } from "node:crypto";
import { Effect, Redacted, Result, Schema } from "effect";
import {
  MemoAccount,
  MemoName,
  type ThoughtReference,
  type ThoughtQuery,
} from "@abracode/contracts/visibility/thoughts";
import { memosConnection } from "../config/memos.ts";
import { type Config } from "../domain.ts";
import { decode } from "../decode.ts";
import { httpDriver } from "../platform.ts";
import { MemosTransport } from "./memos-transport.ts";

const account = Schema.Struct({ user: Schema.Struct({ name: MemoAccount }) });
const memo = Schema.Struct({
  name: MemoName,
  creator: MemoAccount,
  visibility: Schema.String,
  state: Schema.String,
  space: Schema.optional(Schema.String),
  parent: Schema.optional(Schema.String),
  content: Schema.String,
  snippet: Schema.String,
  tags: Schema.Array(Schema.String),
  createTime: Schema.String,
  updateTime: Schema.String,
});
type Memo = typeof memo.Type;
const page = Schema.Struct({
  memos: Schema.Array(memo),
  nextPageToken: Schema.optional(Schema.String),
});
const hash = (value: string) => sha256(value);
type Transport = "mcp" | "http";
const changed = () =>
  new WorkGraphError(
    "MEMOS_CHANGED",
    "This thought’s wording changed. Search again and reselect it.",
  );
const missing = () => new WorkGraphError("MEMOS_MISSING", "The selected thought is unavailable.");
const queryError = () =>
  new WorkGraphError("MEMOS_QUERY", "Choose a valid UTC date range, with the end after the start.");

function decodeMemos<S extends Schema.Constraint>(schema: S, raw: unknown) {
  return decode(schema, raw, "Memos response").pipe(
    Effect.mapError(
      () =>
        new WorkGraphError(
          "MEMOS_UNAVAILABLE",
          "The notebook returned an unexpected response. Check the Memos version and retry.",
        ),
    ),
  );
}

function buildFilter(owner: string, q: ThoughtQuery) {
  const clauses = [
    'visibility == "PRIVATE"',
    "space == null",
    "creator == " + JSON.stringify(owner),
  ];
  if (q.text) clauses.push("content.contains(" + JSON.stringify(q.text) + ")");
  if (q.tag) clauses.push(JSON.stringify(q.tag) + " in tags");
  for (const [day, operator] of [
    [q.from, ">="],
    [q.until, "<"],
  ] as const) {
    if (!day) continue;
    const iso = day + "T00:00:00.000Z";
    const time = Date.parse(iso);
    if (!Number.isFinite(time) || new Date(time).toISOString() !== iso) throw queryError();
    clauses.push("created_ts " + operator + " timestamp(" + JSON.stringify(iso) + ")");
  }
  if (q.from && q.until && q.from >= q.until) throw queryError();
  return clauses.join(" && ");
}
function summary(instance: string, owner: string, m: Memo) {
  if (
    m.creator !== owner ||
    m.visibility !== "PRIVATE" ||
    m.space ||
    m.parent ||
    m.state !== "NORMAL"
  )
    throw missing();
  return {
    reference: { instance, account: owner, name: m.name, wording_hash: hash(m.content) },
    snippet: m.snippet.slice(0, 512),
    tags: m.tags,
    created_at: m.createTime,
    updated_at: m.updateTime,
  };
}
export class PersonalThoughts {
  constructor(
    private config: Pick<Config, "memos">,
    private receipts: Pick<WorkGraph, "reserveThought" | "setThoughtSubmission">,
  ) {}
  private connect() {
    return Effect.gen({ self: this }, function* () {
      const connection = yield* memosConnection(this.config);
      const api = new MemosTransport(connection, yield* httpDriver);
      const identity = yield* api
        .http("auth/me")
        .pipe(Effect.flatMap((r) => decodeMemos(account, r)));
      return { ...connection, api, owner: identity.user.name };
    });
  }
  list(q: ThoughtQuery, transport: Transport) {
    return Effect.gen({ self: this }, function* () {
      const { instance, token, api, owner } = yield* this.connect();
      const filter = yield* Effect.try({ try: () => buildFilter(owner, q), catch: queryError });
      const sign = (value: string) =>
        createHmac("sha256", Redacted.value(token))
          .update(JSON.stringify([instance, owner, filter, value]))
          .digest("base64url");
      const args = { filter, orderBy: "create_time desc, name desc", state: "NORMAL" };
      let upstream = "";
      if (q.cursor) {
        const i = q.cursor.indexOf(".");
        upstream = q.cursor.slice(i + 1);
        if (i < 0 || !upstream || q.cursor.slice(0, i) !== sign(upstream))
          return yield* new WorkGraphError(
            "MEMOS_CURSOR",
            "The notebook or filters changed. Restart the search.",
          );
      }
      const raw = yield* transport === "http"
        ? api.http("memos", { ...args, pageSize: "20", pageToken: upstream })
        : api.mcp("list", { ...args, pageSize: 20, pageToken: upstream });
      const rows = yield* decodeMemos(page, raw);
      const entries = yield* Effect.try({
        try: () => rows.memos.map((m) => summary(instance, owner, m)),
        catch: missing,
      });
      return {
        entries,
        next_cursor: rows.nextPageToken
          ? sign(rows.nextPageToken) + "." + rows.nextPageToken
          : undefined,
      };
    });
  }
  save(input: typeof ThoughtSave.Type) {
    return Effect.gen({ self: this }, function* () {
      const { instance, api, owner } = yield* this.connect();
      const digest = hash(input.content);
      const key = hash(JSON.stringify([instance, owner, input.request_id]));
      const receipt = yield* this.receipts.reserveThought(key, digest);
      const read = api.mcp("get", { memo: receipt.id });
      let result = receipt.fresh ? undefined : yield* Effect.result(read);
      if (
        !result ||
        (Result.isFailure(result) &&
          result.failure.code === "MEMOS_MISSING" &&
          result.failure.details === 404)
      ) {
        if (yield* this.receipts.setThoughtSubmission(key, true)) {
          const create = yield* Effect.result(
            api.mcp("create", {
              memoId: receipt.id,
              body: { content: input.content, visibility: "PRIVATE" },
            }),
          );
          if (
            Result.isFailure(create) &&
            ["MEMOS_CREATE_REFUSED", "MEMOS_CREATE_UNSUBMITTED"].includes(create.failure.code)
          )
            yield* this.receipts.setThoughtSubmission(key, false);
          result = yield* Effect.result(read);
        }
      }
      if (!result) result = yield* Effect.result(read);
      if (Result.isFailure(result))
        return yield* new WorkGraphError(
          "MEMOS_UNRESOLVED",
          "Could not verify this save. Retry with the same request ID.",
        );
      const m = yield* decodeMemos(memo, result.success);
      const row = yield* Effect.try({ try: () => summary(instance, owner, m), catch: missing });
      if (m.name !== "memos/" + receipt.id || row.reference.wording_hash !== digest)
        return yield* new WorkGraphError(
          "MEMOS_CONFLICT",
          "The stored thought differs from this save request.",
        );
      return row.reference;
    });
  }
  get(ref: ThoughtReference, transport: Transport) {
    return Effect.gen({ self: this }, function* () {
      const { instance, api, owner } = yield* this.connect();
      if (ref.instance !== instance || ref.account !== owner) return yield* missing();
      const raw = yield* transport === "http"
        ? api.http(ref.name)
        : api.mcp("get", { memo: ref.name.slice(6) });
      const m = yield* decodeMemos(memo, raw);
      if (m.name !== ref.name) return yield* missing();
      const row = yield* Effect.try({ try: () => summary(instance, owner, m), catch: missing });
      if (row.reference.wording_hash !== ref.wording_hash) return yield* changed();
      return { ...row, content: m.content, url: instance + "/" + m.name };
    });
  }
}
