import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { RegistryContext } from "@effect/atom-react";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { Context, Deferred, Effect, Exit } from "effect";
import { test } from "vite-plus/test";
import { WorkspaceApi, useWorkspaceCall } from "../src/data.ts";
import { workspaceDraft } from "../src/workspace-state/draft.ts";
import { committedAtom } from "../src/committed-atom.ts";
import { useRetainedSubmission } from "../src/use-retained-submission.ts";

test("a retained submission gates dispatch on persistence and owns one in-flight attempt", async (t) => {
  const registry = AtomRegistry.make({
    initialValues: [[WorkspaceApi.runtime, AsyncResult.success(Context.empty())]],
  });
  t.onTestFinished(() => registry.dispose());
  const gate = Deferred.makeUnsafe<string>();
  let retained = 0,
    dispatched = 0;
  const retain = () => {
    retained++;
    return true;
  };
  let submit!: (
    input: Deferred.Deferred<string>,
    retain: () => boolean,
  ) => Promise<Exit.Exit<string> | undefined>;
  function Probe() {
    submit = useRetainedSubmission((input: Deferred.Deferred<string>) => {
      dispatched++;
      return Deferred.await(input);
    }).submit;
    return null;
  }
  renderToString(
    createElement(RegistryContext.Provider, { value: registry }, createElement(Probe)),
  );
  assert.equal(await submit(gate, () => false), undefined);
  assert.equal(dispatched, 0);
  const pending = submit(gate, retain);
  assert.equal(await submit(gate, retain), undefined);
  await Effect.runPromise(Deferred.succeed(gate, "recorded"));
  assert.deepEqual(await pending, Exit.succeed("recorded"));
  assert.deepEqual([retained, dispatched], [1, 1]);
  assert.deepEqual(await submit(gate, retain), Exit.succeed("recorded"));
  assert.deepEqual([retained, dispatched], [2, 2]);
});

test("committed atom readers share the latest value until the last subscription closes", (t) => {
  const registry = AtomRegistry.make();
  t.onTestFinished(() => registry.dispose());
  const value = Atom.make(2);
  const reader = committedAtom(registry, value, "pending", String);
  assert.equal(reader.read(), "pending");
  const releaseFirst = reader.subscribe(() => {});
  const releaseSecond = reader.subscribe(() => {});
  assert.equal(reader.read(), "2");
  releaseFirst();
  registry.set(value, 3);
  assert.equal(reader.read(), "3");
  releaseSecond();
  registry.set(value, 4);
  assert.equal(reader.read(), "3");
});

test("overlapping workspace calls return their own selected resource", async (t) => {
  const registry = AtomRegistry.make({
    initialValues: [[WorkspaceApi.runtime, AsyncResult.success(Context.empty())]],
  });
  t.onTestFinished(() => registry.dispose());
  const first = Deferred.makeUnsafe<string>();
  const second = Deferred.makeUnsafe<string>();
  let resolve!: (gate: Deferred.Deferred<string>) => Promise<Exit.Exit<string>>;
  function Probe() {
    resolve = useWorkspaceCall((gate: Deferred.Deferred<string>) => Deferred.await(gate));
    return null;
  }
  renderToString(
    createElement(RegistryContext.Provider, { value: registry }, createElement(Probe)),
  );
  const a = resolve(first);
  const b = resolve(second);
  await Effect.runPromise(Deferred.succeed(second, "second"));
  assert.deepEqual(await b, Exit.succeed("second"));
  await Effect.runPromise(Deferred.succeed(first, "first"));
  assert.deepEqual(await a, Exit.succeed("first"));
});

test("draft edits append to the current session and release idle atoms", (t) => {
  const registry = AtomRegistry.make();
  t.onTestFinished(() => registry.dispose());
  const atom = workspaceDraft("session-a");
  const remove = registry.mount(atom);
  registry.set(atom, { text: "First question" });
  registry.set(atom, { append: "Inspect projects" });
  assert.equal(registry.get(atom).text, "First question\nInspect projects");
  assert.equal(registry.get(workspaceDraft("session-b")).text, "");
  assert.equal(atom.keepAlive, false);
  remove();
});
