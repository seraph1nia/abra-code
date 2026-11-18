/* oxlint-disable effecttsgo/unstable-api-usage -- Injects the pinned platform filesystem at the existing lifecycle test seam. */
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, FileSystem } from "effect";
import { systemError } from "effect/PlatformError";
import { test, vi } from "vite-plus/test";
import { CrewError } from "../../src/domain.ts";
import { RepositorySources } from "../../src/git/source.ts";
import { Workspaces } from "../../src/git/workspaces.ts";
import * as Id from "../../src/identities.ts";
import { OpenSpec } from "../../src/openspec/adapter.ts";
import { createExecution } from "../../src/workflow/execution.ts";
import { run } from "../effects.ts";
import { fixture } from "../fixtures.ts";

function denied(operation: string, path: string) {
  return systemError({
    _tag: "PermissionDenied",
    module: "FileSystem",
    method: operation,
    pathOrDescriptor: path,
    cause: Object.assign(Error(`Cannot ${operation} ${path}`), { code: "EACCES" }),
  });
}
const refused = (error: unknown) => error instanceof CrewError && error.code === "EACCES";

test("OpenSpec preserves unreadable preflight and post-archive evidence", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const repository = Id.RepositoryId.make("api");
  const project = (await run(f.records.project(repository)))!;
  const e = {
    ...(await run(
      createExecution(project, {
        issue_id: Id.IssueId.make("archive-test"),
        repository_id: repository,
        execution_id: Id.ExecutionId.make("archive-execution"),
        current_phase: "archiving",
        workflow_policy: "full-openspec",
        branch: Id.BranchName.make("main"),
        openspec_change: Id.ChangeName.make("test-change"),
      }),
    )),
    openspec_schema_binding: undefined,
    worktree_directory: project.path,
  };
  const commands: string[] = [];
  const spec = new OpenSpec(
    {
      run: (_bin, [verb]) =>
        Effect.sync(() => {
          commands.push(verb!);
          return JSON.stringify({
            archive: {
              change: e.openspec_change,
              archivedAs: "dated-test-change",
              path: "archive",
              specsUpdated: true,
            },
          });
        }),
    },
    Id.Executable.make("openspec"),
  );
  const archive = join(project.path, "openspec/changes/archive");
  const active = join(project.path, "openspec/changes", e.openspec_change);
  let failBefore = true;
  const fs = FileSystem.makeNoop({
    readDirectory: (path) => {
      assert.equal(path, archive);
      if (failBefore) return Effect.fail(denied("readDirectory", path));
      return Effect.succeed(commands.length ? ["dated-test-change"] : []);
    },
    access: (path) => {
      assert.equal(path, active);
      return commands.length ? Effect.fail(denied("access", path)) : Effect.void;
    },
  });
  const runArchive = () =>
    run(spec.archive(e).pipe(Effect.provideService(FileSystem.FileSystem, fs)));
  await assert.rejects(runArchive(), refused);
  assert.deepEqual(commands, []);
  failBefore = false;
  await assert.rejects(runArchive(), refused);
  assert.deepEqual(
    commands,
    ["archive"],
    "unreadable completion must not reach canonical validation",
  );
});

test("worktree orphan listings distinguish missing and unreadable roots before provisioning", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const repo = Id.RepositoryId.make("api");
  const registered = (await run(f.records.project(repo)))!;
  const project = { ...registered, project_id: Id.NativeProjectId.make(registered.path) };
  const e = await run(
    createExecution(project, {
      issue_id: Id.IssueId.make("workspace-test"),
      repository_id: repo,
      execution_id: Id.ExecutionId.make("workspace-execution"),
      current_phase: "provisioning",
      workflow_policy: "research-only",
      branch: Id.BranchName.make("test-worktree"),
      openspec_change: Id.ChangeName.make("unused"),
    }),
  );
  const sources = new RepositorySources(f.git, f.config.repository_root);
  const workspaces = new Workspaces(f.git, sources, f.runtime, f.config.worktree_root);
  const create = vi.spyOn(f.runtime, "createWorktree");
  t.onTestFinished(() => create.mockRestore());
  const provision = workspaces.provision(project, e, () => Effect.void);
  await assert.rejects(
    run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return yield* provision.pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fs,
            readDirectory: (path, options) =>
              path === f.config.worktree_root
                ? Effect.fail(denied("readDirectory", path))
                : fs.readDirectory(path, options),
          }),
        );
      }).pipe(Effect.provide(NodeFileSystem.layer)),
    ),
    refused,
  );
  assert.equal(create.mock.calls.length, 0);
  assert.equal(e.worktree_directory, undefined);
  await writeFile(f.config.worktree_root, "A malformed root is not an absent directory");
  await assert.rejects(
    run(provision),
    (error: unknown) => error instanceof CrewError && error.code === "ENOTDIR",
  );
  assert.equal(create.mock.calls.length, 0);
  await unlink(f.config.worktree_root);
  await run(provision);
  assert.equal(create.mock.calls.length, 1);
  assert.ok(e.worktree_directory);
});
