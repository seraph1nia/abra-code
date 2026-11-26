import { sha256 } from "../digest.ts";
import { tryDomainValue } from "../effect.ts";
import { ConfigurationError } from "../errors.ts";
import { validateDispatch } from "./dispatch.ts";
import { diagnosticText } from "../opencode/diagnostics.ts";
import { declarationDigest, saveDeclaration, saveDeclarationOutcome } from "./declarations.ts";
import { type Config } from "../domain.ts";
import { registrationPolicy } from "./policy.ts";
import {
  Executable,
  LockKey,
  AbsolutePath,
  BranchName,
  RepositoryId,
} from "@abracode/contracts/identities";

import { type Locks } from "../storage/lock.ts";
import { Effect } from "effect";
import { retainedEntry, readFile, readdirIfPresent } from "../filesystem.ts";
import { join } from "node:path";
import { CrewError, identifier, type Project, type OnboardInput } from "../domain.ts";
import { type Records } from "../storage/store.ts";
import { Git } from "../git/repository.ts";
import { type Runner } from "../process.ts";
import { decode, decodeJSON } from "../decode.ts";
import { PackageSchema, ProjectInputSchema, VerificationSchema } from "./contracts.ts";
import { RepositorySources, remoteIdentity } from "../git/source.ts";
const exists = (p: string) => retainedEntry(p, "file");
export class Onboarding {
  constructor(
    private records: Records,
    private git: Git,
    private runner: Runner,
    private openspec: Executable,
    private repositoryRoot?: AbsolutePath,
    private locks?: Locks,
    private config?: Config,
  ) {}
  private owned<A>(
    id: RepositoryId,
    action: () => Effect.Effect<A, import("../domain.ts").CrewError>,
  ) {
    return Effect.gen({ self: this }, function* () {
      if (!this.locks) return yield* action();
      const validId = yield* Effect.try({
        try: () => identifier(id),
        catch: CrewError.from,
      });
      return yield* this.locks.with(
        LockKey.make(`registration-${sha256(validId).slice(0, 40)}`),
        action,
        { waitSeconds: 0 },
      );
    });
  }
  inspect = (input: OnboardInput) => this.owned(input.id, () => this.inspectOwned(input));
  private inspectOwned = Effect.fn("Onboarding.inspect")(
    { self: this },
    function* (input: OnboardInput) {
      input = yield* decode(ProjectInputSchema, input, "Repository registration");
      yield* tryDomainValue(validateDispatch, this.config ?? {}, input.dispatch);
      yield* tryDomainValue(identifier, input.id);
      const previous = yield* this.records.project(input.id);
      if (previous && input.remote) {
        if (
          (yield* tryDomainValue(remoteIdentity, previous.remote, previous.path)) !==
          (yield* tryDomainValue(remoteIdentity, input.remote, input.path ?? previous.path))
        )
          return yield* new ConfigurationError(
            "PROJECT_REBIND",
            "Stable repository IDs cannot be rebound",
          );
      }
      const managed = input.managed ?? previous?.managed ?? !input.path;
      if (managed && previous && !(yield* retainedEntry(previous.path, "directory"))) {
        const active = (yield* this.records.executions).some(
          (e) => e.repository_id === input.id && e.current_phase !== "completed",
        );
        const setup = yield* this.records.setup(input.id);
        if (active || (setup && setup.current_phase !== "completed"))
          return yield* new ConfigurationError(
            "CACHE_MISSING",
            "Managed clone is missing while work owns resources; preserve worktrees and repair the cache",
          );
      }
      const root = this.repositoryRoot ?? input.path ?? previous?.path;
      if (!root) return yield* new ConfigurationError("CONFIG", "Repository root is required");
      const sources = new RepositorySources(this.git, root);
      const identity = yield* Effect.gen({ self: this }, function* () {
        if (managed) {
          if (!this.repositoryRoot)
            return yield* new ConfigurationError("CONFIG", "Managed repository root is required");
          const remote = input.remote ?? previous?.remote;
          if (!remote)
            return yield* new ConfigurationError("REMOTE", "Managed repository remote is required");
          return yield* sources.clone(input.id, remote);
        }
        const path = input.path ?? previous?.path;
        if (!path) return yield* new ConfigurationError("CONFIG", "Repository path is required");
        return yield* this.git.identity(path);
      });
      const branchPolicy =
        input.branch_policy ??
        (input.target_branch !== undefined
          ? "fixed"
          : (previous?.branch_policy ?? (managed ? "default" : "fixed")));
      const base = managed
        ? yield* sources.fetch(
            identity.path,
            branchPolicy === "default"
              ? undefined
              : (input.target_branch ?? previous?.target_branch),
          )
        : {
            target_branch:
              input.target_branch ??
              previous?.target_branch ??
              (yield* this.git
                .run(identity.path, ["branch", "--show-current"])
                .pipe(
                  Effect.flatMap((current) =>
                    decode(BranchName, current, "Current Git branch").pipe(
                      Effect.mapError(
                        () =>
                          new ConfigurationError(
                            "BRANCH",
                            "Repository is in detached HEAD state; check out a branch or specify target_branch",
                          ),
                      ),
                    ),
                  ),
                )),
            commit: yield* this.git.head(identity.path),
          };
      const branch = base.target_branch;
      yield* this.git.run(identity.path, ["check-ref-format", `refs/heads/${branch}`]);
      const snapshot = managed ? yield* sources.inspect(identity.path, base.commit) : undefined;
      if (input.remote) {
        if (
          (yield* tryDomainValue(remoteIdentity, input.remote, identity.path)) !==
          (yield* tryDomainValue(remoteIdentity, identity.remote, identity.path))
        )
          return yield* new ConfigurationError(
            "REMOTE_MISMATCH",
            "Configured remote does not match origin",
          );
      }
      const openspec = snapshot
        ? snapshot.openspec_config !== null
        : yield* exists(join(identity.path, "openspec/config.yaml"));
      const detected: string[][] = [];
      if (!snapshot && (yield* exists(join(identity.path, "package.json")))) {
        const pkg = yield* decodeJSON(
          PackageSchema,
          yield* readFile(join(identity.path, "package.json"), "utf8"),
          "Repository package.json",
        );
        const manager = (yield* exists(join(identity.path, "pnpm-lock.yaml")))
          ? "pnpm"
          : (yield* exists(join(identity.path, "yarn.lock")))
            ? "yarn"
            : "npm";
        for (const command of ["test", "lint", "typecheck", "check", "build"])
          if (pkg.scripts?.[command]) detected.push([manager, "run", command]);
      }
      const p: Project = {
        schema_version: 1,
        revision: previous?.revision ?? 1,
        ...identity,
        id: input.id,
        project_id: previous?.project_id,
        target_branch: branch,
        branch_policy: branchPolicy,
        managed,
        inspected_commit: base.commit,
        openspec,
        verification:
          input.verification ?? previous?.verification ?? snapshot?.verification ?? detected,
        max_workers: input.max_workers ?? previous?.max_workers ?? 1,
        max_executions:
          input.max_executions ??
          previous?.max_executions ??
          input.max_workers ??
          previous?.max_workers ??
          1,
        ...registrationPolicy(input, previous),
        publication: input.publication ?? previous?.publication,
        reviewers: input.reviewers ?? previous?.reviewers,
        discussion: input.discussion ?? previous?.discussion,
        ci_retry: input.ci_retry ?? previous?.ci_retry,
        validation: input.validation ?? previous?.validation,
        merge_approval: input.merge_approval ?? previous?.merge_approval ?? true,
        delivery: input.delivery ?? previous?.delivery ?? "github-pr",
        dispatch: input.dispatch ?? previous?.dispatch,
        diagnostic_turns: input.diagnostic_turns ?? previous?.diagnostic_turns ?? 1,
        repair_rounds: input.repair_rounds ?? previous?.repair_rounds ?? 0,
        generated_paths: input.generated_paths ?? previous?.generated_paths ?? [],
        merge_method: input.merge_method ?? previous?.merge_method ?? "merge",
        allow_no_checks: input.allow_no_checks ?? previous?.allow_no_checks ?? false,
      };
      if (!(Number.isInteger(p.max_workers) && p.max_workers > 0))
        return yield* new ConfigurationError("CAPACITY", "max_workers must be positive");
      if (!["github-pr", "branch"].includes(p.delivery))
        return yield* new ConfigurationError("DELIVERY_POLICY", "Unknown delivery policy");
      p.verification = yield* decode(
        VerificationSchema,
        p.verification,
        "Repository verification commands",
      );
      const skills =
        snapshot?.skills ?? (yield* readdirIfPresent(join(identity.path, ".agents/skills")));
      const instructions = snapshot?.agents_md ?? (yield* exists(join(identity.path, "AGENTS.md")));
      return {
        project: p,
        inspection: {
          commit: base.commit,
          agents_md_content:
            snapshot?.agents_md_content ??
            (instructions ? yield* readFile(join(identity.path, "AGENTS.md"), "utf8") : null),
          agents_md: instructions,
          skills,
          openspec_config: snapshot
            ? snapshot.openspec_config
            : openspec
              ? yield* readFile(join(identity.path, "openspec/config.yaml"), "utf8")
              : null,
        },
        setup_blockers: [
          ...(!openspec ? ["OpenSpec configuration is missing; use abra_project_setup"] : []),
          ...(!p.verification.length
            ? ["Verification commands are missing; register selected verification commands"]
            : []),
        ],
        proposal: {
          initialize_openspec: !openspec,
          verification: p.verification,
          preserve_existing_instructions: true,
        },
      };
    },
  );
  register = (input: OnboardInput, initialize: boolean) =>
    Effect.gen({ self: this }, function* () {
      const existing = yield* this.records.project(input.id);
      if (
        existing &&
        input.remote &&
        (yield* tryDomainValue(remoteIdentity, input.remote, input.path ?? existing.path)) !==
          (yield* tryDomainValue(remoteIdentity, existing.remote, existing.path))
      )
        return yield* new ConfigurationError(
          "PROJECT_REBIND",
          "Stable repository IDs cannot be rebound",
        );
      if (existing && input.path && input.path !== existing.path)
        return yield* new ConfigurationError(
          "PROJECT_REBIND",
          "Stable repository IDs cannot be rebound to another checkout",
        );
      const declaration =
        this.config && this.locks ? yield* saveDeclaration(this.config, input, this.locks) : input;
      const digest = declarationDigest(declaration);
      if (this.config)
        yield* saveDeclarationOutcome(this.records, {
          id: input.id,
          digest,
          status: "declared/pending",
        });
      return yield* this.owned(input.id, () => this.registerOwned(declaration, initialize)).pipe(
        Effect.tap((report) =>
          this.config
            ? saveDeclarationOutcome(this.records, {
                id: input.id,
                digest,
                status:
                  report.project.openspec && report.project.verification.length
                    ? "registered/ready"
                    : "registered/setup-blocked",
              })
            : Effect.void,
        ),
        Effect.catch((error) =>
          this.config
            ? saveDeclarationOutcome(this.records, {
                id: input.id,
                digest,
                status: "apply-failed",
                error: error.message.slice(0, 1024),
              }).pipe(
                Effect.andThen(
                  Effect.fail(
                    new ConfigurationError(
                      "CONFIG_SAVED_PENDING",
                      `Declaration saved; registration is pending: ${error.code}: ${diagnosticText(error.message, 512)}. Inspect config status and retry.`,
                    ),
                  ),
                ),
              )
            : Effect.fail(error),
        ),
      );
    });
  private registerOwned = Effect.fn("Onboarding.register")(
    { self: this },
    function* (input: OnboardInput, initialize: boolean) {
      if ((yield* this.records.diagnostics).length !== 0)
        return yield* new ConfigurationError(
          "RECORD_UNAVAILABLE",
          "Unavailable durable records require inspection before registry mutation",
        );
      let report = yield* this.inspectOwned(input);
      if (!report.project.openspec && initialize && !report.project.managed) {
        yield* this.runner.run(
          this.openspec,
          ["init", "--tools", "none", "--no-animation", report.project.path],
          report.project.path,
        );
        report = yield* this.inspectOwned(input);
      }
      return yield* this.records.coordinateCommit(() =>
        Effect.gen({ self: this }, function* () {
          if ((yield* this.records.diagnostics).length !== 0)
            return yield* new ConfigurationError(
              "RECORD_UNAVAILABLE",
              "Unavailable records require inspection before registry mutation",
            );
          const existing = yield* this.records.projects;
          if (
            yield* tryDomainValue(() =>
              existing.some(
                (p) =>
                  p.id !== input.id &&
                  (p.git_common_dir === report.project.git_common_dir ||
                    remoteIdentity(p.remote, p.path) ===
                      remoteIdentity(report.project.remote, report.project.path)),
              ),
            )
          )
            return yield* new ConfigurationError(
              "DUPLICATE_PROJECT",
              "This Git repository is already registered",
            );
          const previous = existing.find((p) => p.id === input.id);
          if (previous && previous.path !== report.project.path)
            return yield* new ConfigurationError(
              "PROJECT_REBIND",
              "Stable repository IDs cannot be rebound",
            );
          if (this.config) report.project.declaration_digest = declarationDigest(input);
          yield* this.records.saveProject(report.project);
          return report;
        }),
      );
    },
  );
}
