import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import { ConfigApplication } from "../../src/config/application.ts";
import { resolveConfig } from "../../src/config/load.ts";
import { saveDeclaration } from "../../src/config/declarations.ts";
import * as Id from "../../src/identities.ts";
import { requireOwnedPrompt } from "../../src/opencode/guards.ts";

test("declarations preserve comments, support absent lists and serialize concurrent updates", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const path = join(f.root, "abracode.yaml");
  await writeFile(
    path,
    "# retain this comment\nversion: 1\nmodels: {default: {providerID: fixture, id: fixture}}\n",
  );
  await Promise.all(
    ["one", "two"].map((id) =>
      run(
        saveDeclaration(
          f.config,
          {
            id: Id.RepositoryId.make(id),
            remote: Id.GitRemote.make(`https://github.com/example/${id}`),
          },
          f.locks,
        ),
      ),
    ),
  );
  const content = await readFile(path, "utf8");
  assert.match(content, /# retain this comment/);
  const config = await run(resolveConfig(f.root, path, content));
  assert.deepEqual(config.repositories.map((p) => p.id).sort(), ["one", "two"]);
});

test("saved pending declarations survive inspection failures and omission blocks only new starts", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const configuration = new ConfigApplication(f.config, f.records, f.onboarding);
  const issue = Id.IssueId.make("active-declaration");
  f.work.add(issue);
  const execution = await run(f.controller.start(issue));
  const before = await readFile(f.config.config_path, "utf8");
  const document = await run(resolveConfig(f.root, f.config.config_path, before));
  const remaining = document.repositories.filter((p) => p.id !== "api");
  await writeFile(
    f.config.config_path,
    `version: 1\nmodels: {default: {providerID: fixture, id: fixture}}\nrepositories: ${JSON.stringify(remaining)}\n`,
  );
  const status = await run(configuration.status());
  assert.equal(status.find((p) => p.id === "api")?.status, "retained/undeclared");
  f.work.add(Id.IssueId.make("new-declaration"));
  assert.ok(
    (await run(f.controller.ready()))
      .find((r) => r.issue.id === "new-declaration")
      ?.blockers.some((b) => b.includes("no longer declared")),
  );
  assert.equal(
    (await run(f.controller.get(issue))).worktree_directory,
    execution.worktree_directory,
  );
  await writeFile(f.config.config_path, before);
  assert.equal(
    (await run(configuration.status())).find((p) => p.id === "api")?.status,
    "registered/ready",
  );
  await assert.rejects(
    run(
      f.onboarding.register(
        {
          id: Id.RepositoryId.make("missing"),
          path: Id.AbsolutePath.make(join(f.root, "missing")),
        },
        false,
      ),
    ),
    /Declaration saved/,
  );
  assert.ok((await readFile(f.config.config_path, "utf8")).includes("missing"));
  assert.equal(
    (await run(configuration.status())).find((p) => p.id === "missing")?.status,
    "apply-failed",
  );
});

test("worker admission is bound to current intent, not foreground or queue labels", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.work.add(Id.IssueId.make("prompt-owner"));
  const execution = await run(f.controller.start(Id.IssueId.make("prompt-owner")));
  assert.doesNotThrow(() =>
    requireOwnedPrompt(execution, execution.explore_session_id!, execution.prompt_id!),
  );
  assert.throws(
    () =>
      requireOwnedPrompt(
        execution,
        execution.explore_session_id!,
        Id.MessageId.make("msg_unowned"),
      ),
    /Talk to Abra/,
  );
  assert.throws(
    () =>
      requireOwnedPrompt(
        { ...execution, stop_status: "confirmed" },
        execution.explore_session_id!,
        execution.prompt_id!,
      ),
    /Talk to Abra/,
  );
  assert.throws(
    () =>
      requireOwnedPrompt(
        { ...execution, active_role: "apply" },
        execution.explore_session_id!,
        execution.prompt_id!,
      ),
    /Talk to Abra/,
  );
  const inspection = await run(
    f.controller.queries.inspectWorker(execution.issue_id, execution.explore_session_id!),
  );
  const prompts = f.runtime.prompts;
  assert.equal(inspection.id, execution.explore_session_id);
  const native = f.runtime.sessions.get(execution.explore_session_id!)!;
  for (const [executing, busy, expected] of [
    [true, true, "running"],
    [false, true, "queued"],
    [false, false, "idle"],
    [undefined, true, "unknown"],
  ] as const) {
    native.executing = executing;
    native.busy = busy;
    const observed = await run(f.controller.queries.inspectWorker(execution.issue_id, native.id));
    assert.equal(observed.native_activity, expected);
    assert.ok(Number.isFinite(Date.parse(observed.observed_at)));
  }

  assert.equal(f.runtime.prompts, prompts);
  await assert.rejects(
    run(
      f.controller.queries.inspectWorker(execution.issue_id, Id.SessionId.make("ses_unassigned")),
    ),
  );
});

test("configuration conflicts and interrupted writes preserve the personal document and runtime", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { configurationFiles } = await import("../../src/config/declarations.ts");
  const { Effect } = await import("effect");
  const { CrewError } = await import("../../src/domain.ts");
  const { readdir } = await import("node:fs/promises");
  const before = await readFile(f.config.config_path, "utf8");
  const input = {
    id: Id.RepositoryId.make("conflict"),
    remote: Id.GitRemote.make("https://github.com/example/conflict"),
  };
  const edited = before + "# independent user edit\n";
  await assert.rejects(
    run(
      saveDeclaration(f.config, input, f.locks, {
        ...configurationFiles,
        writeFile: (...args) =>
          configurationFiles
            .writeFile(...args)
            .pipe(Effect.andThen(configurationFiles.writeFile(f.config.config_path, edited))),
      }),
    ),
    /Configuration changed/,
  );
  assert.equal(await readFile(f.config.config_path, "utf8"), edited);
  await assert.rejects(
    run(
      saveDeclaration(f.config, input, f.locks, {
        ...configurationFiles,
        writeFile: (...args) =>
          configurationFiles
            .writeFile(...args)
            .pipe(Effect.andThen(Effect.fail(new CrewError("WRITE", "Interrupted write")))),
      }),
    ),
    /Interrupted write/,
  );
  assert.equal(await readFile(f.config.config_path, "utf8"), edited);
  await assert.rejects(
    run(
      saveDeclaration(f.config, input, f.locks, {
        ...configurationFiles,
        writeFile: () => Effect.fail(new CrewError("WRITE", "Permission denied")),
      }),
    ),
    /Permission denied/,
  );
  assert.equal(
    (await readdir(f.root)).some((p) => p.endsWith(".tmp")),
    false,
  );
  assert.equal(
    (await run(f.records.projects())).some((p) => p.id === "conflict"),
    false,
  );
});
