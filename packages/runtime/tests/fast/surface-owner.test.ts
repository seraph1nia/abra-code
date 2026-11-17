import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { SurfaceOwner } from "@abracode/presentation/surface-owner";

test("generated surface lifecycle stages replacements and recreates retired processors after diagnostic cleanup", () => {
  const created: { revision: number; disposed: number }[] = [];
  const owner = new SurfaceOwner(
    { revision: 1 },
    (record) => {
      if (record.revision === 3) throw new Error("invalid replacement");
      const view = { revision: record.revision, disposed: 0 };
      created.push(view);
      return view;
    },
    (view) => {
      view.disposed++;
    },
  );
  const first = owner.subscribe(() => {});
  const second = owner.subscribe(() => {});
  assert.equal(created.length, 1);
  first();
  assert.equal(created[0].disposed, 0, "independent mounted reader still owns this processor");
  owner.replace({ revision: 2 });
  assert.equal(owner.read().rendered?.revision, 2);
  assert.equal(created[0].disposed, 0, "old committed view survives while replacement is staged");
  owner.committed(owner.read());
  assert.equal(created[0].disposed, 1);
  owner.replace({ revision: 3 });
  assert.equal(owner.read().rendered?.revision, 2, "malformed revision retains valid view");
  assert.match(owner.read().error!, /invalid/);
  owner.replace({ revision: 2 });
  owner.committed(owner.read());
  second();
  assert.ok(created.every((view) => view.disposed === 1));
  assert.equal(owner.read().rendered, undefined);
  const replay = owner.subscribe(() => {});
  assert.equal(owner.read().rendered?.revision, 2);
  assert.equal(created.at(-1)!.disposed, 0, "diagnostic setup must create a new live processor");
  replay();
  assert.ok(created.every((view) => view.disposed === 1));
});
