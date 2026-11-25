import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { RegistryContext } from "@effect/atom-react";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { Context, Deferred, Effect, Exit } from "effect";
import { test } from "vite-plus/test";
import { WorkspaceApi, useWorkspaceCall } from "../src/data.ts";
import { workspaceDraft } from "../src/workspace-state/draft.ts";

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
