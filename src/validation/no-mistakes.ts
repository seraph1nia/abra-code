import { remoteIdentity } from "../git/source.ts";
import { decode as decodeToon } from "@toon-format/toon";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { AbsolutePath, Executable, GitRemote } from "../identities.ts";
import { Count, NonEmpty } from "../contracts.ts";
import { CrewError, ensure, type Execution, type Project } from "../domain.ts";
import { decode } from "../decode.ts";
import { domainEffect } from "../effect.ts";
import { pathExists, readFile } from "../filesystem.ts";
import { parseYaml } from "../config/contracts.ts";
import { type Runner } from "../process.ts";
import {
  ExternalDocument,
  EnginePreflight,
  ExternalStep,
  SkippedSteps,
  BranchSync,
  type ExternalRecord,
} from "./contracts.ts";

export const intentDigest = (intent: string) => createHash("sha256").update(intent).digest("hex");
export function machineDocument<S extends Schema.Constraint>(schema: S, output: string) {
  return Effect.try({
    try: () => decodeToon(output, { strict: true }),
    catch: () => new CrewError("EXTERNAL_PROTOCOL", "Malformed no-mistakes TOON document"),
  }).pipe(Effect.flatMap((data) => decode(schema, data, "no-mistakes v1.84.0")));
}
const Home = Schema.Struct({
  repo: AbsolutePath,
  current_branch: NonEmpty,
  daemon: Schema.Literals(["running", "stopped"]),
  error: Schema.optional(Schema.String),
});
const fixes = Schema.Struct({
  auto_fix: Schema.optional(
    Schema.Struct({
      lint: Schema.optional(Count),
      test: Schema.optional(Count),
      review: Schema.optional(Count),
      document: Schema.optional(Count),
      ci: Schema.optional(Count),
      babysit: Schema.optional(Count),
      rebase: Schema.optional(Count),
    }),
  ),
});
/** Pinned public CLI only. Output commands are compared to an allowlist and never evaluated as shell. */
export class NoMistakes {
  constructor(private runner: Runner) {}
  settings(e: Execution) {
    if (e.external_validation && e.external_validation.custody !== "returned")
      return {
        bin: e.external_validation.preflight.bin,
        home: e.external_validation.preflight.home,
      };
    const config = e.effective_policy.validation;
    return {
      bin: config?.bin ?? Executable.make("no-mistakes"),
      home:
        config?.home ?? AbsolutePath.make(process.env.NM_HOME ?? join(homedir(), ".no-mistakes")),
    };
  }
  private call(e: Execution, args: string[], boundedWait = false) {
    ensure(e.worktree_directory, "WORKTREE", "External validation requires an owned worktree");
    const config = this.settings(e);
    return this.runner.run(
      config.bin,
      args,
      e.worktree_directory,
      { NM_HOME: config.home },
      {
        deadline_ms: boundedWait ? 45000 : 15000,
        max_output_bytes: 512 * 1024,
        allowed_exit_codes: args[0] === "axi" ? [1, 2] : undefined,
        trim: false,
      },
    );
  }
  private document(e: Execution, args: string[], boundedWait = false) {
    return this.call(e, args, boundedWait).pipe(
      Effect.flatMap((output) => machineDocument(ExternalDocument, output)),
      Effect.filterOrFail(
        (doc) => !doc.error,
        (doc) => new CrewError("EXTERNAL_ERROR", doc.error!),
      ),
    );
  }
  preflight = Effect.fn("NoMistakes.preflight")(
    function* (this: NoMistakes, p: Project, e: Execution) {
      const config = this.settings(e);
      const version = yield* this.call(e, ["--version"]);
      ensure(
        /^no-mistakes version v?1\.84\.0(?:\s|$)/.test(version.trim()) ||
          /^no-mistakes v?1\.84\.0(?:\s|$)/.test(version.trim()),
        "EXTERNAL_VERSION",
        "Only no-mistakes v1.84.0 has a supported contract",
      );
      const help = yield* this.call(e, ["axi", "run", "--help"]);
      for (const flag of [
        "--launch-nonce",
        "--validation-generation",
        "--base-branch",
        "--no-publish-intent",
        "--skip",
        "--wait",
      ])
        ensure(
          help.includes(flag),
          "EXTERNAL_FEATURE",
          "Required no-mistakes launch feature is unavailable",
        );
      const home = yield* this.call(e, ["axi"]).pipe(
        Effect.flatMap((out) => machineDocument(Home, out)),
      );
      ensure(
        home.daemon === "running",
        "EXTERNAL_DAEMON",
        "External daemon is stopped; selection never starts or restarts it",
      );
      ensure(
        [p.path, e.worktree_directory].includes(home.repo) && home.current_branch === e.branch,
        "EXTERNAL_REPOSITORY",
        "Engine repository or branch identity differs from the owned worktree",
      );
      const limits: Record<typeof ExternalStep.Type, number> = {
        intent: 0,
        rebase: 3,
        review: 0,
        test: 3,
        document: 3,
        lint: 3,
        push: 0,
        pr: 0,
        ci: 3,
      };
      const content: string[] = [];
      for (const path of [
        join(config.home, "config.yaml"),
        join(e.worktree_directory!, ".no-mistakes.yaml"),
      ]) {
        if (!(yield* pathExists(path))) continue;
        const text = yield* readFile(path, "utf8");
        ensure(
          Buffer.byteLength(text) <= 65536,
          "EXTERNAL_CONFIG",
          "External configuration exceeds bounded preflight size",
        );
        content.push(text);
        const parsed = yield* parseYaml(text, "External configuration").pipe(
          Effect.flatMap((raw) => decode(fixes, raw, "External finite fix limits")),
        );
        const overrides = parsed.auto_fix;
        if (overrides)
          for (const step of ["lint", "test", "review", "document", "ci", "rebase"] as const) {
            const n = overrides[step] ?? (step === "ci" ? overrides.babysit : undefined);
            if (n !== undefined) limits[step] = n;
          }
      }
      return yield* decode(
        EnginePreflight,
        {
          schema_version: 1,
          version: "1.84.0",
          ...config,
          fix_limits: limits,
          config_digest: intentDigest(JSON.stringify(content)),
        },
        "External preflight",
      );
    }.bind(this),
    domainEffect,
  );
  start(e: Execution, r: ExternalRecord) {
    return this.document(
      e,
      [
        "axi",
        "run",
        "--intent",
        r.intent,
        "--base-branch",
        e.target_branch!,
        "--skip",
        SkippedSteps.join(","),
        "--no-publish-intent",
        "--launch-nonce",
        r.nonce,
        "--validation-generation",
        r.validation_generation,
        "--wait",
        "30s",
      ],
      true,
    );
  }
  status(e: Execution, run?: string) {
    return this.document(e, ["axi", "status", ...(run ? ["--run", run] : [])]);
  }
  respond(e: Execution, response: typeof import("./contracts.ts").ExternalResponse.Type) {
    return this.document(
      e,
      [
        "axi",
        "respond",
        "--action",
        response.action,
        "--step",
        response.step,
        ...(response.findings.length ? ["--findings", response.findings.join(",")] : []),
        ...(response.instructions ? ["--instructions", response.instructions] : []),
        "--wait",
        "30s",
      ],
      true,
    );
  }
  sync = Effect.fn("NoMistakes.sync")(
    function* (this: NoMistakes, e: Execution, apply = false, expectedRemote?: GitRemote) {
      const observed = yield* this.call(e, ["axi", "sync", "--check"]).pipe(
        Effect.flatMap((out) => machineDocument(Schema.Struct({ branch_sync: BranchSync }), out)),
      );
      if (!apply) return observed.branch_sync;
      const r = e.external_validation,
        sync = observed.branch_sync;
      ensure(
        r?.launch &&
          sync.pipeline.run === r.launch.run_id &&
          sync.pipeline.submitted_head === r.submitted_head &&
          sync.local.branch === r.branch,
        "EXTERNAL_IDENTITY",
        "Offered custody action belongs to another run or branch",
      );
      ensure(
        expectedRemote &&
          sync.target.url &&
          remoteIdentity(GitRemote.make(sync.target.url), e.worktree_directory) ===
            remoteIdentity(expectedRemote, e.worktree_directory) &&
          (!sync.target.ref || sync.target.ref === `refs/heads/${e.branch}`) &&
          !sync.pipeline.pushed_head,
        "EXTERNAL_TARGET",
        "External synchronization target differs from controller-owned unpublished delivery",
      );
      if (!sync.next_action) return sync;
      const offered = sync.next_action;
      const allowed: Record<string, readonly string[]> = {
        sync: ["axi", "sync"],
        recover_custody: ["axi", "sync", "--recover"],
        adopt_published: ["axi", "sync", "--adopt-published"],
      };
      const args = allowed[offered.code];
      ensure(
        args && offered.command === `no-mistakes ${args.join(" ")}`,
        "EXTERNAL_SYNC",
        "Custody action needs explicit manual recovery; no substitute command is safe",
      );
      return (yield* this.call(e, [...args]).pipe(
        Effect.flatMap((out) => machineDocument(Schema.Struct({ branch_sync: BranchSync }), out)),
      )).branch_sync;
    }.bind(this),
    domainEffect,
  );
  abort(e: Execution, run: string) {
    return this.call(e, ["axi", "abort", "--run", run]).pipe(
      Effect.flatMap((out) =>
        machineDocument(Schema.Struct({ aborted: Schema.Boolean, run: NonEmpty }), out),
      ),
    );
  }
  setup(e: Execution) {
    return this.call(e, ["init"]);
  }
}
