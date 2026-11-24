import { SurfacePublications } from "../../src/web/surface-publications.ts";
import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Effect, Schema } from "effect";
import {
  PresentationAssociations,
  searchPublications,
} from "../../src/presentation/associations.ts";
import { PresentationAttachmentSchema } from "@abracode/contracts/presentation/contracts";
import { SessionId, MessageId } from "@abracode/contracts/identities";
import { MemoryStore, TestLocks } from "../fixtures.ts";
import { run } from "../effects.ts";

test("message associations are immutable, scoped and individually diagnosed without hiding valid history", async () => {
  const store = new MemoryStore(),
    owner = new PresentationAssociations(store, new TestLocks());
  const attachment = Schema.decodeSync(PresentationAttachmentSchema)({
    session_id: "ses_abra",
    message_id: "msg_notice",
    source: "notice",
    target: {
      kind: "artifact",
      issue_id: "task-one",
      request_id: "report-one",
      hash: "a".repeat(40),
    },
  });
  await run(owner.associate(attachment));
  await run(owner.associate(attachment));
  const changed = Schema.decodeSync(PresentationAttachmentSchema)({
    session_id: "ses_abra",
    message_id: "msg_notice",
    source: "notice",
    target: {
      kind: "artifact",
      issue_id: "task-one",
      request_id: "report-one",
      hash: "b".repeat(40),
    },
  });
  await assert.rejects(run(owner.associate(changed)), /cannot be rebound/);
  assert.throws(() =>
    Schema.decodeSync(PresentationAttachmentSchema)({ ...attachment, source: "tool" }),
  );
  const key = [...store.values.keys()][0],
    prefix = key.slice(0, key.lastIndexOf("/"));
  store.values.set(`${prefix}/broken`, { source: "tool", sensitive: "must-not-appear" });
  store.values.set(`${prefix}/foreign`, { ...attachment, session_id: "ses_foreign" });
  const before = structuredClone([...store.values]);
  const page = await run(owner.read(SessionId.make("ses_abra"), [MessageId.make("msg_notice")]));
  assert.deepEqual(page.entries, [attachment]);
  assert.equal(page.diagnostics.length, 2);
  assert.doesNotMatch(JSON.stringify(page), /must-not-appear|ses_foreign/);
  assert.deepEqual([...store.values], before);
  assert.deepEqual(
    (await run(owner.read(SessionId.make("ses_foreign"), [MessageId.make("msg_notice")]))).entries,
    [],
  );
});

test("publication search pages old revisions by producing session and diagnoses a forged association", async () => {
  const store = new MemoryStore();
  const owner = new PresentationAssociations(store, new TestLocks());
  const session = SessionId.make("ses_abra");
  for (const revision of [1, 2]) {
    await run(
      owner.associate(
        Schema.decodeSync(PresentationAttachmentSchema)({
          session_id: session,
          message_id: "msg_revision_" + revision,
          source: "notice",
          target: { kind: "surface", surface_id: "changes", revision },
        }),
      ),
    );
  }
  store.values.set("web/presentation/ses_abra/zz", {
    ...([...store.values.values()][0] as object),
    session_id: "ses_elsewhere",
  });
  const reader: Parameters<typeof searchPublications>[0] = {
    page: (prefix, after) => store.page(prefix, after, 1),
  };
  const gets: string[] = [];
  const get = store.get.bind(store);
  store.get = (key) => {
    gets.push(key);
    return get(key);
  };
  const surfaces = new SurfacePublications(store, new TestLocks());
  const committed = (target: { revision: number }) =>
    surfaces.searchCommitted(session, "changes", target.revision);
  store.values.set("web/surface-head/ses_abra/changes", {
    schema_version: 1,
    session_id: session,
    surface_id: "changes",
    next_revision: 3,
    committed_revision: 2,
  });
  const q = { kind: "surface" as const, search: "changes" };
  const first = await run(searchPublications(reader, session, q, committed));
  const next = await run(
    searchPublications(reader, session, { ...q, cursor: first.next }, committed),
  );
  const forged = await run(
    searchPublications(reader, session, { ...q, cursor: next.next }, committed),
  );
  assert.deepEqual(
    [...first.entries, ...next.entries]
      .map((r) => (r.target.kind === "surface" ? r.target.revision : 0))
      .sort((a, b) => a - b),
    [1, 2],
  );
  const filtered = await run(searchPublications(reader, session, q, () => Effect.succeed(false)));
  assert.deepEqual(filtered.entries, []);
  assert.ok(filtered.next);
  assert.deepEqual(
    (await run(searchPublications(reader, SessionId.make("ses_other"), q, committed))).entries,
    [],
  );
  assert.ok(gets.length && gets.every((key) => key.startsWith("web/surface-head/")));
  assert.equal(forged.incomplete, true);
  assert.deepEqual(forged.entries, []);
});
