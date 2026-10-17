import { writeFile } from "node:fs/promises";
import { Controller } from "../../src/workflow/controller.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import { encode } from "@toon-format/toon";
import { fixture, applying } from "../fixtures.ts";
import { run } from "../effects.ts";
import * as Id from "../../src/identities.ts";
import {
  ExternalDocument,
  ExternalRecord,
  SkippedSteps,
  externalOwns,
} from "../../src/validation/contracts.ts";
import { machineDocument, intentDigest } from "../../src/validation/no-mistakes.ts";
import { consumesWorker } from "../../src/workflow/capacity.ts";
import { CrewError } from "../../src/domain.ts";

const stepNames = ["intent", "rebase", "review", "test", "document", "lint", "push", "pr", "ci"];

test("pinned machine decoder preserves quoted multiline findings and rejects unsupported outcomes", async () => {
  const output =
    "run:\n  id: run-1\n  branch: crew/test\n  head_sha: " +
    "a".repeat(40) +
    '\n  status: running\n  steps[1]{step,status,findings,duration_ms}:\n    review,awaiting_approval,1,25\ngate:\n  step: review\n  status: awaiting_approval\n  findings[1]{id,severity,file,action,description}:\n    R1,blocking,src/a.ts,ask_user,"Preserve commas, quotes \\"and\\" lines\\nNext line"';
  const doc = await run(machineDocument(ExternalDocument, output));
  assert.equal(doc.gate!.findings[0].description, 'Preserve commas, quotes "and" lines\nNext line');
  await assert.rejects(
    run(machineDocument(ExternalDocument, "outcome: future-success")),
    /v1.84.0/,
  );
  await assert.rejects(
    run(machineDocument(ExternalDocument, "run:\n bad indent: [x")),
    /Malformed|v1.84.0/,
  );
  assert.equal(
    (await run(machineDocument(ExternalDocument, 'error: "daemon unavailable"'))).error,
    "daemon unavailable",
  );
});

test("external launch proof, skipped stages and custody return precede fresh native checks and Review", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.validation = {
    engine: "no-mistakes",
    max_runs: 1,
    bin: Id.Executable.make("fake-no-mistakes"),
    home: f.root,
  };
  await run(f.records.saveProject(p));
  const real = f.git.runner;
  const calls: { args: string[]; env?: NodeJS.ProcessEnv }[] = [];
  let runId = "run-proof",
    submitted = "",
    preserved = "",
    nonce = "",
    generation = "",
    intent = "",
    branch = "";
  f.git.runner = {
    run: (file, args, cwd, env, options) =>
      file !== "fake-no-mistakes"
        ? real.run(file, args, cwd, env, options)
        : Effect.gen(function* () {
            calls.push({ args, env });
            if (args[0] === "--version") return "no-mistakes version v1.84.0 (fixture)";
            if (args.includes("--help"))
              return "--launch-nonce --validation-generation --base-branch --no-publish-intent --skip --wait";
            branch = yield* f.git.run(cwd, ["branch", "--show-current"]);
            if (args.length === 1)
              return encode({ repo: p.path, current_branch: branch, daemon: "running" });
            if (args[1] === "run") {
              submitted = yield* f.git.run(cwd, ["rev-parse", "HEAD"]);
              nonce = args[args.indexOf("--launch-nonce") + 1];
              generation = args[args.indexOf("--validation-generation") + 1];
              intent = args[args.indexOf("--intent") + 1];
              yield* Effect.tryPromise({
                try: () => writeFile(`${cwd}/source.txt`, "external fixture fix\n"),
                catch: CrewError.from,
              });
              yield* f.git.run(cwd, ["add", "source.txt"]);
              yield* f.git.run(cwd, ["commit", "-m", "Preserved external fixture fix"]);
              preserved = yield* f.git.head(cwd);
            }
            const current = {
              run: {
                id: runId,
                branch,
                status: "completed",
                head_sha: preserved,
                steps: stepNames.map((step) => ({
                  step,
                  status: SkippedSteps.some((s) => s === step) ? "skipped" : "completed",
                  findings: 0,
                  duration_ms: 1,
                })),
              },
              outcome: "passed",
            };
            if (args[1] === "run")
              return encode({
                ...current,
                launch_receipt: {
                  run_id: runId,
                  disposition: "created",
                  launch_nonce: nonce,
                  validation_generation: generation,
                  branch,
                  head_sha: submitted,
                  submitted_head_sha: submitted,
                  intent_digest: intentDigest(intent),
                },
              });
            if (args[1] === "status") return encode(current);
            if (args[1] === "sync")
              return encode({
                branch_sync: {
                  state: "custody_returned",
                  changed: false,
                  local: { branch, head: preserved, clean: true },
                  pipeline: {
                    run: runId,
                    status: "completed",
                    phase: "done",
                    submitted_head: submitted,
                    current_head: preserved,
                    pushed_head: "",
                    pushed_at: "",
                    push_generation: 0,
                  },
                  target: {
                    kind: "origin",
                    remote: "origin",
                    url: p.remote,
                    ref: `refs/heads/${branch}`,
                  },
                  remote: { observed_head: "", freshness: "cached", observed_at: "" },
                  relation: "equal",
                  safety: "user_owned",
                  pr_state: "none",
                },
              });
            throw new CrewError("FIXTURE", `Unexpected external mutation ${args[1]}`);
          }),
  };
  f.controller = new Controller(
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  );
  t.onTestFinished(() => run(f.controller.close()));
  let e = await run(applying(f));
  f.spec.done = true;
  f.runtime.success(e.apply_session_id!);
  e = await run(f.controller.advance(e.issue_id));
  assert.equal(e.current_phase, "verifying");
  assert.equal(e.external_validation!.status, "adopted");
  assert.equal(externalOwns(e), false);
  assert.notEqual(e.external_validation!.adoption!.head, e.external_validation!.submitted_head);
  assert.equal(e.external_validation!.adoption!.head, await run(f.git.head(e.worktree_directory!)));
  assert.match(
    await run(f.git.run(e.worktree_directory!, ["log", "-1", "--format=%s"])),
    /Preserved external fixture fix/,
  );
  assert.ok(e.verification_receipt);
  assert.equal(e.review_receipt, undefined);
  assert.ok(e.review_session_id);
  const starts = calls.filter((c) => c.args[1] === "run" && !c.args.includes("--help"));
  assert.equal(starts.length, 1);
  assert.equal(starts[0].args[starts[0].args.indexOf("--skip") + 1], "rebase,push,pr,ci");
  assert.ok(starts[0].args.includes("--no-publish-intent"));
  assert.equal(starts[0].args.includes("--yes"), false);
  assert.equal(starts[0].env!.NM_HOME, f.root);
  assert.equal(
    calls.some((c) => ["init", "restart", "respond"].includes(c.args[1])),
    false,
  );
  const bad = { ...e.external_validation!, custody: "external" };
  assert.throws(() => Schema.decodeUnknownSync(ExternalRecord)(bad));
  assert.equal(
    consumesWorker({
      ...e,
      active_role: undefined,
      capacity_reservation: undefined,
      external_validation: {
        ...e.external_validation!,
        custody: "uncertain",
        status: "running",
        adoption: undefined,
      },
    }),
    true,
  );
});

test("lost launch/response, pause and explicit abort retain one engine run and exclusive custody", async (t) => {
  const { Clock } = await import("effect");
  const { TestClock } = await import("effect/testing");
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.validation = {
    engine: "no-mistakes",
    max_runs: 1,
    bin: Id.Executable.make("recording-engine"),
    home: f.root,
  };
  await run(f.records.saveProject(p));
  await writeFile(`${f.root}/config.yaml`, "auto_fix:\n  review: 1\n");
  const real = f.git.runner,
    calls: string[][] = [];
  let nonce = "",
    generation = "",
    intent = "",
    submitted = "",
    branch = "",
    lostLaunch = true,
    gate = "review",
    cancelled = false,
    unsafeSync = true;
  const current = () => ({
    run: {
      id: "durable-run",
      branch,
      status: cancelled ? "cancelled" : "running",
      head_sha: submitted,
      steps: stepNames.map((step) => ({
        step,
        status:
          step === gate
            ? "awaiting_approval"
            : SkippedSteps.some((s) => s === step)
              ? "skipped"
              : "completed",
        findings: step === gate ? 1 : 0,
        duration_ms: 1,
      })),
    },
    ...(cancelled
      ? { outcome: "cancelled" }
      : {
          gate: {
            step: gate,
            status: "awaiting_approval",
            summary: "Needs an explicit accepted-scope decision",
            findings: [
              {
                id: gate === "review" ? "R1" : "T1",
                severity: "blocking",
                file: "source.txt",
                action: "ask_user",
                description: "Keep accepted scope and protected paths",
              },
            ],
          },
        }),
  });
  f.git.runner = {
    run: (file, args, cwd, env, options) =>
      file !== "recording-engine"
        ? real.run(file, args, cwd, env, options)
        : Effect.gen(function* () {
            calls.push(args);
            if (args[0] === "--version") return "no-mistakes version v1.84.0 (fixture)";
            if (args.includes("--help"))
              return "--launch-nonce --validation-generation --base-branch --no-publish-intent --skip --wait";
            if (args.length === 1)
              return encode({
                repo: p.path,
                current_branch: yield* f.git.run(cwd, ["branch", "--show-current"]),
                daemon: "running",
              });
            if (args[1] === "run") {
              const incoming = args[args.indexOf("--launch-nonce") + 1];
              if (nonce) assert.equal(incoming, nonce);
              nonce = incoming;
              generation = args[args.indexOf("--validation-generation") + 1];
              intent = args[args.indexOf("--intent") + 1];
              submitted = yield* f.git.head(cwd);
              branch = yield* f.git.run(cwd, ["branch", "--show-current"]);
              if (lostLaunch) {
                lostLaunch = false;
                return yield* new CrewError(
                  "RESPONSE_LOST",
                  "Launch response lost after admission",
                );
              }
              return encode({
                ...current(),
                launch_receipt: {
                  run_id: "durable-run",
                  disposition: "reused",
                  launch_nonce: nonce,
                  validation_generation: generation,
                  branch,
                  head_sha: submitted,
                  submitted_head_sha: submitted,
                  intent_digest: intentDigest(intent),
                },
              });
            }
            if (args[1] === "status") return encode(current());
            if (args[1] === "respond") {
              assert.equal(args[args.indexOf("--step") + 1], "review");
              gate = "test";
              return yield* new CrewError("RESPONSE_LOST", "Response lost after gate advanced");
            }
            if (args[1] === "abort") {
              cancelled = true;
              return encode({ aborted: true, run: "durable-run" });
            }
            if (args[1] === "sync")
              return encode({
                branch_sync: {
                  state: unsafeSync ? "pipeline_owned" : "user_owned",
                  changed: false,
                  ...(unsafeSync
                    ? {
                        next_action: {
                          code: "recover_custody",
                          command: "no-mistakes axi sync --recover --keep-local",
                        },
                      }
                    : {}),
                  local: { branch, head: submitted, clean: true },
                  pipeline: {
                    run: "durable-run",
                    status: "cancelled",
                    phase: "done",
                    submitted_head: submitted,
                    current_head: submitted,
                    pushed_head: "",
                    pushed_at: "",
                    push_generation: 0,
                  },
                  target: {
                    kind: "origin",
                    remote: "origin",
                    url: p.remote,
                    ref: `refs/heads/${branch}`,
                  },
                  remote: { observed_head: "", freshness: "cached", observed_at: "" },
                  relation: "equal",
                  safety: "user_owned",
                  pr_state: "none",
                },
              });
            return yield* new CrewError("FIXTURE", `Unexpected engine call ${args.join(" ")}`);
          }),
  };
  f.controller = new Controller(
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  );
  t.onTestFinished(() => run(f.controller.close()));
  const clock = await run(TestClock.make());
  const call = <A, E>(effect: Effect.Effect<A, E>) =>
    run(effect.pipe(Effect.provideService(Clock.Clock, clock)));
  let e = await run(applying(f));
  f.spec.done = true;
  f.runtime.success(e.apply_session_id!);
  e = await call(f.controller.advance(e.issue_id));
  assert.equal(e.current_phase, "validating_external");
  assert.equal(e.external_validation!.custody, "uncertain");
  assert.equal(e.external_validation!.launch, undefined);
  const savedNonce = e.external_validation!.nonce;
  await run(f.controller.close());
  f.controller = new Controller(
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  );
  await call(clock.setTime(31000));
  e = (await call(f.controller.reconcile(e.issue_id)))[0];
  assert.equal(e.external_validation!.nonce, savedNonce);
  assert.equal(e.external_validation!.launch!.run_id, "durable-run");
  assert.equal(e.external_history?.length ?? 0, 0);
  assert.equal(e.external_validation!.status, "gated");
  assert.ok(e.decisions!.some((d) => d.status === "open" && d.owner === "user"));
  await assert.rejects(call(f.controller.control(e.issue_id, "replan")), /custody/);
  e = await call(f.controller.control(e.issue_id, "pause"));
  assert.equal(externalOwns(e), true);
  assert.equal(consumesWorker(e), true);
  const count = calls.length;
  await call(f.controller.reconcile(e.issue_id));
  assert.equal(calls.length, count);
  e = await call(f.controller.control(e.issue_id, "resume"));
  const state = await run(f.records.feedback(e.issue_id));
  const input = {
    issue_id: e.issue_id,
    generation: e.control_generation,
    expected_head: e.external_validation!.submitted_head,
    action: "respond" as const,
    response: "fix" as const,
    gate_digest: state.external_gate_digest,
  };
  e = await call(f.controller.validation(input, Id.SessionId.make("ses_supervisor")));
  assert.equal(calls.filter((a) => a[1] === "respond").length, 0);
  const form = e.external_validation!.responses[0].form_id;
  f.runtime.forms.set(form, "approved");
  e = await call(f.controller.validation(input, Id.SessionId.make("ses_supervisor")));
  assert.equal(e.external_validation!.responses[0].status, "uncertain");
  await run(f.controller.close());
  f.controller = new Controller(
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  );
  f.runtime.forms.clear();
  await call(clock.setTime(62000));
  e = (await call(f.controller.reconcile(e.issue_id)))[0];
  assert.equal(e.external_validation!.responses[0].status, "confirmed");
  assert.equal(e.external_validation!.observation!.gate!.step, "test");
  await assert.rejects(
    call(f.controller.validation(input, Id.SessionId.make("ses_supervisor"))),
    /Gate|gate/,
  );
  assert.equal(calls.filter((a) => a[1] === "respond").length, 1);
  assert.equal(calls.filter((a) => a[1] === "run" && !a.includes("--help")).length, 2);
  const abort = {
    issue_id: e.issue_id,
    generation: e.control_generation,
    expected_head: e.external_validation!.submitted_head,
    action: "abort" as const,
  };
  await call(f.controller.validation(abort, Id.SessionId.make("ses_supervisor")));
  const approval = [...f.runtime.forms.entries()].find(
    ([id, status]) => id !== form && status === "pending",
  )![0];
  f.runtime.forms.set(approval, "approved");
  await assert.rejects(
    call(f.controller.validation(abort, Id.SessionId.make("ses_supervisor"))),
    /manual recovery|substitute/,
  );
  e = await run(f.controller.get(e.issue_id));
  assert.equal(externalOwns(e), true);
  assert.equal(calls.filter((a) => a[1] === "sync" && !a.includes("--check")).length, 0);
  unsafeSync = false;
  e = await call(f.controller.validation(abort, Id.SessionId.make("ses_supervisor")));
  assert.equal(calls.filter((a) => a[1] === "abort").length, 1);
  assert.equal(e.external_validation!.status, "aborted");
  assert.equal(externalOwns(e), false);
  assert.equal(e.current_phase, "blocked");
  assert.equal(e.verification_receipt, undefined);
  assert.equal(e.review_receipt, undefined);
  assert.equal(f.delivery.calls, 0);
});

test("engine selection never initializes implicitly; explicit setup retains its concrete approval", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.validation = {
    engine: "no-mistakes",
    max_runs: 1,
    bin: Id.Executable.make("setup-fixture"),
    home: f.root,
  };
  await run(f.records.saveProject(p));
  const real = f.git.runner,
    calls: string[][] = [];
  let initialized = false;
  f.git.runner = {
    run: (file, args, cwd, env, options) =>
      file !== "setup-fixture"
        ? real.run(file, args, cwd, env, options)
        : Effect.gen(function* () {
            calls.push(args);
            if (args[0] === "--version") return "no-mistakes version v1.84.0 (fixture)";
            if (args.includes("--help"))
              return "--launch-nonce --validation-generation --base-branch --no-publish-intent --skip --wait";
            if (args[0] === "init") {
              initialized = true;
              return "Initialized isolated fixture";
            }
            return initialized
              ? encode({
                  repo: p.path,
                  current_branch: yield* f.git.run(cwd, ["branch", "--show-current"]),
                  daemon: "running",
                })
              : encode({ error: "Repository requires explicit initialization" });
          }),
  };
  f.controller = new Controller(
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  );
  t.onTestFinished(() => run(f.controller.close()));
  let e = await run(applying(f));
  assert.equal(calls.length, 0);
  f.spec.done = true;
  f.runtime.success(e.apply_session_id!);
  await assert.rejects(run(f.controller.advance(e.issue_id)), /no-mistakes/);
  e = await run(f.controller.get(e.issue_id));
  assert.equal(e.current_phase, "blocked");
  assert.ok(e.implementation_head);
  assert.equal(consumesWorker(e), false);
  assert.equal(externalOwns(e), false);
  assert.equal(
    calls.some((a) => a[0] === "init"),
    false,
  );
  const input = {
    issue_id: e.issue_id,
    generation: e.control_generation,
    expected_head: e.implementation_head!,
    action: "setup" as const,
  };
  e = await run(f.controller.validation(input, Id.SessionId.make("ses_supervisor")));
  assert.equal(initialized, false);
  assert.equal(e.validation_setup!.status, "prepared");
  f.runtime.forms.set(e.validation_setup!.form_id, "approved");
  e = await run(f.controller.validation(input, Id.SessionId.make("ses_supervisor")));
  assert.equal(e.validation_setup!.status, "confirmed");
  assert.equal(calls.filter((a) => a[0] === "init").length, 1);
  await run(f.controller.validation(input, Id.SessionId.make("ses_supervisor")));
  assert.equal(calls.filter((a) => a[0] === "init").length, 1);
  assert.equal(e.external_validation, undefined);
});

test("external preflight failure releases its worker reservation before any engine launch", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  p.validation = {
    engine: "no-mistakes",
    max_runs: 1,
    bin: Id.Executable.make("unavailable-engine"),
    home: f.root,
  };
  await run(f.records.saveProject(p));
  const real = f.git.runner;
  let reads = 0;
  f.git.runner = {
    run: (file, args, cwd, env, options) => {
      if (file !== "unavailable-engine") return real.run(file, args, cwd, env, options);
      reads++;
      assert.deepEqual(args, ["--version"]);
      return Effect.fail(new CrewError("COMMAND_FAILED", "Engine version read unavailable"));
    },
  };
  f.controller = new Controller(
    f.config,
    f.records,
    f.work,
    f.spec,
    f.git,
    f.runtime,
    f.delivery,
    f.locks,
  );
  t.onTestFinished(() => run(f.controller.close()));
  let e = await run(applying(f));
  f.spec.done = true;
  f.runtime.success(e.apply_session_id!);
  await assert.rejects(run(f.controller.advance(e.issue_id)), /version read unavailable/);
  e = await run(f.controller.get(e.issue_id));
  assert.equal(reads, 1);
  assert.equal(e.capacity_reservation, undefined);
  assert.equal(e.external_validation, undefined);
  assert.equal(consumesWorker(e), false);
  assert.equal(f.delivery.calls, 0);
});
