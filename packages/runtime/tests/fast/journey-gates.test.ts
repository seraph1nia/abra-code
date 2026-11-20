import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { JourneyGates } from "../e2e/journey-gates.ts";

test("journey releases are sticky, wake every observer and end with their run", async () => {
  const first = new JourneyGates(),
    second = new JourneyGates();
  first.release("before");
  await first.wait("before");
  const observers = [first.wait("worker"), first.wait("worker")];
  let otherReleased = false;
  const other = second.wait("worker").then(() => {
    otherReleased = true;
  });
  first.release("worker");
  await Promise.all(observers);
  assert.equal(otherReleased, false);
  assert.deepEqual([...first.seen], ["before", "worker"]);
  second.close();
  await other;
  await second.wait("late");
});
