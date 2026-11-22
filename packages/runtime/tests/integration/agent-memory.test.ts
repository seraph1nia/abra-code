import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rm,
  readFile,
  writeFile,
  symlink,
  unlink,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import { test, vi } from "vite-plus/test";
import { resolveConfig } from "../../src/config/load.ts";
import { AgentMemory } from "../../src/memory/service.ts";
import { memoryDirectory } from "../../src/memory/provider.ts";
import { hash, MemoryCollections } from "../../src/memory/collections.ts";
import { AbsolutePath, RepositoryId, RequestId } from "../../src/identities.ts";
import type { Project } from "../../src/domain.ts";
import type { PersonalThoughts } from "../../src/work/thoughts.ts";

async function fixture(binary: string, cleanup: (cb: () => Promise<void>) => void) {
  const root = await mkdtemp(join(tmpdir(), "abra-memory-test-"));
  cleanup(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "app"),
    directory = join(root, "private");
  await mkdir(home);
  const config = await Effect.runPromise(
    resolveConfig(
      home,
      join(home, "abracode.yaml"),
      `version: 1\nmodels: {default: {providerID: fixture, id: fixture}}\nmemory: ${JSON.stringify({ enabled: true, directory, executable: binary })}`,
    ),
  );
  const projects = ["a", "b"].map((id) => ({
    id: RepositoryId.make(id),
    path: join(root, id),
  })) as Project[];
  const thought = {
    instance: "https://private.invalid",
    account: "users/test",
    name: "memos/t",
    wording_hash: hash("One sentence. Private sentence."),
  };
  let available = true;
  let reads = 0;
  const thoughts = {
    get: () => {
      reads++;
      return available
        ? Effect.succeed({ content: "One sentence. Private sentence." })
        : Effect.die("Unexpected memo read");
    },
  } as unknown as Pick<PersonalThoughts, "get">;
  const create = () =>
    new AgentMemory(config, { projects: () => Effect.succeed(projects) }, thoughts);
  return {
    create,
    config,
    root,
    directory,
    projects,
    thought,
    disableThought: () => {
      available = false;
    },
    reads: () => reads,
  };
}
test("disabled, unsafe and missing installations are isolated from configuration and normal work", async (t) => {
  const f = await fixture("/missing/bm", t.onTestFinished);
  const c = f.create();
  t.onTestFinished(() => Effect.runPromise(c.close()));
  f.config.memory = { ...f.config.memory!, enabled: false };
  await assert.rejects(
    Effect.runPromise(c.search(undefined, { query: "anything" })),
    /Enable memory/,
  );
  assert.ok(!(await readdir(f.root)).includes("private"));
  f.config.memory = { ...f.config.memory!, enabled: true };
  await assert.rejects(
    Effect.runPromise(c.search(undefined, { query: "query" })),
    /Basic Memory 1.0.0/,
  );
  await assert.rejects(
    memoryDirectory(
      { ...f.config, memory: { ...f.config.memory!, directory: f.projects[0].path } },
      [f.projects[0].path],
    ),
    /outside all managed/,
  );
});
test.skipIf(!process.env.ABRACODE_TEST_BM)(
  "pinned local provider preserves scope, retries and human changes across restart",
  { timeout: 120000 },
  async (t) => {
    const f = await fixture(process.env.ABRACODE_TEST_BM!, t.onTestFinished);
    let memory = f.create();
    t.onTestFinished(() => Effect.runPromise(memory.close()));
    const [a, b] = f.projects.map((p) => p.id);
    const one = {
      request_id: RequestId.make("first"),
      destination: { kind: "repository" as const, repository_id: a },
      content: "One sentence.",
      source: { kind: "thought" as const, reference: f.thought },
    };
    const call = Effect.runPromise;
    const [first, again] = await Promise.all([
      call(memory.publish(one)),
      call(memory.publish(one)),
    ]);
    assert.deepEqual(first, again);
    f.disableThought();
    const before = f.reads();
    await call(memory.close());
    memory = f.create();
    assert.deepEqual(await call(memory.publish(one)), first);
    assert.equal(f.reads(), before);
    await assert.rejects(
      call(memory.publish({ ...one, content: "Changed." })),
      /another publication/,
    );
    f.projects[0].path = AbsolutePath.make(join(f.root, "renamed-checkout"));
    const body = await call(memory.read(a, { reference: first }));
    assert.ok(body.complete && body.body.includes(one.content));
    assert.doesNotMatch(body.body, /private.invalid|memos\/t|Private sentence/);
    await assert.rejects(call(memory.read(b, { reference: first })), /outside/);
    const result = await call(memory.search(a, { query: "sentence" }));
    assert.deepEqual(result.entries[0]?.reference, first);
    await assert.rejects(
      call(memory.search(b, { query: "sentence", cursor: "1." + "0".repeat(64) })),
      /changed/,
    );
    const other = await call(memory.search(b, { query: "sentence" }));
    assert.equal(other.entries.length, 0);
    const fixed = await call(
      memory.publish({
        request_id: RequestId.make("correction"),
        destination: one.destination,
        source: { kind: "observation" },
        content: "A correction.",
        corrects: first,
      }),
    );
    assert.notEqual(fixed.path, first.path);
    assert.ok((await call(memory.read(a, { reference: fixed }))).body.includes(first.revision));
    const path = join(f.directory, "vault", "abra-" + hash(a), first.path);
    const old = await readFile(path, "utf8");
    await writeFile(path, old.replace("One sentence.", "Human edit."));
    await assert.rejects(call(memory.publish(one)), /changed/);
    await assert.rejects(call(memory.read(a, { reference: first })), /changed/);
    await unlink(path);
    await assert.rejects(call(memory.publish(one)), /reserved note/);
    await symlink(join(f.directory, "config", "config.json"), path);
    await assert.rejects(call(memory.read(a, { reference: first })), /location/);
    f.projects.length = 0;
    const shared = await call(
      memory.publish({
        request_id: RequestId.make("everywhere"),
        destination: { kind: "shared" },
        source: { kind: "observation" },
        content: "Crossproject signal.\r\n  Exact words.  \n",
      }),
    );
    const sharedBody = await call(memory.read(undefined, { reference: shared }));
    assert.ok(
      sharedBody.complete && sharedBody.body.includes("Crossproject signal.\r\n  Exact words.  \n"),
    );
    const interrupted = {
      request_id: RequestId.make("interrupted"),
      destination: { kind: "shared" as const },
      source: { kind: "observation" as const },
      content: "A reserved save.",
    };
    const failedCreate = vi
      .spyOn(MemoryCollections.prototype, "create")
      .mockRejectedValueOnce(new Error("simulated interruption"));
    try {
      await assert.rejects(call(memory.publish(interrupted)), /reserved note/);
      await call(memory.close());
      memory = f.create();
      await assert.rejects(call(memory.publish(interrupted)), /reserved note/);
      assert.equal(failedCreate.mock.calls.length, 1);
    } finally {
      failedCreate.mockRestore();
    }
  },
);

test.skipIf(!process.env.ABRACODE_TEST_BM)(
  "the stdio owner recovers an exited subprocess and closes its replacement",
  { timeout: 60000 },
  async (t) => {
    const { MemoryProvider } = await import("../../src/memory/provider.ts");
    const f = await fixture(process.env.ABRACODE_TEST_BM!, t.onTestFinished);
    const root = await memoryDirectory(f.config, []);
    const entry = join(root, "bm-wrapper"),
      pidfile = join(root, "pid");
    await symlink(process.env.ABRACODE_TEST_BM!, join(root, "pinned"));
    await writeFile(
      entry,
      '#!/bin/sh\nif [ "$1" = mcp ]; then echo "$$" > pid; fi\nexec ./pinned "$@"\n',
      { mode: 0o700 },
    );
    const provider = new MemoryProvider(entry);
    t.onTestFinished(() => provider.close());
    const list = () =>
      provider.call(root, "bm_project", { command: "list" }, AbortSignal.timeout(20000));
    await list();
    const initial = Number(await readFile(pidfile, "utf8"));
    process.kill(initial, "SIGKILL");
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await list();
        if (Number(await readFile(pidfile, "utf8")) !== initial) break;
      } catch {
        /* Wait for transport close. */
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    const replacement = Number(await readFile(pidfile, "utf8"));
    assert.notEqual(replacement, initial);
    await provider.close();
    assert.throws(() => process.kill(replacement, 0), { code: "ESRCH" });
    assert.ok((await readdir(root)).includes("vault"));
  },
);

test("scoped index pages verify each hit against live Markdown and bind cursors to query, scope and revisions", async (t) => {
  const f = await fixture("/unused", t.onTestFinished);
  const root = await memoryDirectory(f.config, []);
  const names = [...f.projects.map((p) => "abra-" + hash(p.id)), "abra-shared"];
  const ids = names.map((_, i) => "aa000000-0000-4000-8000-00000000000" + i);
  for (const [index, name] of names.entries()) {
    const folder = join(root, "vault", name);
    await mkdir(folder);
    await writeFile(join(folder, "same.md"), "Same title\n" + "abc".repeat(3000) + index);
  }
  let mappingCollision = false;
  const provider = {
    call: async (_root: string, tool: string, args: Record<string, unknown>) => {
      if (tool === "bm_project")
        return {
          projects: names.map((name, i) => ({
            name,
            source: "local",
            local_path: join(root, "vault", mappingCollision && i === 0 ? names[1] : name),
            external_id: ids[i],
          })),
        };
      const index = ids.indexOf(String(args.project));
      assert.ok(index >= 0);
      const disk = join(root, "vault", names[index], "same.md");
      if (tool === "bm_read")
        return { file_path: "same.md", title: "Same title", checksum: hash(await readFile(disk)) };
      assert.equal(tool, "bm_search");
      return {
        has_more: args.page === 1,
        results:
          args.page === 1
            ? [
                {
                  file_path: "same.md",
                  project_external_id: ids[index],
                  content: "external indexed secret",
                },
              ]
            : [],
      };
    },
  };
  const notes = new MemoryCollections(root, provider, "text", new AbortController().signal);
  const [a, b] = f.projects.map((p) => p.id);
  const first = await notes.search(a, { query: "same" });
  assert.equal(first.entries.length, 2);
  const ref = first.entries[0].reference;
  assert.deepEqual(ref.scope, { kind: "repository", repository_id: a });
  assert.doesNotMatch(JSON.stringify(first), /external indexed secret/);
  assert.deepEqual(
    (await notes.search(a, { query: "same", cursor: first.next_cursor })).entries,
    [],
  );
  await assert.rejects(notes.search(b, { query: "same", cursor: first.next_cursor }), /changed/);
  await assert.rejects(notes.search(a, { query: "other", cursor: first.next_cursor }), /changed/);
  f.projects[0].path = AbsolutePath.make(join(f.root, "renamed"));
  const body = await notes.read(a, { reference: ref });
  assert.equal(body.complete, false);
  assert.equal(body.next_offset, 8192);
  assert.ok((await notes.read(a, { reference: ref, offset: body.next_offset })).complete);
  const disk = join(root, "vault", names[0], "same.md");
  await writeFile(disk, "different");
  await assert.rejects(notes.search(a, { query: "same", cursor: first.next_cursor }), /changed/);
  await unlink(disk);
  await symlink(join(root, "vault", names[1], "same.md"), disk);
  await assert.rejects(notes.search(a, { query: "same" }), /location/);
  mappingCollision = true;
  await assert.rejects(notes.project(ref.scope), /location/);
});
