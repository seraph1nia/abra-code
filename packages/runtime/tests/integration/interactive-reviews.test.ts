import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { Reviews } from "../../src/web/reviews.ts";
import { MemoryStore, TestLocks } from "../fixtures.ts";
import { AbsolutePath, MessageId, SessionId } from "../../src/identities.ts";
import { previewPNG, reviewDefinition } from "../helpers/interactive-reviews.ts";

test("retained preview bytes survive source removal and reject escapes, size, type and corruption", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "abra-review-assets-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const tree = AbsolutePath.make(join(root, "tree"));
  await mkdir(tree);
  const file = join(tree, "design.png");
  await writeFile(file, previewPNG);
  const store = new MemoryStore(),
    locks = new TestLocks(),
    session = SessionId.make("ses_assets"),
    message = MessageId.make("msg_assets");
  const source = () => Effect.succeed({ text: "Plan", root: tree });
  const reviews = new Reviews(store, locks, source);
  const review = {
    ...reviewDefinition(),
    fields: [
      ...reviewDefinition().fields,
      {
        component: "DesignChoiceGroup" as const,
        id: "design",
        label: "Design",
        options: [{ value: "a", label: "Design A", preview: "first" }],
      },
    ],
  };
  const ref = await Effect.runPromise(
    reviews.publish(session, message, "publish", {
      review,
      previews: [{ id: "first", path: "design.png" as never }],
    }),
  );
  const view = await Effect.runPromise(reviews.read(session, ref)),
    asset = view.record.assets[0]!;
  await rm(file);
  const restarted = new Reviews(store, locks, source);
  assert.deepEqual(
    Buffer.from(
      (await Effect.runPromise(restarted.asset(session, { ...ref, hash: asset.hash }))).data,
      "base64",
    ),
    previewPNG,
  );
  await assert.rejects(
    Effect.runPromise(restarted.asset(SessionId.make("ses_foreign"), { ...ref, hash: asset.hash })),
  );
  await writeFile(join(root, "outside.png"), previewPNG);
  await symlink(join(root, "outside.png"), join(tree, "link.png"));
  await assert.rejects(
    Effect.runPromise(
      reviews.publish(session, message, "escape", {
        review,
        previews: [{ id: "first", path: "link.png" as never }],
      }),
    ),
  );
  await writeFile(join(tree, "script.svg"), "<svg><script>alert(1)</script></svg>");
  await assert.rejects(
    Effect.runPromise(
      reviews.publish(session, message, "svg", {
        review,
        previews: [{ id: "first", path: "script.svg" as never }],
      }),
    ),
  );
  await writeFile(join(tree, "large.png"), Buffer.alloc(2 * 1024 * 1024 + 1));
  await assert.rejects(
    Effect.runPromise(
      reviews.publish(session, message, "large", {
        review,
        previews: [{ id: "first", path: "large.png" as never }],
      }),
    ),
  );
  const dataKey = [...store.values.keys()].find((k) => k.includes("/asset/"))!;
  store.values.set(dataKey, {
    ...(store.values.get(dataKey) as object),
    data: Buffer.from("changed").toString("base64"),
  });
  await assert.rejects(
    Effect.runPromise(restarted.asset(session, { ...ref, hash: asset.hash })),
    /integrity/,
  );
});

test("aggregate raster budget refuses five individually valid 2 MiB previews", async (t) => {
  const root = AbsolutePath.make(await mkdtemp(join(tmpdir(), "abra-review-budget-")));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.alloc(2 * 1024 * 1024);
  previewPNG.copy(bytes);
  await writeFile(join(root, "large.png"), bytes);
  const options = Array.from({ length: 5 }, (_, i) => ({
    value: `v${i}`,
    label: `Design ${i}`,
    preview: `p${i}`,
  }));
  const review = {
    ...reviewDefinition(),
    fields: [{ component: "DesignChoiceGroup" as const, id: "design", label: "Design", options }],
  };
  const reviews = new Reviews(new MemoryStore(), new TestLocks(), () =>
    Effect.succeed({ text: "Plan", root }),
  );
  await assert.rejects(
    Effect.runPromise(
      reviews.publish(SessionId.make("ses_budget"), MessageId.make("msg_budget"), "publish", {
        review,
        previews: options.map((o) => ({ id: o.preview, path: "large.png" as never })),
      }),
    ),
    /8 MiB/,
  );
});
