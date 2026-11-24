import { createWorkflow } from "../../src/opencode/application.ts";
import { parseDocument } from "yaml";
import assert from "node:assert/strict";
import { test as baseTest } from "vite-plus/test";
import { readFile, writeFile, access, cp, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { OpenSpec } from "../../src/openspec/adapter.ts";

import { ProcessRunner, type Runner } from "../../src/process.ts";
import { fixture } from "../fixtures.ts";
import { run } from "../effects.ts";
import * as Id from "@abracode/contracts/identities";
import { verifiedSpec } from "../helpers/spec-review.ts";

// Each case owns its Git repositories, native schema and controller. Overlap
// CLI waits without sharing mutable repositories or process-wide environment.
const test = baseTest.concurrent;

async function prepare(
  t: { onTestFinished: (cleanup: () => Promise<void>) => void },
  selected?: string,
  unrelated = false,
) {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const runner: Runner = {
    run: (file, args, cwd, env, options) =>
      new ProcessRunner().run(
        file,
        args,
        cwd,
        { ...env, XDG_CONFIG_HOME: join(f.root, "config"), XDG_DATA_HOME: join(f.root, "data") },
        options,
      ),
  };
  const bin = Id.Executable.make(resolve("node_modules/.bin/openspec"));
  const project = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  const compact = selected === "abra-compact-v1";
  if (compact)
    await cp(
      resolve("openspec/schemas/abra-compact-v1"),
      join(project.path, "openspec/schemas/abra-compact-v1"),
      { recursive: true },
    );
  else
    await run(
      runner.run(bin, ["schema", "fork", "spec-driven", "target-only", "--json"], project.path),
    );
  if (unrelated) {
    const path = join(project.path, "openspec/schemas/target-only/schema.yaml"),
      document = parseDocument(await readFile(path, "utf8"));
    document.addIn(["artifacts"], {
      id: "later-notes",
      generates: "later-notes.md",
      description: "Unrelated optional notes",
      template: "proposal.md",
      instruction: "Prepare only when separately needed.",
      requires: [],
    });
    await writeFile(path, document.toString());
  }
  await writeFile(
    join(project.path, "openspec/config.yaml"),
    `schema: ${compact ? "abra-compact-v1" : "target-only"}\n`,
  );
  await run(f.git.commit(project.path, Id.IssueId.make("schema-setup"), "Own target-only schema"));
  await run(f.git.run(project.path, ["push", "origin", "main"]));
  const spec = new OpenSpec(runner, bin);
  const controller = createWorkflow(
    f.config,
    f.records,
    f.work,
    spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  ).controller;
  t.onTestFinished(() => run(controller.close()));
  const parent = Id.SessionId.make("ses_schema-owner");
  const issue = (
    await run(
      controller.createWork(
        {
          repository_id: project.id,
          title: "Schema-bound work",
          description: "Keep the selected native contract",
          request_id: Id.RequestId.make("schema-bound-work"),
          ...(selected ? { openspec_schema: Id.SpecSchemaName.make(selected) } : {}),
        },
        parent,
      ),
    )
  ).issue;
  return { f, runner, bin, project, spec, controller, parent, issue };
}

test(
  "native target-only schemas resolve in the owned worktree and stay selected across default changes and retries",
  { timeout: 60000 },
  async (t) => {
    const p = await prepare(t, "target-only");
    await assert.rejects(
      run(p.runner.run(p.bin, ["schema", "which", "target-only", "--json"], p.f.config.home)),
      /exit 1/,
    );
    const e = await run(p.controller.start(p.issue.id, p.parent));
    const binding = e.openspec_schema_binding;
    assert.equal(binding?.state, "bound");
    if (binding?.state !== "bound") assert.fail("bound schema required");
    assert.equal(binding.name, "target-only");
    assert.equal(binding.selection_source, "task");
    assert.equal(binding.source, "project");
    assert.equal(binding.root, join(e.worktree_directory!, "openspec/schemas/target-only"));
    assert.ok(binding.files.some((file) => file.path === "templates/tasks.md"));
    assert.equal(p.f.runtime.prompts, 1);
    await writeFile(join(e.worktree_directory!, "openspec/config.yaml"), "schema: spec-driven\n");
    await run(p.spec.create(e));
    assert.equal((await run(p.spec.status(e))).schemaName, "target-only");
    assert.equal(p.f.runtime.prompts, 1);
    const meta = join(
        e.worktree_directory!,
        "openspec/changes",
        e.openspec_change,
        ".openspec.yaml",
      ),
      original = await readFile(meta, "utf8");
    await writeFile(meta, original.replace("target-only", "spec-driven"));
    await assert.rejects(run(p.spec.create(e)), /metadata|another schema/);
    await assert.rejects(run(p.spec.assertSchema(e)), /metadata/);
    assert.equal(await readFile(meta, "utf8"), original.replace("target-only", "spec-driven"));
    await writeFile(meta, original);
    await run(p.spec.assertSchema(e));
  },
);

test(
  "a repository default is captured once and template drift blocks a new admission without prompt replay",
  { timeout: 60000 },
  async (t) => {
    const p = await prepare(t);
    const e = await run(p.controller.start(p.issue.id, p.parent));
    const binding = e.openspec_schema_binding;
    if (binding?.state !== "bound") assert.fail("bound schema required");
    assert.equal(binding.selection_source, "repository_default");
    assert.equal(binding.name, "target-only");
    await writeFile(join(e.worktree_directory!, "openspec/config.yaml"), "schema: spec-driven\n");
    await run(p.spec.assertSchema(e));
    assert.equal((await run(p.spec.status(e))).schemaName, "target-only");
    const template = join(binding.root, "templates/tasks.md"),
      original = await readFile(template, "utf8");
    await writeFile(template, original + "\nChanged native instructions\n");
    await assert.rejects(run(p.spec.assertSchema(e)), /changed/);
    p.f.runtime.success(e.explore_session_id!);
    const prompts = p.f.runtime.prompts,
      creates = p.f.runtime.creates;
    await assert.rejects(
      run(
        p.controller.control(e.issue_id, "replan", "Retry the same planning contract", {
          id: Id.RequestId.make("schema-drift-replan"),
          sender: p.parent,
        }),
      ),
      /changed/,
    );
    assert.equal(p.f.runtime.prompts, prompts);
    assert.equal(p.f.runtime.creates, creates);
    assert.deepEqual(
      (await run(p.f.records.execution(e.issue_id)))!.openspec_schema_binding,
      binding,
    );
    await writeFile(template, Buffer.from([0xf0, 0x90, 0x80]));
    await assert.rejects(run(p.spec.assertSchema(e)), /UTF-8/);
    await writeFile(template, original);
    await run(p.spec.assertSchema(e));
    await assert.rejects(
      run(
        p.f.records.update(e.issue_id, (current) => ({
          ...current,
          openspec_schema: Id.SpecSchemaName.make("spec-driven"),
        })),
      ),
      /immutable/,
    );
    await assert.rejects(
      run(
        p.f.records.update(e.issue_id, (current) => ({
          ...current,
          openspec_schema_binding: undefined,
        })),
      ),
      /binding/,
    );
  },
);

test(
  "unavailable explicit schemas refuse Explore and never substitute the target default",
  { timeout: 60000 },
  async (t) => {
    const p = await prepare(t, "missing-schema");
    await assert.rejects(run(p.controller.start(p.issue.id, p.parent)), /missing-schema/);
    assert.equal(p.f.runtime.prompts, 0);
    assert.equal(p.f.runtime.creates, 0);
    const e = await run(p.f.records.execution(p.issue.id));
    assert.equal(e?.openspec_schema, "missing-schema");
    assert.match(e?.error_or_recovery_reason ?? "", /restore it there and retry/);
    assert.equal(e?.openspec_schema_binding?.state, "pending");
    if (e?.worktree_directory)
      await assert.rejects(
        access(join(e.worktree_directory, "openspec/changes", e.openspec_change)),
      );
  },
);

test(
  "package schema evidence cannot silently switch to a project shadow and legacy reads fabricate no binding",
  { timeout: 60000 },
  async (t) => {
    const p = await prepare(t, "spec-driven"),
      e = await run(p.controller.start(p.issue.id, p.parent));
    const binding = e.openspec_schema_binding;
    if (binding?.state !== "bound") assert.fail("bound schema required");
    assert.equal(binding.source, "package");
    assert.equal(binding.name, "spec-driven");
    await run(p.spec.assertSchema(e));
    await cp(binding.root, join(e.worktree_directory!, "openspec/schemas/spec-driven"), {
      recursive: true,
    });
    await assert.rejects(run(p.spec.assertSchema(e)), /changed/);
    const legacy = { ...e, effective_policy: { ...e.effective_policy } };
    delete legacy.openspec_schema_binding;
    delete legacy.openspec_schema;
    delete legacy.effective_policy.plan_approval_source;
    await run(p.f.records.store.set(Id.StorageKey.make(`execution/${e.issue_id}`), legacy));
    const restored = (await run(p.f.records.execution(e.issue_id)))!;
    assert.equal(restored.openspec_schema_binding, undefined);
    assert.equal(restored.effective_policy.plan_approval_source, undefined);
    await run(p.spec.assertSchema({ ...restored, worktree_directory: undefined }));
    await assert.rejects(
      run(
        p.f.records.update(e.issue_id, (current) => ({
          ...current,
          openspec_schema_binding: binding,
        })),
      ),
      /fabricated/,
    );
  },
);

test(
  "bound and legacy revision creation preserve archived schema identity across changed defaults",
  { timeout: 60000 },
  async (t) => {
    const p = await prepare(t, "target-only"),
      e = await run(p.controller.start(p.issue.id, p.parent)),
      directory = join(e.worktree_directory!, "openspec/changes", e.openspec_change);
    await writeFile(
      join(directory, "proposal.md"),
      "# Proposal\n\n## Why\nPreserve the contract.\n\n## What Changes\n- Prove schema retention.\n\n## Capabilities\n### New Capabilities\n- `revision-proof`: Retain revision behavior.\n\n### Modified Capabilities\nNone.\n\n## Impact\nInternal tooling.\n",
    );
    await writeFile(join(directory, "design.md"), "# Design\n\nPreserve the selected schema.\n");
    await mkdir(join(directory, "specs/revision-proof"), { recursive: true });
    await writeFile(
      join(directory, "specs/revision-proof/spec.md"),
      "## Purpose\n\nPreserve the selected native schema through corrective revision creation and recovery.\n\n## ADDED Requirements\n\n### Requirement: Revision retention\nThe system SHALL preserve schema selection.\n\n#### Scenario: A revision starts\n- **WHEN** a revision starts\n- **THEN** the original schema remains selected\n",
    );
    const apply = p.spec.apply.bind(p.spec);
    let observations = 0;
    p.spec.apply = (execution) => {
      observations++;
      return apply(execution);
    };
    await writeFile(join(directory, "tasks.md"), "# Tasks\n\n- [ ] 1.1 Prove retention.\n");
    await assert.rejects(run(p.spec.implemented(e)), /unfinished/);
    assert.equal(observations, 1);
    await writeFile(join(directory, "tasks.md"), "# Tasks\n\n- [x] 1.1 Prove retention.\n");
    await run(p.spec.implemented(e));
    assert.equal(observations, 2);
    const archive = await run(p.spec.archive(e)),
      metadata = join(e.worktree_directory!, archive, ".openspec.yaml"),
      original = await readFile(metadata, "utf8"),
      head = await run(p.f.git.commit(e.worktree_directory!, e.issue_id));
    await writeFile(join(e.worktree_directory!, "openspec/config.yaml"), "schema: spec-driven\n");
    const bound = { ...e, openspec_change: Id.ChangeName.make(`${e.openspec_change}-r1`) };
    await run(p.spec.create(bound));
    assert.equal((await run(p.spec.status(bound))).schemaName, "target-only");
    assert.deepEqual(bound.openspec_schema_binding, e.openspec_schema_binding);
    const legacy = {
      ...e,
      openspec_change: Id.ChangeName.make(`${e.openspec_change}-r2`),
      rounds: [
        {
          schema_version: 1 as const,
          id: Id.RoundId.make("legacy-round"),
          ordinal: 2,
          generation: e.control_generation,
          source: "review" as const,
          starting_head: head,
          plan_fingerprint: Id.Fingerprint.make("a".repeat(64)),
          findings: [],
          instructions: "Preserve the original schema",
          openspec_change: e.openspec_change,
          archive_path: archive,
          approval_receipts: [],
          created_at: 0,
        },
      ],
    };
    delete legacy.openspec_schema_binding;
    delete legacy.openspec_schema;
    // Resolve the retained commit's metadata even if today's archive copy was edited.
    await writeFile(metadata, original.replace("target-only", "spec-driven"));
    await run(p.spec.create(legacy));
    await run(p.spec.create(legacy));
    assert.equal((await run(p.spec.status(legacy))).schemaName, "target-only");
    assert.equal(legacy.openspec_schema_binding, undefined);
    assert.equal(await readFile(metadata, "utf8"), original.replace("target-only", "spec-driven"));
    await writeFile(metadata, original);
    assert.equal(await readFile(metadata, "utf8"), original);
    await assert.rejects(
      run(
        p.spec.create({
          ...legacy,
          rounds: [],
          openspec_change: Id.ChangeName.make("unknown-legacy-revision"),
        }),
      ),
      /Original legacy schema metadata is unavailable/,
    );
  },
);

test(
  "native planning rejects premature tasks, accepts explicit skipped specs and rejects conflicting deltas",
  { timeout: 60000 },
  async (t) => {
    const p = await prepare(t, "target-only", true),
      e = await run(p.controller.start(p.issue.id, p.parent));
    const directory = join(e.worktree_directory!, "openspec/changes", e.openspec_change);
    await writeFile(
      join(directory, "tasks.md"),
      "# Tasks\n\n- [ ] 1.1 Prove the unchanged contract.\n",
    );
    p.f.runtime.success(e.explore_session_id!);
    const prompts = p.f.runtime.prompts;
    await assert.rejects(run(p.controller.advance(e.issue_id)), /prerequisite/);
    assert.equal(p.f.runtime.prompts, prompts);
    assert.equal((await run(p.f.records.execution(e.issue_id)))?.apply_session_id, undefined);
    const metadata = join(directory, ".openspec.yaml");
    await writeFile(metadata, (await readFile(metadata, "utf8")) + "\nskip_specs: true\n");
    await writeFile(
      join(directory, "proposal.md"),
      "# Proposal\n\n## Why\nClarify unchanged tooling.\n\n## What Changes\n- Simplify internal tooling.\n\n## Capabilities\n### New Capabilities\nNone.\n### Modified Capabilities\nNone.\n\n## Impact\nInternal tooling only.\n",
    );
    await writeFile(join(directory, "design.md"), "# Design\n\nKeep the existing behavior.\n");
    const plan = await run(p.spec.plan(e));
    assert.equal(plan.status.isPlanningComplete, false);
    assert.equal(
      plan.status.artifacts.find((artifact) => artifact.id === "later-notes")?.status,
      "ready",
    );
    assert.equal(plan.status.artifacts.find((a) => a.id === "specs")?.status, "skipped");
    assert.equal(plan.apply.progress.remaining, 1);
    await assert.rejects(run(p.spec.implemented(e)), /unfinished/);
    await mkdir(join(directory, "specs/sample"), { recursive: true });
    await writeFile(
      join(directory, "specs/sample/spec.md"),
      "## ADDED Requirements\n\n### Requirement: Conflicting delta\nThe tooling SHALL retain behavior.\n\n#### Scenario: Tooling runs\n- **WHEN** tooling runs\n- **THEN** behavior remains\n",
    );
    await assert.rejects(run(p.spec.plan(e)));
    assert.equal(p.f.runtime.prompts, prompts);
  },
);

for (const variant of ["compact-behavior", "compact-skip", "detailed"] as const)
  test(
    `native ${variant} planning crosses controller checks and independent Review before archival and human merge`,
    { timeout: 90000 },
    async (t) => {
      const compact = variant !== "detailed",
        p = await prepare(t, compact ? "abra-compact-v1" : "spec-driven"),
        project = (await run(p.f.records.project(p.project.id)))!;
      project.plan_approval = !compact;
      project.merge_approval = true;
      await run(p.f.records.saveProject(project));
      let e = await run(p.controller.start(p.issue.id, p.parent));
      const binding = e.openspec_schema_binding;
      if (binding?.state !== "bound") assert.fail("schema binding required");
      assert.equal(binding.name, compact ? "abra-compact-v1" : "spec-driven");
      const directory = join(e.worktree_directory!, "openspec/changes", e.openspec_change),
        skipped = variant === "compact-skip";
      await writeFile(
        join(directory, "proposal.md"),
        `# Proposal\n\n## Why\nProve the selected planning contract.\n\n## What Changes\n- Verify native controller behavior.\n\n## Capabilities\n### New Capabilities\n${skipped ? "None." : "- `compact-proof`: Preserve selected planning behavior."}\n\n### Modified Capabilities\nNone.\n\n## Impact\nDisposable fixture only.\n`,
      );
      if (skipped) {
        const metadata = join(directory, ".openspec.yaml");
        await writeFile(metadata, (await readFile(metadata, "utf8")) + "\nskip_specs: true\n");
      } else {
        await mkdir(join(directory, "specs/compact-proof"), { recursive: true });
        await writeFile(
          join(directory, "specs/compact-proof/spec.md"),
          "## Purpose\n\nKeep the selected native planning contract observable throughout the controller lifecycle.\n\n## ADDED Requirements\n\n### Requirement: Selected planning\nThe system SHALL preserve the selected planning contract.\n\n#### Scenario: Implementation finishes\n- **WHEN** implementation finishes\n- **THEN** matching checks and independent Review precede archival\n",
        );
      }
      if (!compact)
        await writeFile(
          join(directory, "design.md"),
          "# Design\n\nKeep the detailed schema and controller authority.\n",
        );
      await writeFile(
        join(directory, "tasks.md"),
        "# Tasks\n\n- [ ] 1.1 Implement and prove the selected contract.\n",
      );
      const planning = await run(p.spec.plan(e));
      assert.deepEqual(planning.status.applyRequires, ["tasks"]);
      assert.equal(
        planning.status.artifacts.some((a) => a.id === "design"),
        !compact,
      );
      assert.equal(planning.apply.progress.total, 1);
      if (compact) await assert.rejects(access(join(directory, "design.md")), /ENOENT/);
      p.f.runtime.success(e.explore_session_id!);
      e = await run(p.controller.advance(e.issue_id));
      if (!compact) {
        assert.equal(e.current_phase, "awaiting_plan_approval");
        const pending = await run(p.controller.approve(e.issue_id, "plan", p.parent));
        assert.ok("form_id" in pending);
        p.f.runtime.forms.set(Id.FormId.make(pending.form_id), "approved");
        await run(p.controller.approve(e.issue_id, "plan", p.parent));
        e = await run(p.controller.get(e.issue_id));
      }
      assert.equal(e.current_phase, "applying");
      assert.ok(e.apply_session_id);
      assert.notEqual(e.apply_session_id, e.explore_session_id);
      assert.equal(e.approval_receipts.filter((r) => r.kind === "plan").length, compact ? 0 : 1);
      // A completed native turn without finished tasks must not produce a check/Review receipt.
      p.f.runtime.success(e.apply_session_id!);
      await assert.rejects(run(p.controller.advance(e.issue_id)), /unfinished/);
      assert.equal((await run(p.controller.get(e.issue_id))).review_session_id, undefined);
      await writeFile(
        join(directory, "tasks.md"),
        "# Tasks\n\n- [x] 1.1 Implement and prove the selected contract.\n",
      );
      e = await run(p.controller.control(e.issue_id, "retry"));
      p.f.runtime.success(e.apply_session_id!);
      e = await run(p.controller.advance(e.issue_id));
      assert.equal(e.current_phase, "verifying");
      assert.ok(e.verification_receipt);
      assert.ok(e.review_session_id);
      assert.notEqual(e.review_session_id, e.apply_session_id);
      await assert.rejects(
        run(
          p.controller.reviewReport(
            e.apply_session_id!,
            true,
            "Wrong role",
            undefined,
            verifiedSpec,
          ),
        ),
        /Review session/,
      );
      await assert.rejects(
        run(p.controller.reviewReport(e.review_session_id!, true, "Missing scorecard")),
        /completeness/,
      );
      await run(
        p.controller.reviewReport(
          e.review_session_id!,
          true,
          "Fixture checked against native tasks and selected schema",
          "in_scope",
          verifiedSpec,
        ),
      );
      p.f.runtime.success(e.review_session_id!);
      e = await run(p.controller.advance(e.issue_id));
      assert.equal(e.current_phase, "awaiting_merge");
      assert.equal(e.review_receipt?.fingerprint, e.verification_receipt?.fingerprint);
      assert.deepEqual(e.openspec_schema_binding, binding);
      assert.ok(e.archive_path);
      const archived = join(e.worktree_directory!, e.archive_path!);
      assert.match(
        await readFile(join(archived, ".openspec.yaml"), "utf8"),
        new RegExp(`schema: ${binding.name}`),
      );
      if (skipped)
        await assert.rejects(
          access(join(e.worktree_directory!, "openspec/specs/compact-proof/spec.md")),
          /ENOENT/,
        );
      else
        assert.match(
          await readFile(
            join(e.worktree_directory!, "openspec/specs/compact-proof/spec.md"),
            "utf8",
          ),
          /Selected planning/,
        );
      const merge = await run(p.controller.approve(e.issue_id, "merge", p.parent));
      assert.ok("form_id" in merge);
      assert.equal((await run(p.controller.get(e.issue_id))).current_phase, "awaiting_merge");
      assert.equal(p.f.runtime.forms.get(Id.FormId.make(merge.form_id)), "pending");
    },
  );
