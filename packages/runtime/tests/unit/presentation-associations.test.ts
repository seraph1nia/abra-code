import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { Schema } from "effect";
import { PresentationAssociations } from "../../src/presentation/associations.ts";
import { PresentationAttachmentSchema } from "../../src/presentation/contracts.ts";
import { SessionId, MessageId } from "../../src/identities.ts";
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
