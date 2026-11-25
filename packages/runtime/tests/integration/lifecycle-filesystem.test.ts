import assert from "node:assert/strict";
import { mkdir, readlink, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, FileSystem } from "effect";
import { systemError } from "effect/PlatformError";
import { test, vi } from "vite-plus/test";
import { CrewError } from "../../src/domain.ts";
import { RepositorySources } from "../../src/git/source.ts";
import { Workspaces } from "../../src/git/workspaces.ts";
import * as Id from "@abracode/contracts/identities";
import { OpenSpec } from "../../src/openspec/adapter.ts";
import { createConfiguredExecution } from "../../src/workflow/execution.ts";
import { retainedExecution } from "../helpers/retained-execution.ts";
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
      createConfiguredExecution(
        project,
        {
          issue_id: Id.IssueId.make("archive-test"),
          repository_id: repository,
          execution_id: Id.ExecutionId.make("archive-execution"),
          current_phase: "archiving",
          workflow_policy: "full-openspec",
          branch: Id.BranchName.make("main"),
          openspec_change: Id.ChangeName.make("test-change"),
        },
        f.config,
      ),
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
    createConfiguredExecution(
      project,
      {
        issue_id: Id.IssueId.make("workspace-test"),
        repository_id: repo,
        execution_id: Id.ExecutionId.make("workspace-execution"),
        current_phase: "provisioning",
        workflow_policy: "research-only",
        branch: Id.BranchName.make("test-worktree"),
        openspec_change: Id.ChangeName.make("unused"),
      },
      f.config,
    ),
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

test("clone recovery and OpenSpec creation preserve failed probes and dangling entries", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const repository = Id.RepositoryId.make("recover");
  const project = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  const sources = new RepositorySources(f.git, f.config.repository_root);
  const directory = join(f.config.repository_root, repository);
  await mkdir(directory, { recursive: true });
  const clone = () => sources.clone(repository, project.remote).pipe(Effect.asVoid);
  const git = vi.spyOn(f.git, "run");
  const { execution } = await retainedExecution({
    worktree_directory: project.path,
    openspec_schema: Id.SpecSchemaName.make("spec-driven"),
  });
  const changeDir = join(project.path, "openspec/changes", execution.openspec_change);
  await mkdir(join(project.path, "openspec/changes"), { recursive: true });
  const commands: string[] = [];
  const spec = new OpenSpec(
    {
      run: (_bin, args) => {
        commands.push(args[0]!);
        return Effect.succeed(
          JSON.stringify({
            change: {
              id: execution.openspec_change,
              path: changeDir,
              metadataPath: "meta",
              schema: execution.openspec_schema,
            },
          }),
        );
      },
    },
    Id.Executable.make("openspec"),
  );
  for (const [path, action] of [
    [join(directory, "checkout"), clone],
    [join(directory, "clone.json"), clone],
    [join(directory, "pending"), clone],
    [changeDir, () => spec.create(execution)],
  ] as const) {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        for (const code of ["EACCES", "EIO"]) {
          const failure = yield* Effect.flip(
            action().pipe(
              Effect.provideService(FileSystem.FileSystem, {
                ...fs,
                access: (entry, options) =>
                  entry === path
                    ? Effect.fail(
                        systemError({
                          _tag: "Unknown",
                          module: "FileSystem",
                          method: "access",
                          cause: Object.assign(Error("probe failed"), { code }),
                        }),
                      )
                    : fs.access(entry, options),
              }),
            ),
          );
          assert.equal(failure.code, code);
        }
      }).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    await symlink("missing-target", path);
    assert.equal((await run(Effect.flip(action()))).code, "RETAINED_PATH");
    assert.equal(await readlink(path), "missing-target");
    await unlink(path);
  }
  assert.deepEqual(commands, []);
  assert.equal(git.mock.calls.length, 0);
  await run(spec.create(execution));
  assert.deepEqual(commands, ["new"]);
  await run(clone());
  assert.ok(git.mock.calls.some(([, args]) => args.includes("clone")));
});
