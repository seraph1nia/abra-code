import { Schema } from "effect";
import * as Id from "@abracode/contracts/identities";
import { CrewError } from "../../src/domain.ts";
import { domainEffect, run } from "../effects.ts";
import { Effect } from "effect";
import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdir, rename, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, planned } from "../fixtures.ts";
import * as documents from "../../src/workflow/read-model/documents.ts";
import { Visibility } from "../../src/visibility/read-model.ts";
import { visibility } from "../../src/visibility/protocol.ts";
test("proposal reads the owned worktree and schema artifact path, rejecting escaping symlinks", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const status = f.spec.status.bind(f.spec);
  f.spec.status = (execution) =>
    domainEffect(
      Effect.gen(function* () {
        return {
          ...(yield* status(execution)),
          artifacts: [
            {
              id: Id.ArtifactId.make("proposal"),
              status: "done",
              outputPath: Id.RelativePath.make("proposal.md"),
            },
          ],
        };
      }),
    );
  const view = new Visibility(f.controller);
  const path = join(e.worktree_directory!, "openspec/changes", e.openspec_change, "proposal.md");
  assert.equal((await run(view.detail(e.issue_id))).proposal, await readFile(path, "utf8"));
  const outside = join(f.root, "outside.txt");
  await writeFile(outside, "Do not expose this unrelated file");
  await rm(path);
  await symlink(outside, path);
  const denied = await run(view.detail(e.issue_id));
  assert.equal(denied.proposal, undefined);
  assert.match(denied.errors.join(" "), /escapes/);
  assert.ok(!JSON.stringify(denied).includes("Do not expose"));
  assert.throws(() => Id.IssueId.make("../outside"), /Schema validation/);
});

test("queued and retired work do not invoke OpenSpec; large proposals are bounded", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  f.seed.named(Id.IssueId.make("abra-queued"));
  const view = new Visibility(f.controller);
  assert.equal((await run(view.detail(Id.IssueId.make("abra-queued")))).change, undefined);
  let e = await run(planned(f));
  const status = f.spec.status.bind(f.spec);
  f.spec.status = (execution) =>
    domainEffect(
      Effect.gen(function* () {
        return {
          ...(yield* status(execution)),
          artifacts: [
            {
              id: Id.ArtifactId.make("proposal"),
              status: "done",
              outputPath: Id.RelativePath.make("proposal.md"),
            },
          ],
        };
      }),
    );
  await writeFile(
    join(e.worktree_directory!, "openspec/changes", e.openspec_change, "proposal.md"),
    "x".repeat(70 * 1024),
  );
  assert.equal(
    (await run(view.detail(e.issue_id))).proposal,
    "x".repeat(64 * 1024) + "\n[Proposal truncated at 64 KiB]",
  );
  e = {
    ...e,
    archive_path: Id.RelativePath.make(`openspec/changes/archive/2026-10-14-${e.openspec_change}`),
  };
  e = {
    ...e,
    delivered_commit: e.delivered_commit ?? (await run(f.git.head(e.worktree_directory!))),
  };
  e = {
    ...e,
    delivery_receipt: {
      commit: e.delivered_commit!,
      target: e.target_branch!,
      at: Id.Timestamp.make(new Date().toISOString()),
    },
  };
  e = { ...e, current_phase: "completed" };
  e = await run(f.records.save(e));
  await run(f.work.close(e.issue_id, e.execution_id));
  f.spec.status = () =>
    domainEffect(
      Effect.fail(new CrewError("FIXTURE_FAILURE", "Retired worktree must not be read")),
    );
  const archived = await run(view.detail(e.issue_id));
  assert.equal(archived.archive, e.archive_path);
  assert.match(archived.errors.join(" "), /No regular Markdown planning documents/);
  assert.equal(
    (await run(view.snapshot())).work.find((w) => w.issue_id === e.issue_id)?.issue_status,
    "closed",
  );
});

test("document selection stays inside the planning change and retired work is paged with conflicts visible", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const view = new Visibility(f.controller);
  const detail = await run(view.detail(e.issue_id));
  assert.ok(detail.documents?.includes(Id.RelativePath.make("design.md")));
  assert.ok(detail.documents?.includes(Id.RelativePath.make("specs/sample/spec.md")));
  assert.match(
    (await run(view.document(e.issue_id, Id.RelativePath.make("design.md")))).content,
    /Return a sample/,
  );
  assert.match(
    (await run(view.document(e.issue_id, Id.RelativePath.make("specs/sample/spec.md")))).content,
    /Sample behavior/,
  );
  await assert.rejects(
    run(view.document(e.issue_id, Id.RelativePath.make("../../../../source.txt"))),
    /owned change/,
  );
  const outside = join(f.root, "private.md");
  await writeFile(outside, "private planning content");
  await symlink(
    outside,
    join(e.worktree_directory!, "openspec/changes", e.openspec_change, "escape.md"),
  );
  await assert.rejects(
    run(view.document(e.issue_id, Id.RelativePath.make("escape.md"))),
    /owned change/,
  );
  for (let i = 0; i < 56; i++) {
    const id = `closed-${String(i).padStart(2, "0")}`;
    f.seed.named(Id.IssueId.make(id));
    f.seed.close(id);
  }
  // A closed ticket with a live execution is attention work on every history page.
  f.seed.close(e.issue_id);
  const first = await run(view.snapshot());
  const second = await run(view.snapshot(1));
  assert.equal(first.closed_total, 56);
  assert.equal(first.work.filter((w) => w.issue_id.startsWith("closed-")).length, 50);
  assert.equal(second.work.filter((w) => w.issue_id.startsWith("closed-")).length, 6);
  assert.equal(second.work.find((w) => w.issue_id === e.issue_id)?.issue_status, "closed");
  assert.equal(second.work.find((w) => w.issue_id === e.issue_id)?.phase, "awaiting_plan_approval");
  assert.equal((await run(view.snapshot(100))).closed_page, 1);
});

test("retired planning reads exact archive blobs and excludes symbolic links and live replacements", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  let e = await run(planned(f));
  const tree = e.worktree_directory!;
  const q = { kind: "plan" as const, issue_id: e.issue_id, search: "unique collection token" };
  const queries = f.controller.queries;
  const folder = join(tree, "openspec/changes", e.openspec_change);
  for (const file of ["a.md", "b.md", "c.md"])
    await writeFile(join(folder, file), "unique collection token");
  const enumeration = vi.spyOn(documents, "changeDocuments");
  const live = await run(queries.discoverEvidence(q));
  assert.equal(enumeration.mock.calls.length, 1);
  assert.equal(live.entries.length, 3);
  const listed = await run(queries.planDocuments(e));
  await rm(join(folder, "a.md"));
  await assert.rejects(run(listed.read(Id.RelativePath.make("a.md"))));
  await symlink(join(tree, "source.txt"), join(folder, "a.md"));
  await assert.rejects(run(listed.read(Id.RelativePath.make("a.md"))), /escapes/);
  await rm(join(folder, "a.md"));
  await writeFile(join(folder, "a.md"), "unique collection token");
  e = {
    ...e,
    archive_path: Id.RelativePath.make(`openspec/changes/archive/2026-11-15-${e.openspec_change}`),
  };
  const archive = join(tree, e.archive_path!);
  await mkdir(join(tree, "openspec/changes/archive"), { recursive: true });
  await rename(join(tree, "openspec/changes", e.openspec_change), archive);
  await writeFile(
    join(archive, "proposal.md"),
    "# The delivered plan\n\nOriginal retained evidence.\n",
  );
  await writeFile(join(archive, "large.md"), "x".repeat(65537));
  await symlink("/unrelated/secret.md", join(archive, "foreign.md"));
  await run(f.git.run(tree, ["add", "."]));
  await run(f.git.run(tree, ["commit", "-m", "Retain planning archive"]));
  e = { ...e, delivered_commit: await run(f.git.head(tree)) };
  e = {
    ...e,
    delivery_receipt: {
      commit: e.delivered_commit!,
      target: e.target_branch!,
      at: Id.Timestamp.make(new Date().toISOString()),
    },
  };
  e = { ...e, current_phase: "completed" };
  e = await run(f.records.save(e));
  await run(f.work.close(e.issue_id, e.execution_id));
  const project = (await run(f.records.project(e.repository_id)))!;
  await run(f.runtime.removeWorktree(project, e));
  // A similarly named checkout file must never replace a captured commit blob.
  const replacement = join(project.path, e.archive_path!);
  await mkdir(replacement, { recursive: true });
  await writeFile(join(replacement, "proposal.md"), "Uncommitted replacement");
  const commands = vi.spyOn(f.git, "run");
  const archived = await run(queries.discoverEvidence(q));
  assert.deepEqual(
    archived.entries.map((hit) => hit.identity),
    live.entries.map((hit) => hit.identity),
  );
  assert.deepEqual(archived.next, live.next);
  assert.equal(commands.mock.calls.filter(([, args]) => args.includes("ls-tree")).length, 1);
  assert.equal(
    commands.mock.calls.filter(([, args]) => args.includes("--end-of-options")).length,
    1,
  );
  const before = await run(f.records.execution(e.issue_id));
  const view = new Visibility(f.controller);
  const detail = await run(view.detail(e.issue_id));
  assert.equal(detail.planning?.source, "archive");
  assert.equal(detail.planning?.commit, e.delivered_commit);
  assert.ok(detail.documents?.includes(Id.RelativePath.make("proposal.md")));
  assert.ok(!detail.documents?.includes(Id.RelativePath.make("foreign.md")));
  assert.deepEqual(detail.errors, []);
  const document = await run(view.document(e.issue_id, Id.RelativePath.make("proposal.md")));
  assert.equal(document.content, "# The delivered plan\n\nOriginal retained evidence.\n");
  await assert.rejects(
    run(view.document(e.issue_id, Id.RelativePath.make("foreign.md"))),
    /Select a document/,
  );
  await assert.rejects(run(view.document(e.issue_id, Id.RelativePath.make("large.md"))), /64 KiB/);
  await assert.rejects(
    run(view.document(e.issue_id, Id.RelativePath.make("../../private.md"))),
    /Select a document/,
  );
  assert.deepEqual(await run(f.records.execution(e.issue_id)), before);
  e = {
    ...e,
    archive_path: Id.RelativePath.make("openspec/changes/archive/2026-11-15-another-change"),
  };
  e = await run(f.records.save(e));
  const foreign = await run(view.detail(e.issue_id));
  assert.match(foreign.errors.join(" "), /does not belong/);
  assert.equal(foreign.work.issue_id, e.issue_id);
  assert.equal(foreign.documents, undefined);
});

test("lightweight and research inspection uses scope without manufacturing OpenSpec progress", async (t) => {
  for (const policy of ["lightweight-fix", "research-only"] as const) {
    const f = await run(fixture);
    t.onTestFinished(() => run(f.close()));
    const project = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
    project.openspec = false;
    await run(f.records.saveProject(project));
    f.spec.status = () =>
      Effect.fail(new CrewError("UNEXPECTED", "Scoped work must not read OpenSpec"));
    const view = new Visibility(f.controller);
    const created = await run(
      f.controller.createWork(
        {
          repository_id: project.id,
          title: `Inspect ${policy}`,
          description: "Scope-owned task",
          workflow_policy: policy,
          scope: {
            goal: "Describe the owner",
            acceptance: ["Preserve observed evidence"],
            constraints: ["Do not fabricate progress"],
          },
          request_id: Id.RequestId.make(`inspection-${policy}`),
        },
        Id.SessionId.make("ses_supervisor"),
      ),
    );
    await run(f.controller.start(created.issue.id));
    const detail = await run(view.detail(created.issue.id));
    assert.equal(detail.work.policy, policy);
    assert.equal(detail.progress, undefined);
    assert.equal(detail.change, undefined);
    assert.equal(detail.documents, undefined);
    assert.match(detail.proposal!, /Describe the owner/);
    assert.match(
      detail.proposal!,
      policy === "research-only" ? /Research contract/ : /Lightweight scope/,
    );
    assert.deepEqual(detail.errors, []);
  }
});

test("schema, approval provenance and repair observations preserve exact pending authority and legacy absence", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.plan_approval = false;
  p.repair_rounds = 2;
  await run(f.records.saveProject(p));
  f.config.supervision_mode = "attended-automatic";
  const e = await run(
    planned(f, Id.IssueId.make("contract-observation"), {
      openspec_schema: Id.SpecSchemaName.make("target-only"),
      require_plan_approval: true,
    }),
  );
  await run(f.controller.approve(e.issue_id, "plan", Id.SessionId.make("ses_supervisor")));
  const before = await run(f.records.execution(e.issue_id)),
    view = new Visibility(f.controller),
    detail = await run(view.detail(e.issue_id)),
    diagnostic = await run(f.controller.diagnostics(e.issue_id)),
    worker = await run(f.controller.queries.inspectWorker(e.issue_id, e.explore_session_id!)),
    contract = detail.work.execution_contract!;
  assert.deepEqual(contract, diagnostic.execution_contract);
  assert.deepEqual(contract, worker.execution_contract);
  assert.equal(contract.schema.state, "bound");
  assert.equal(contract.schema.state === "bound" && contract.schema.name, "target-only");
  assert.deepEqual(contract.plan_approval, { required: true, source: "task_requirement" });
  assert.deepEqual(contract.repair, { configured: 2, allowance: 2, consumed: 0, remaining: 2 });
  assert.equal("files" in contract.schema, false);
  assert.ok(Schema.is(visibility.methods.detail.output)(detail));
  assert.deepEqual(await run(f.records.execution(e.issue_id)), before);
  assert.equal(f.runtime.forms.size, 1);
  assert.equal(f.runtime.prompts, 1);
  f.config.supervision_mode = "manual";
  assert.deepEqual((await run(f.controller.diagnostics(e.issue_id))).execution_contract.repair, {
    configured: 2,
    allowance: 0,
    consumed: 0,
    remaining: 0,
  });
  const legacy = { ...structuredClone(before!), effective_policy: { ...before!.effective_policy } };
  delete legacy.openspec_schema_binding;
  delete legacy.effective_policy.plan_approval_source;
  await run(f.records.store.set(Id.StorageKey.make(`execution/${e.issue_id}`), legacy));
  const observed = await run(view.detail(e.issue_id));
  assert.deepEqual(observed.work.execution_contract?.schema, {
    state: "unavailable",
    reason: "legacy_record",
  });
  assert.deepEqual(observed.work.execution_contract?.plan_approval, {
    required: true,
    source: "unavailable",
  });
  assert.deepEqual(await run(f.records.execution(e.issue_id)), legacy);
  assert.equal(f.runtime.forms.size, 1);
  assert.equal(f.runtime.prompts, 1);
});
