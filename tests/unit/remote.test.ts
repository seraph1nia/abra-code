import * as Id from "../../src/identities.ts";
import { run } from "../effects.ts";
import { domainEffect } from "../../src/effect.ts";
import { CrewError } from "../../src/domain.ts";
import { Effect } from "effect";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fixture, repo } from "../fixtures.ts";
import { remoteIdentity, RepositorySources } from "../../src/git/source.ts";
import { GitHubDelivery } from "../../src/git/delivery.ts";

async function managed(f: import("effect").Effect.Success<typeof fixture>, missing = false) {
  const upstream = await run(repo(f.root, "upstream"));
  await writeFile(join(upstream, "AGENTS.md"), "Keep upstream instructions.\n");
  await mkdir(join(upstream, ".agents/skills/custom"), { recursive: true });
  await writeFile(join(upstream, ".agents/skills/custom/SKILL.md"), "Existing skill.\n");
  await writeFile(join(upstream, "package.json"), JSON.stringify({ scripts: { test: "true" } }));
  if (missing) await run(f.git.run(Id.AbsolutePath.make(upstream), ["rm", "openspec/config.yaml"]));
  await run(f.git.run(Id.AbsolutePath.make(upstream), ["add", "."]));
  await run(f.git.run(Id.AbsolutePath.make(upstream), ["commit", "-m", "Project configuration"]));
  await run(f.git.run(Id.AbsolutePath.make(upstream), ["push", "origin", "main"]));
  const report = await run(
    f.onboarding.register(
      {
        id: Id.RepositoryId.make("remote"),
        remote: Id.GitRemote.make(`${upstream}.git`),
        max_workers: 2,
      },
      false,
    ),
  );
  await run(f.git.run(report.project.path, ["config", "user.email", "fixture@example.invalid"]));
  await run(f.git.run(report.project.path, ["config", "user.name", "Fixture"]));
  return { upstream, ...report };
}
async function push(
  f: import("effect").Effect.Success<typeof fixture>,
  upstream: string,
  text: string,
  branch = "main",
) {
  await writeFile(join(upstream, "source.txt"), text);
  await run(f.git.run(Id.AbsolutePath.make(upstream), ["add", "."]));
  await run(f.git.run(Id.AbsolutePath.make(upstream), ["commit", "-m", "Remote update"]));
  await run(f.git.run(Id.AbsolutePath.make(upstream), ["push", "origin", branch]));
  return run(f.git.head(Id.AbsolutePath.make(upstream)));
}
test("remote identity deduplicates GitHub HTTPS/SSH URLs and rejects embedded credentials", () => {
  const identity = remoteIdentity(
    Id.GitRemote.make("https://github.com/Seraph1nia/agent-plugins.git/"),
  );
  assert.equal(
    identity,
    remoteIdentity(Id.GitRemote.make("git@github.com:seraph1nia/agent-plugins.git")),
  );
  assert.equal(
    identity,
    remoteIdentity(Id.GitRemote.make("ssh://git@github.com/seraph1nia/agent-plugins")),
  );
  assert.throws(
    () => remoteIdentity(Id.GitRemote.make("https://secret@github.com/a/b")),
    /credentials/,
  );
  assert.throws(() => remoteIdentity(Id.GitRemote.make("ext::anything")), /transport|Invalid/);
  assert.equal(
    remoteIdentity(
      Id.GitRemote.make("../upstream.git"),
      Id.AbsolutePath.make("/tmp/checkouts/repo"),
    ),
    "/tmp/checkouts/upstream.git",
  );
  assert.equal(
    remoteIdentity(Id.GitRemote.make("https://[::1]/owner/repo.git")),
    "[::1]/owner/repo",
  );
});
test("verification setup blocks claims and incomplete legacy targets remain preserved", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { project } = await managed(f);
  await run(f.onboarding.register({ id: Id.RepositoryId.make("remote"), verification: [] }, false));
  f.work.add(Id.IssueId.make("checks-1"), Id.RepositoryId.make("remote"));
  await assert.rejects(run(f.controller.start(Id.IssueId.make("checks-1"))), /Verification/);
  assert.equal(f.work.claims, 0);
  await run(
    f.onboarding.register(
      {
        id: Id.RepositoryId.make("remote"),
        verification: [[process.execPath, "-e", "process.exit(0)"]],
      },
      false,
    ),
  );
  const e = await run(f.controller.start(Id.IssueId.make("checks-1")));
  const nativeID = (await run(f.records.project(Id.RepositoryId.make("remote"))))!.project_id;
  const incomplete = { ...e, target_branch: undefined, schema_version: undefined };
  await run(f.records.store.set(Id.StorageKey.make("execution/checks-1"), incomplete));
  await assert.rejects(run(f.records.execution(Id.IssueId.make("checks-1"))), /target_branch/);
  assert.equal((await run(f.records.executionScan())).diagnostics.length, 1);
  assert.deepEqual(
    await run(f.records.store.get(Id.StorageKey.make("execution/checks-1"))),
    incomplete,
  );
  // Restore retained authoritative evidence explicitly; migration never guesses this value.
  await run(f.records.store.set(Id.StorageKey.make("execution/checks-1"), e));
  await run(
    f.onboarding.register(
      { id: Id.RepositoryId.make("remote"), target_branch: Id.BranchName.make("main") },
      false,
    ),
  );
  assert.equal(
    (await run(f.records.execution(Id.IssueId.make("checks-1"))))!.target_branch,
    "main",
  );
  assert.equal(
    (await run(f.records.project(Id.RepositoryId.make("remote"))))!.project_id,
    nativeID,
  );
  await rename(project.path, `${project.path}.retained`);
  await assert.rejects(
    run(f.onboarding.register({ id: Id.RepositoryId.make("remote") }, false)),
    /clone is missing/,
  );
  await assert.rejects(access(project.path));
  await access(e.worktree_directory!);
});
test("URL-only onboarding discovers remote HEAD and inspects its committed instructions and check proposals", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { upstream, project, inspection } = await managed(f);
  assert.equal(project.managed, true);
  assert.equal(project.branch_policy, "default");
  assert.equal(project.target_branch, "main");
  assert.notEqual(project.path, upstream);
  assert.equal(project.inspected_commit, await run(f.git.head(Id.AbsolutePath.make(upstream))));
  assert.equal(inspection.agents_md_content, "Keep upstream instructions.");
  assert.deepEqual(inspection.skills, ["custom"]);
  assert.deepEqual(project.verification, [["npm", "run", "test"]]);
  await assert.rejects(
    run(
      f.onboarding.register(
        { id: Id.RepositoryId.make("duplicate"), remote: project.remote },
        false,
      ),
    ),
    /already registered/,
  );
  await assert.rejects(
    run(
      f.onboarding.register(
        {
          id: Id.RepositoryId.make("remote"),
          remote: (await run(f.records.project(Id.RepositoryId.make("api"))))!.remote,
        },
        false,
      ),
    ),
    /rebound/,
  );
  const settings = await run(
    f.onboarding.register(
      {
        id: Id.RepositoryId.make("remote"),
        verification: [[process.execPath, "-e", "process.exit(0)"]],
      },
      false,
    ),
  );
  assert.equal(settings.project.max_workers, 2);
  assert.equal(settings.project.path, project.path);
});
test("new worktrees use fresh remote commits while resume retains the saved base and delivery target", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { upstream, project } = await managed(f);
  const cached = await run(f.git.head(project.path));
  const fresh = await push(f, upstream, "new remote content\n");
  f.work.add(Id.IssueId.make("remote-1"), Id.RepositoryId.make("remote"));
  const first = await run(
    f.controller.start(Id.IssueId.make("remote-1"), Id.SessionId.make("ses_supervisor")),
  );
  assert.equal(first.base_commit, fresh);
  assert.equal(first.target_branch, "main");
  assert.equal(await run(f.git.head(first.worktree_directory!)), fresh);
  assert.equal(
    await readFile(join(first.worktree_directory!, "source.txt"), "utf8"),
    "new remote content\n",
  );
  assert.equal(await run(f.git.head(project.path)), cached);
  await run(f.controller.control(Id.IssueId.make("remote-1"), "pause"));
  await run(f.git.run(Id.AbsolutePath.make(upstream), ["switch", "-c", "trunk"]));
  const next = await push(f, upstream, "next default branch\n", "trunk");
  await run(
    f.git.run(Id.AbsolutePath.make(`${upstream}.git`), [
      "symbolic-ref",
      "HEAD",
      "refs/heads/trunk",
    ]),
  );
  const resumed = await run(f.controller.control(Id.IssueId.make("remote-1"), "resume"));
  assert.equal(resumed.base_commit, fresh);
  assert.equal(resumed.target_branch, "main");
  assert.equal(resumed.worktree_directory, first.worktree_directory);
  f.work.add(Id.IssueId.make("remote-2"), Id.RepositoryId.make("remote"));
  const second = await run(
    f.controller.start(Id.IssueId.make("remote-2"), Id.SessionId.make("ses_supervisor")),
  );
  assert.equal(second.base_commit, next);
  assert.equal(second.target_branch, "trunk");
  const calls: string[][] = [];
  const delivery = new GitHubDelivery(
    f.git,
    {
      run(_file, args) {
        return domainEffect(
          Effect.sync(() => {
            calls.push(args);
            return "[]";
          }),
        );
      },
    },
    Id.Executable.make("unused"),
  );
  const changed = await run(f.onboarding.register({ id: Id.RepositoryId.make("remote") }, false));
  assert.equal(changed.project.target_branch, "trunk");
  await run(delivery.inspect(changed.project, first));
  assert.equal(calls[0][calls[0].indexOf("--base") + 1], "main");
});
test("explicit targets override remote HEAD and missing fetches never fall back to cached refs", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { upstream, project } = await managed(f);
  await run(
    f.onboarding.register(
      { id: Id.RepositoryId.make("remote"), target_branch: Id.BranchName.make("main") },
      false,
    ),
  );
  await run(f.git.run(Id.AbsolutePath.make(upstream), ["switch", "-c", "trunk"]));
  await push(f, upstream, "trunk\n", "trunk");
  await run(
    f.git.run(Id.AbsolutePath.make(`${upstream}.git`), [
      "symbolic-ref",
      "HEAD",
      "refs/heads/trunk",
    ]),
  );
  f.work.add(Id.IssueId.make("fixed-1"), Id.RepositoryId.make("remote"));
  const e = await run(f.controller.start(Id.IssueId.make("fixed-1")));
  assert.equal(e.target_branch, "main");
  assert.equal(e.base_commit, project.inspected_commit);
  await rename(`${upstream}.git`, `${upstream}.offline`);
  f.work.add(Id.IssueId.make("offline-1"), Id.RepositoryId.make("remote"));
  await assert.rejects(run(f.controller.start(Id.IssueId.make("offline-1"))), /git|repository/);
  assert.equal(
    (await run(f.records.execution(Id.IssueId.make("offline-1"))))!.worktree_directory,
    undefined,
  );
  assert.equal(f.runtime.trees.length, 1);
});
test("interrupted provisioning recovers its recorded SHA even after a force-push and garbage collection", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { upstream, project } = await managed(f);
  const pinned = await push(f, upstream, "pinned\n");
  const create = f.runtime.createWorktree.bind(f.runtime);
  f.runtime.createWorktree = () =>
    domainEffect(Effect.fail(new CrewError("NATIVE_CREATION", "Creation interrupted")));
  f.work.add(Id.IssueId.make("recover-1"), Id.RepositoryId.make("remote"));
  await assert.rejects(run(f.controller.start(Id.IssueId.make("recover-1"))), /interrupted/);
  const saved = (await run(f.records.execution(Id.IssueId.make("recover-1"))))!;
  assert.equal(saved.base_commit, pinned);
  await run(f.git.run(Id.AbsolutePath.make(upstream), ["reset", "--hard", `${pinned}~1`]));
  await writeFile(join(upstream, "source.txt"), "rewritten remote\n");
  await run(f.git.run(Id.AbsolutePath.make(upstream), ["add", "."]));
  await run(f.git.run(Id.AbsolutePath.make(upstream), ["commit", "-m", "Replace history"]));
  // Replace the remote history, then fetch it while retaining the execution's saved Git ref.
  await run(f.git.run(Id.AbsolutePath.make(upstream), ["push", "--force", "origin", "main"]));
  await run(
    new RepositorySources(f.git, f.config.repository_root).fetch(
      project.path,
      Id.BranchName.make("main"),
    ),
  );
  await run(f.git.run(project.path, ["gc", "--prune=now"]));
  f.runtime.createWorktree = create;
  const recovered = await run(f.controller.control(Id.IssueId.make("recover-1"), "resume"));
  assert.equal(recovered.base_commit, pinned);
  assert.equal(await run(f.git.head(recovered.worktree_directory!)), pinned);
  assert.equal(f.runtime.trees.length, 1);
});
test("registered setup blockers prevent claims and fetched setup is rechecked before worker creation", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const { project, upstream } = await managed(f, true);
  assert.equal(project.openspec, false);
  f.work.add(Id.IssueId.make("setup-1"), Id.RepositoryId.make("remote"));
  assert.match(
    (await run(f.controller.ready())).find((row) => row.issue.id === "setup-1")!.blockers.join(),
    /OpenSpec/,
  );
  await assert.rejects(run(f.controller.start(Id.IssueId.make("setup-1"))), /OpenSpec/);
  assert.equal(f.work.claims, 0);
  await run(
    f.git.run(Id.AbsolutePath.make(upstream), ["checkout", "HEAD~1", "--", "openspec/config.yaml"]),
  );
  await run(f.git.run(Id.AbsolutePath.make(upstream), ["commit", "-m", "Restore OpenSpec"]));
  await run(f.git.run(Id.AbsolutePath.make(upstream), ["push", "origin", "main"]));
  await run(f.onboarding.register({ id: Id.RepositoryId.make("remote") }, false));
  await run(f.git.run(Id.AbsolutePath.make(upstream), ["rm", "openspec/config.yaml"]));
  await run(f.git.run(Id.AbsolutePath.make(upstream), ["commit", "-m", "Remove OpenSpec again"]));
  await run(f.git.run(Id.AbsolutePath.make(upstream), ["push", "origin", "main"]));
  await assert.rejects(run(f.controller.start(Id.IssueId.make("setup-1"))), /Fetched base/);
  assert.equal(f.runtime.creates, 0);
  assert.equal(f.runtime.trees.length, 0);
});
test("a complete interrupted clone is adopted and an ambiguous partial directory is retained", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const upstream = await run(repo(f.root, "clone-upstream"));
  const directory = join(f.config.repository_root, "recover");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "clone.json"), JSON.stringify({ remote: `${upstream}.git` }));
  await run(f.git.run(Id.AbsolutePath.make(directory), ["clone", `${upstream}.git`, "pending"]));
  const sources = new RepositorySources(f.git, f.config.repository_root);
  assert.equal(
    (
      await run(
        sources.clone(Id.RepositoryId.make("recover"), Id.GitRemote.make(`${upstream}.git`)),
      )
    ).path,
    join(directory, "checkout"),
  );
  const partial = join(f.config.repository_root, "ambiguous", "pending");
  await mkdir(partial, { recursive: true });
  await writeFile(join(partial, "keep.txt"), "keep");
  await assert.rejects(
    run(sources.clone(Id.RepositoryId.make("ambiguous"), Id.GitRemote.make(`${upstream}.git`))),
    /Unowned partial/,
  );
  assert.equal(await readFile(join(partial, "keep.txt"), "utf8"), "keep");
});
test("OpenSpec setup uses an owned worktree and a durable human merge gate before cleanup", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.config.commands.openspec = Id.Executable.make(resolve("node_modules/.bin/openspec"));
  const { project } = await managed(f, true);
  const setup = f.setup;
  await assert.rejects(
    run(
      setup.run(
        Id.RepositoryId.make("remote"),
        "prepare",
        Id.SessionId.make("ses_supervisor"),
        false,
      ),
    ),
    /authorized/,
  );
  const prepared = await run(
    setup.run(Id.RepositoryId.make("remote"), "prepare", Id.SessionId.make("ses_supervisor"), true),
  );
  assert.ok("worktree_directory" in prepared);
  const path = prepared.worktree_directory!;
  assert.equal(await readFile(join(path, "AGENTS.md"), "utf8"), "Keep upstream instructions.\n");
  assert.equal(
    await readFile(join(path, ".agents/skills/custom/SKILL.md"), "utf8"),
    "Existing skill.\n",
  );
  await assert.rejects(access(join(project.path, "openspec/config.yaml")));
  assert.equal(await run(f.git.dirty(project.path)), "");
  await run(
    setup.run(
      Id.RepositoryId.make("remote"),
      "deliver",
      Id.SessionId.make("ses_supervisor"),
      false,
    ),
  );
  await assert.rejects(
    run(
      setup.run(
        Id.RepositoryId.make("remote"),
        "finish",
        Id.SessionId.make("ses_supervisor"),
        false,
      ),
    ),
    /Human/,
  );
  const pending = await run(
    setup.run(
      Id.RepositoryId.make("remote"),
      "approve",
      Id.SessionId.make("ses_supervisor"),
      false,
    ),
  );
  assert.ok("form_id" in pending);
  assert.equal(f.delivery.merged, false);
  f.runtime.forms.set(pending.form_id, "approved");
  const done = await run(
    f.setup.run(
      Id.RepositoryId.make("remote"),
      "approve",
      Id.SessionId.make("ses_supervisor"),
      false,
    ),
  );
  assert.ok("current_phase" in done && done.current_phase === "completed");
  await assert.rejects(access(path));
  assert.equal(f.work.claims, 0);
  assert.equal((await run(f.records.executions())).length, 0);
});
test("setup refuses changed content before delivery and retains resources after cleanup failures", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.config.commands.openspec = Id.Executable.make(resolve("node_modules/.bin/openspec"));
  await managed(f, true);
  const setup = f.setup;
  const e = await run(
    setup.run(Id.RepositoryId.make("remote"), "prepare", Id.SessionId.make("ses_supervisor"), true),
  );
  assert.ok("worktree_directory" in e);
  await writeFile(join(e.worktree_directory!, "source.txt"), "unreviewed");
  await assert.rejects(
    run(
      setup.run(
        Id.RepositoryId.make("remote"),
        "deliver",
        Id.SessionId.make("ses_supervisor"),
        false,
      ),
    ),
    /changed/,
  );
  assert.equal(f.delivery.calls, 0);
  await run(f.git.run(e.worktree_directory!, ["restore", "source.txt"]));
  await run(
    setup.run(
      Id.RepositoryId.make("remote"),
      "deliver",
      Id.SessionId.make("ses_supervisor"),
      false,
    ),
  );
  f.delivery.merged = true;
  f.delivery.pr!.state = "MERGED";
  await writeFile(join(e.worktree_directory!, "unpreserved"), "keep");
  await assert.rejects(
    run(
      setup.run(
        Id.RepositoryId.make("remote"),
        "finish",
        Id.SessionId.make("ses_supervisor"),
        false,
      ),
    ),
    /changed/,
  );
  await access(e.worktree_directory!);
  await rm(join(e.worktree_directory!, "unpreserved"));
  const remove = f.runtime.removeWorktree.bind(f.runtime);
  f.runtime.removeWorktree = () =>
    domainEffect(Effect.fail(new CrewError("FIXTURE_FAILURE", "Native cleanup failed")));
  await assert.rejects(
    run(
      setup.run(
        Id.RepositoryId.make("remote"),
        "finish",
        Id.SessionId.make("ses_supervisor"),
        false,
      ),
    ),
    /cleanup/,
  );
  f.runtime.removeWorktree = remove;
  const done = await run(
    setup.run(Id.RepositoryId.make("remote"), "finish", Id.SessionId.make("ses_supervisor"), false),
  );
  assert.ok("current_phase" in done && done.current_phase === "completed");
});
