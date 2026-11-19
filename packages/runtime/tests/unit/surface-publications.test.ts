import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vite-plus/test";
import { Effect } from "effect";
import { CrewError } from "../../src/domain.ts";
import { IssueId, MessageId, SessionId, StorageKey } from "../../src/identities.ts";
import { SurfacePublications } from "../../src/web/surface-publications.ts";
import { validateSurface, catalogId } from "../../src/web/surfaces.ts";
import { WorkspaceFixture } from "../helpers/web.ts";
import { MemoryStore, TestLocks } from "../fixtures.ts";
import { run } from "../effects.ts";

const session = SessionId.make("ses_surface");
const surface = (text: string, id = "board") =>
  validateSurface({
    version: "1.0",
    createSurface: {
      surfaceId: id,
      catalogId,
      components: [
        { id: "root", component: "Column", children: ["heading", "work"] },
        { id: "heading", component: "Text", text },
        { id: "work", component: "WorkTable", issueIds: ["abra-web"], mode: "snapshot" },
      ],
    },
  });
const source = (message: string, text: string, id?: string) => ({
  session_id: session,
  message_id: MessageId.make(message),
  call_id: "call-observation",
  surface: surface(text, id),
});
function fixture() {
  const store = new MemoryStore(),
    locks = new TestLocks(),
    workspace = new WorkspaceFixture();
  let reads = 0;
  const observe = Effect.sync(() => {
    reads++;
    return workspace.value.work;
  });
  return {
    store,
    locks,
    workspace,
    observe,
    owner: new SurfacePublications(store, locks),
    reads: () => reads,
  };
}

test("cyclic, excessive, executable and unsafe replacements preserve the published revision", async () => {
  const f = fixture();
  await run(f.owner.publish(source("msg_valid", "Retain this view"), f.observe));
  const before = structuredClone([...f.store.values]);
  const replacements = [
    [{ id: "root", component: "Column", children: ["root"] }],
    [
      {
        id: "root",
        component: "Column",
        children: Array.from({ length: 100 }, (_, i) => `text${i}`),
      },
      ...Array.from({ length: 100 }, (_, i) => ({
        id: `text${i}`,
        component: "Text",
        text: "Excessive",
      })),
    ],
    [{ id: "root", component: "Approval", action: "authorize" }],
    [
      {
        id: "root",
        component: "ResourceLink",
        label: "Unsafe",
        target: { action: "open_changes", issue_id: "abra-web", file: "../secret" },
      },
    ],
    [
      {
        id: "root",
        component: "ResourceLink",
        label: "Callback",
        target: { action: "open_task", issue_id: "abra-web" },
        onClick: "approve",
      },
    ],
  ];
  for (const [index, components] of replacements.entries()) {
    const input = source(`msg_invalid${index}`, "Invalid replacement");
    await assert.rejects(
      run(
        f.owner.publish(
          {
            ...input,
            surface: {
              ...input.surface,
              createSurface: { ...input.surface.createSurface, components },
            },
          },
          f.observe,
        ),
      ),
      /Invalid surface layout/,
    );
    assert.deepEqual([...f.store.values], before);
  }
  assert.equal(
    (await run(f.owner.read(session, "board", 1))).surface.createSurface.components[1].text,
    "Retain this view",
  );
});

test("generated layouts and associations retain exact immutable revisions across retries", async () => {
  const f = fixture();
  const first = await run(f.owner.publish(source("msg_first", "First layout"), f.observe));
  f.workspace.value = {
    ...f.workspace.value,
    work: {
      ...f.workspace.value.work,
      work: [{ ...f.workspace.value.work.work[0], title: "Later live title" }],
    },
  };
  const second = await run(f.owner.publish(source("msg_second", "Second layout"), f.observe));
  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.equal(
    (await run(f.owner.read(session, "board", 1))).snapshot[0].title,
    "Build a single workspace",
  );
  assert.equal(
    (await run(f.owner.read(session, "board", 2))).snapshot[0].title,
    "Later live title",
  );
  assert.deepEqual(
    await run(f.owner.publish(source("msg_first", "First layout"), f.observe)),
    first,
  );
  assert.equal(f.reads(), 2, "Same-identity retry must not recapture current observations");
  assert.equal(
    (
      (await f.store
        .get(StorageKey.make(`web/surface/${session}/board`))
        .pipe(Effect.runPromise)) as { revision: number }
    ).revision,
    2,
  );
  const page = await run(
    f.owner.associations(session, [MessageId.make("msg_first"), MessageId.make("msg_second")]),
  );
  assert.deepEqual(
    page.entries.map((entry) => entry.target.kind === "surface" && entry.target.revision),
    [1, 2],
  );
  assert.equal(page.truncated, false);
  await assert.rejects(
    run(f.owner.publish(source("msg_first", "Changed input"), f.observe)),
    /bound to another surface/,
  );
  assert.equal(f.reads(), 2);
  assert.equal(
    [...f.store.values.keys()].filter((key) => key.startsWith("web/surface-publication/")).length,
    2,
  );
});

for (const phase of [
  "web/surface-head/",
  "web/surface-publication/",
  "web/surface-revision/",
  "web/surface-call/",
  "web/surface/",
  "web/presentation/",
]) {
  for (const replacement of [false, true])
    test(`surface recovery (replacement=${replacement}) repairs interruption after ${phase} without replay or recapture`, async () => {
      const f = fixture();
      const prior = source("msg_prior", "Previously committed");
      if (replacement) await run(f.owner.publish(prior, f.observe));
      const revision = replacement ? 2 : 1;
      const set = f.store.set.bind(f.store);
      let crash = true;
      f.store.set = (key, value) =>
        set(key, value).pipe(
          Effect.andThen(
            Effect.suspend(() => {
              if (crash && key.startsWith(phase)) {
                crash = false;
                return Effect.fail(new CrewError("CRASH", "Retained publication response lost"));
              }
              return Effect.void;
            }),
          ),
        );
      await assert.rejects(
        run(f.owner.publish(source("msg_crash", "Captured before interruption"), f.observe)),
        /response lost/,
      );
      await assert.rejects(run(f.owner.read(session, "board", revision)), /not retained|pending/);
      await assert.rejects(run(f.owner.readCurrent(session, "board", revision)), /changed/);
      assert.deepEqual(
        (await run(f.owner.associations(session, [MessageId.make("msg_crash")]))).entries,
        [],
      );
      const visible = await run(f.owner.list(session));
      assert.deepEqual(
        visible.map((row) => "revision" in row && row.revision),
        replacement ? [1] : [],
      );
      if (replacement)
        assert.deepEqual(
          (await run(f.owner.readCurrent(session, "board", 1))).surface,
          prior.surface,
        );
      f.workspace.value = {
        ...f.workspace.value,
        work: {
          ...f.workspace.value.work,
          work: [{ ...f.workspace.value.work.work[0], title: "Changed after interruption" }],
        },
      };
      const restarted = new SurfacePublications(f.store, new TestLocks());
      assert.deepEqual(await run(restarted.recover(session)), []);
      assert.equal(f.reads(), revision);
      const captured = await run(restarted.read(session, "board", revision));
      assert.equal(captured.snapshot[0].title, "Build a single workspace");
      const associations = await run(
        restarted.associations(session, [MessageId.make("msg_crash")]),
      );
      assert.equal(associations.entries.length, 1);
      assert.equal(associations.entries[0].tool_call_id, "call-observation");
      assert.equal(
        (
          await run(
            restarted.publish(source("msg_crash", "Captured before interruption"), f.observe),
          )
        ).revision,
        revision,
      );
      await assert.rejects(
        run(restarted.publish(source("msg_crash", "Changed retry"), f.observe)),
        /bound to another surface/,
      );
      assert.equal(f.reads(), revision);
      assert.equal(
        [...f.store.values.keys()].filter((key) => key.startsWith("web/surface-publication/"))
          .length,
        revision,
      );
      if (replacement) {
        await run(restarted.publish(prior, f.observe));
        assert.equal(
          (await run(restarted.readCurrent(session, "board", revision))).message_id,
          "msg_crash",
        );
      }
      assert.equal(f.locks.held, false);
    });
}

test("legacy latest-only layouts and original request retries do not invent earlier history or provenance", async () => {
  const f = fixture(),
    old = source("msg_legacy", "Original legacy input");
  const layout = surface("Latest retained legacy layout");
  await run(
    f.store.set(StorageKey.make(`web/surface/${session}/board`), {
      session_id: session,
      tool_call_id: "unproven-legacy-source",
      revision: 2,
      at: f.workspace.value.at,
      surface: layout,
      snapshot: f.workspace.value.work.work,
    }),
  );
  const receipt = createHash("sha256").update(`${old.message_id}/${old.call_id}`).digest("hex");
  await run(
    f.store.set(StorageKey.make(`web/surface-call/${session}/${receipt}`), {
      surface_id: "board",
      revision: 1,
      input_hash: createHash("sha256").update(JSON.stringify(old.surface)).digest("hex"),
    }),
  );
  assert.equal((await run(f.owner.read(session, "board", 2))).history, "latest-only");
  await assert.rejects(
    run(f.owner.read(session, "board", 1)),
    /exact layout revision was not retained/,
  );
  assert.deepEqual(await run(f.owner.publish(old, f.observe)), {
    surface_id: "board",
    revision: 1,
    version: "1.0",
  });
  assert.deepEqual((await run(f.owner.associations(session, [old.message_id]))).entries, []);
  assert.equal(f.reads(), 0);
  assert.equal(
    [...f.store.values.keys()].some((key) => key.startsWith("web/surface-publication/")),
    false,
  );
});

test("older heads expose their proved predecessor and a lost final response leaves the revision committed", async () => {
  const f = fixture(),
    key = StorageKey.make(`web/surface-head/${session}/board`);
  await run(f.owner.publish(source("msg_original", "One"), f.observe));
  const set = f.store.set.bind(f.store);
  f.store.set = (path, value) => {
    if (path !== key) return set(path, value);
    const head = { ...(value as Record<string, unknown>) };
    delete head.committed_revision;
    return set(path, head).pipe(
      Effect.andThen(Effect.fail(new CrewError("CRASH", "Head written"))),
    );
  };
  const second = source("msg_replacement", "Two");
  await assert.rejects(run(f.owner.publish(second, f.observe)), /Head written/);
  assert.equal((await run(f.owner.readCurrent(session, "board", 1))).message_id, "msg_original");
  await assert.rejects(run(f.owner.read(session, "board", 2)), /pending/);
  await assert.rejects(run(f.owner.publish(second, f.observe)), /Head written/);
  assert.equal((await run(f.owner.readCurrent(session, "board", 2))).message_id, "msg_replacement");
  f.store.set = set;
  await run(f.owner.publish(second, f.observe));
  assert.equal(f.reads(), 2);
});
test("surface integrity and selection failures preserve unrelated publications and native records", async () => {
  const f = fixture();
  await run(f.owner.publish(source("msg_one", "First"), f.observe));
  await run(f.owner.publish(source("msg_two", "Second", "other"), f.observe));
  const key = [...f.store.values.keys()].find((key) => key.startsWith("web/surface-publication/"))!;
  const record = structuredClone(f.store.values.get(key)) as { record: { at: string } };
  record.record.at = "Changed without a matching hash";
  f.store.values.set(key, record);
  const before = structuredClone([...f.store.values]);
  await assert.rejects(run(f.owner.read(session, "board", 1)), /integrity/);
  assert.equal(
    (await run(f.owner.read(session, "other", 1))).surface.createSurface.surfaceId,
    "other",
  );
  await assert.rejects(
    run(f.owner.read(SessionId.make("ses_foreign"), "other", 1)),
    /not retained/,
  );
  await assert.rejects(run(f.owner.read(session, "../escape", 1)), /Surface selection/);
  await assert.rejects(run(f.owner.read(session, "other", 0)), /Surface revision/);
  assert.deepEqual([...f.store.values], before);
});

test("unfiltered snapshot siblings retain all observed work and explicit references under retries", async () => {
  const f = fixture();
  const first = f.workspace.value.work.work[0]!;
  f.workspace.value = {
    ...f.workspace.value,
    work: {
      ...f.workspace.value.work,
      work: [
        first,
        { ...first, issue_id: IssueId.make("abra-second"), title: "Second observed task" },
      ],
    },
  };
  const mixed = validateSurface({
    version: "1.0",
    createSurface: {
      surfaceId: "mixed",
      catalogId,
      components: [
        { id: "root", component: "Column", children: ["table", "link"] },
        { id: "table", component: "WorkTable", mode: "snapshot" },
        { id: "link", component: "ReportLink", issueId: first.issue_id },
      ],
    },
  });
  const input = { ...source("msg_mixed", ""), surface: mixed };
  await run(f.owner.publish(input, f.observe));
  const captured = await run(f.owner.read(session, "mixed", 1));
  assert.deepEqual(
    new Set(captured.snapshot.map((row) => row.issue_id)),
    new Set([first.issue_id, "abra-second"]),
  );
  assert.equal(captured.coverage?.returned, 2);
  f.workspace.value = { ...f.workspace.value, work: { ...f.workspace.value.work, work: [] } };
  await run(f.owner.publish(input, f.observe));
  assert.equal(f.reads(), 1);
  assert.deepEqual(await run(f.owner.read(session, "mixed", 1)), captured);
  await assert.rejects(
    run(f.owner.publish({ ...input, message_id: MessageId.make("msg_missing") }, f.observe)),
    /unavailable work/,
  );
  assert.deepEqual(await run(f.owner.read(session, "mixed", 1)), captured);
});
