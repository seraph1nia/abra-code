import { sha256 } from "../digest.ts";
import { tryDomainValue } from "../effect.ts";
import { remoteIdentity } from "../git/source.ts";
import { decode as decodeToon } from "@toon-format/toon";
import { homedir } from "node:os";
import { join } from "node:path";
import { Config, Effect, Schema } from "effect";
import { AbsolutePath, Executable, GitRemote } from "@abracode/contracts/identities";
import { Count, NonEmpty } from "@abracode/contracts/primitives";
import { CrewError, type Execution, type Project } from "../domain.ts";
import { decode } from "../decode.ts";
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
} from "@abracode/contracts/validation/contracts";

export const intentDigest = (intent: string) => sha256(intent);
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
  settings = Effect.fn("NoMistakes.settings")(function* (e: Execution) {
    if (e.external_validation && e.external_validation.custody !== "returned")
      return {
        bin: e.external_validation.preflight.bin,
        home: e.external_validation.preflight.home,
      };
    const config = e.effective_policy.validation;
    return {
      bin: config?.bin ?? Executable.make("no-mistakes"),
      home:
        config?.home ??
        (yield* Config.String("NM_HOME").pipe(
          Config.withDefault(join(homedir(), ".no-mistakes")),
          Effect.mapError(CrewError.from),
          Effect.flatMap((value) => decode(AbsolutePath, value, "External runtime home")),
        )),
    };
  });
  private call(e: Execution, args: string[], boundedWait = false) {
    return Effect.gen({ self: this }, function* () {
      if (!e.worktree_directory)
        return yield* new CrewError("WORKTREE", "External validation requires an owned worktree");
      const config = yield* this.settings(e);
      return yield* this.runner.run(
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
    });
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
    { self: this },
    function* (p: Project, e: Execution) {
      const config = yield* this.settings(e);
      const [version, help, homeOutput] = yield* Effect.all(
        [
          this.call(e, ["--version"]),
          this.call(e, ["axi", "run", "--help"]),
          this.call(e, ["axi"]),
        ],
        { concurrency: "unbounded" },
      );
      if (
        !(
          /^no-mistakes version v?1\.84\.0(?:\s|$)/.test(version.trim()) ||
          /^no-mistakes v?1\.84\.0(?:\s|$)/.test(version.trim())
        )
      )
        return yield* new CrewError(
          "EXTERNAL_VERSION",
          "Only no-mistakes v1.84.0 has a supported contract",
        );
      for (const flag of [
        "--launch-nonce",
        "--validation-generation",
        "--base-branch",
        "--no-publish-intent",
        "--skip",
        "--wait",
      ])
        if (!help.includes(flag))
          return yield* new CrewError(
            "EXTERNAL_FEATURE",
            "Required no-mistakes launch feature is unavailable",
          );
      const home = yield* machineDocument(Home, homeOutput);
      if (home.daemon !== "running")
        return yield* new CrewError(
          "EXTERNAL_DAEMON",
          "External daemon is stopped; selection never starts or restarts it",
        );
      if (![p.path, e.worktree_directory].includes(home.repo) || home.current_branch !== e.branch)
        return yield* new CrewError(
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
        if (!(Buffer.byteLength(text) <= 65536))
          return yield* new CrewError(
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
    },
  );
  start(e: Execution, r: ExternalRecord) {
    if (!e.target_branch)
      return Effect.fail(
        new CrewError("EXTERNAL_TARGET", "External validation requires a target branch"),
      );
    return this.document(
      e,
      [
        "axi",
        "run",
        "--intent",
        r.intent,
        "--base-branch",
        e.target_branch,
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
  respond(
    e: Execution,
    response: typeof import("@abracode/contracts/validation/contracts").ExternalResponse.Type,
  ) {
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
    { self: this },
    function* (e: Execution, apply = false, expectedRemote?: GitRemote) {
      const observed = yield* this.call(e, ["axi", "sync", "--check"]).pipe(
        Effect.flatMap((out) => machineDocument(Schema.Struct({ branch_sync: BranchSync }), out)),
      );
      if (!apply) return observed.branch_sync;
      const r = e.external_validation,
        sync = observed.branch_sync;
      if (
        !r?.launch ||
        sync.pipeline.run !== r.launch.run_id ||
        sync.pipeline.submitted_head !== r.submitted_head ||
        sync.local.branch !== r.branch
      )
        return yield* new CrewError(
          "EXTERNAL_IDENTITY",
          "Offered custody action belongs to another run or branch",
        );
      if (
        !expectedRemote ||
        !sync.target.url ||
        (sync.target.ref && sync.target.ref !== `refs/heads/${e.branch}`) ||
        sync.pipeline.pushed_head
      )
        return yield* new CrewError(
          "EXTERNAL_TARGET",
          "External synchronization target differs from controller-owned unpublished delivery",
        );
      const targetRemote = yield* decode(
        GitRemote,
        sync.target.url,
        "External synchronization target remote",
      );
      if (
        (yield* tryDomainValue(remoteIdentity, targetRemote, e.worktree_directory)) !==
        (yield* tryDomainValue(remoteIdentity, expectedRemote, e.worktree_directory))
      )
        return yield* new CrewError(
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
      if (!args || offered.command !== `no-mistakes ${args.join(" ")}`)
        return yield* new CrewError(
          "EXTERNAL_SYNC",
          "Custody action needs explicit manual recovery; no substitute command is safe",
        );
      return (yield* this.call(e, [...args]).pipe(
        Effect.flatMap((out) => machineDocument(Schema.Struct({ branch_sync: BranchSync }), out)),
      )).branch_sync;
    },
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
