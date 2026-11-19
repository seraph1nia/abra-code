import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig, loadConfig } from "../../src/config/load.ts";
import { presentConfig } from "../../src/config/presentation.ts";
import { hostConfiguration } from "../../src/config/host.ts";
import { run } from "../effects.ts";
const base = "version: 1\nmodels:\n  default: { providerID: example, id: basic, variant: high }\n";

test("definition selection defaults by role and stays independent from the native override during offline inspection", async () => {
  const config = await run(
    resolveConfig(
      "/installation",
      "/installation/abracode.yaml",
      base + "workers:\n  apply: {definition: specialist, agent: external}\n",
    ),
  );
  assert.equal(config.workers.apply?.definition, "specialist");
  assert.equal(config.workers.apply?.agent, "external");
  assert.equal(config.workers.review?.definition, "review");
  assert.equal(config.workers.review?.agent, undefined);
  await assert.rejects(
    run(
      resolveConfig(
        "/installation",
        "/installation/abracode.yaml",
        base + "workers:\n  apply: {definition: 'invalid identity'}\n",
      ),
    ),
  );
});

test("model overrides replace the whole selection without inheriting another model's variant", async () => {
  const config = await run(
    resolveConfig(
      "/installation",
      "/installation/abracode.yaml",
      base + "  overrides:\n    apply: { providerID: other, id: implementer }\n",
    ),
  );
  assert.equal(config.workers.apply?.model?.id, "implementer");
  assert.equal(config.workers.apply?.model?.variant, undefined);
  assert.equal(config.workers.review?.model?.variant, "high");
  assert.equal(config.supervisor_model.id, "basic");
  assert.equal(config.work_database, "/installation/.abracode/work.sqlite");
  assert.equal(presentConfig(config).models.apply.source, "models.overrides.apply");
  const host = hostConfiguration(config);
  assert.equal(host.default_agent, "abra");
  assert.ok(!("agent" in host), "native registration owns instructions and profile fields");
});

test("configuration rejects typos, duplicate keys, missing models, unknown versions and duplicate identities", async () => {
  for (const value of [
    "",
    "version: 1\n",
    base + "mxa_workers: 2\n",
    base + "max_workers: 2\nmax_workers: 3\n",
    base.replace("version: 1", "version: 2"),
    base + "models: {}\n",
    base + "models: { default: {providerID: x, id: y, effort: invented}}\n",
    base +
      "repositories:\n  - {id: a, remote: 'https://github.com/a/b.git'}\n  - {id: b, remote: 'git@github.com:a/b'}\n",
  ]) {
    await assert.rejects(run(resolveConfig("/installation", "/installation/abracode.yaml", value)));
  }
});

test("static configuration reads leave a fresh home untouched and never adopt legacy config", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "abracode-config-"));
  t.onTestFinished(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, "projects.yaml"), "max_workers: 5\n");
  await assert.rejects(run(loadConfig(home)), /Copy abracode.example/);
  await writeFile(join(home, "abracode.yaml"), base);
  const config = await run(loadConfig(home));
  assert.equal(config.max_workers, 2);
  assert.deepEqual((await readdir(home)).sort(), ["abracode.yaml", "projects.yaml"]);
});

test("tracked example, isolated ignore rules and generated host files share the naming contract", async (t) => {
  const { readFile, mkdir, copyFile, symlink } = await import("node:fs/promises");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const command = promisify(execFile);
  const { generateHostConfiguration } = await import("../../src/config/host.ts");
  const example = await readFile("abracode.example.yaml", "utf8");
  const root = await mkdtemp(join(tmpdir(), "abracode-files-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  await command("git", ["init", root]);
  await copyFile(".gitignore", join(root, ".gitignore"));
  const paths = [
    "abracode.yaml",
    "abracode.yaml.fixture.tmp",
    ".abracode/config/opencode/opencode.json",
    "projects.yaml",
    ".opencrew/sentinel",
    "abracode.example.yaml",
    "abracode.schema.json",
    "src/source.sqlite",
    "nested/abracode.yaml",
  ];
  for (const path of paths) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), "");
  }
  const ignored = (await command("git", ["check-ignore", ...paths], { cwd: root })).stdout
    .trim()
    .split("\n");
  assert.deepEqual(ignored, paths.slice(0, 5));
  for (const name of ["first", "second"]) {
    const home = join(root, name);
    await mkdir(home);
    const config = await run(resolveConfig(home, join(home, "abracode.yaml"), example));
    const generated = await run(generateHostConfiguration(config));
    const host = JSON.parse(await readFile(generated, "utf8"));
    assert.equal(host.default_agent, "abra");
    assert.deepEqual(host.plugins, [join(home, ".opencode/plugins/abracode")]);
    assert.ok(!("agent" in host), "bootstrap does not duplicate native instructions");
    await mkdir(join(home, ".opencrew"));
    const { assertFreshPaths } = await import("../../src/config/host.ts");
    await mkdir(join(home, ".opencrew/state"));
    await symlink(join(home, ".opencrew/state"), join(home, ".abracode/state"));
    await assert.rejects(run(assertFreshPaths(config)), /starts fresh/);
    await assert.rejects(run(generateHostConfiguration(config)), /starts fresh/);

    await assert.rejects(
      run(
        generateHostConfiguration({
          ...config,
          work_database: join(home, ".opencrew/work.sqlite") as typeof config.work_database,
        }),
      ),
      /starts fresh/,
    );
  }
});

test("supervision postures compose scheduling without granting execution policy", async () => {
  for (const [mode, scheduling] of [
    ["manual", false],
    ["attended-automatic", true],
    ["unattended", true],
  ] as const) {
    const config = await run(
      resolveConfig(
        "/installation",
        "/installation/abracode.yaml",
        base + `supervision_mode: ${mode}\n`,
      ),
    );
    assert.equal(config.auto_schedule, scheduling);
    assert.equal(presentConfig(config).supervision.optional_repairs, mode !== "manual");
    assert.equal(config.repositories.length, 0);
    assert.equal(
      presentConfig(config).supervision.budgets,
      "Existing per-execution diagnostic/repair budgets; mode grants none",
    );
    await assert.rejects(
      run(
        resolveConfig(
          "/installation",
          "/installation/abracode.yaml",
          base + `supervision_mode: ${mode}\nauto_schedule: ${!scheduling}\n`,
        ),
      ),
      /conflicts/,
    );
    assert.equal(
      (
        await run(
          resolveConfig(
            "/installation",
            "/installation/abracode.yaml",
            base + `supervision_mode: ${mode}\nauto_schedule: ${scheduling}\n`,
          ),
        )
      ).auto_schedule,
      scheduling,
    );
  }
  assert.equal(
    (await run(resolveConfig("/installation", "/installation/abracode.yaml", base)))
      .supervision_mode,
    undefined,
  );
  assert.equal(
    (
      await run(
        resolveConfig(
          "/installation",
          "/installation/abracode.yaml",
          base + "auto_schedule: true\n",
        ),
      )
    ).auto_schedule,
    true,
  );
});

test("documented attended opt-in resolves without changing shipped defaults or registered execution authority", async (t) => {
  const { readFile } = await import("node:fs/promises");
  const { fixture, planned } = await import("../fixtures.ts");
  const { registrationPolicy, planPolicy } = await import("../../src/config/policy.ts");
  const { RepositoryId, IssueId } = await import("../../src/identities.ts");
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f, IssueId.make("before-opt-in")));
  const retained = await run(f.records.execution(e.issue_id));
  const projects = await run(f.records.projects());
  const config = await run(
    resolveConfig(
      f.root,
      join(f.root, "opt-in.yaml"),
      await readFile("docs/examples/attended-automatic.yaml", "utf8"),
    ),
  );
  assert.equal(config.supervision_mode, "attended-automatic");
  assert.equal(config.auto_schedule, true);
  assert.equal(config.repositories.length, 1);
  const selected = config.repositories[0]!;
  assert.equal(planPolicy(registrationPolicy(selected), "full-openspec").plan_approval, false);
  assert.equal(
    planPolicy(registrationPolicy(selected), "full-openspec", undefined, true).plan_approval,
    true,
  );
  assert.equal(selected.merge_approval, true);
  assert.equal(selected.repair_rounds, 2);
  assert.deepEqual(selected.verification, [
    ["pnpm", "test"],
    ["pnpm", "build"],
  ]);
  const defaults = await run(
    resolveConfig(
      f.root,
      join(f.root, "default.yaml"),
      await readFile("abracode.example.yaml", "utf8"),
    ),
  );
  assert.equal(defaults.auto_schedule, false);
  assert.equal(defaults.supervision_mode, undefined);
  assert.deepEqual(defaults.repositories, []);
  assert.equal(registrationPolicy({}).plan_approval, true);
  const foreign = await run(f.records.project(RepositoryId.make("frontend")));
  assert.equal(foreign?.plan_approval, true);
  assert.equal(foreign?.merge_approval, true);
  assert.equal(foreign?.repair_rounds, 0);
  assert.deepEqual(await run(f.records.projects()), projects);
  assert.deepEqual(await run(f.records.execution(e.issue_id)), retained);
});
