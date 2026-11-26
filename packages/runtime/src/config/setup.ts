import { Context } from "effect";
import { Agents } from "@abracode/agents";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  BranchName,
  ExecutionId,
  IssueId,
  LockKey,
  OperationAction,
  OperationId,
  type RepositoryId,
  type SessionId,
} from "@abracode/contracts/identities";
import { Clock, Effect } from "effect";
import { decode } from "../decode.ts";
import {
  CrewError,
  identifier,
  type Config,
  type Project,
  type SetupExecution,
} from "../domain.ts";
import { readFile, retainedEntry } from "../filesystem.ts";
import { type Delivery } from "../git/delivery.ts";
import { type Git } from "../git/repository.ts";
import { type RepositorySources } from "../git/source.ts";
import { type Workspaces } from "../git/workspaces.ts";
import { completedProgress, progress } from "../opencode/progress.ts";
import { type Runtime } from "../opencode/runtime.ts";
import { DiscoverySchema } from "../openspec/adapter.ts";
import { json } from "../process.ts";
import { type Locks } from "../storage/lock.ts";
import { type ExecutionOwnedField, type Records } from "../storage/store.ts";
import { collectForm } from "../workflow/authorization.ts";
import { consumesRetained, unknownCapacity } from "../workflow/capacity.ts";
import { createConfiguredExecution } from "../workflow/execution.ts";
import { observePreflight } from "../workflow/finishing/readiness.ts";
import { inputFingerprint } from "../workflow/operations.ts";
import { OpenSpecConfigSchema, parseYaml } from "./contracts.ts";

interface SetupDependencies {
  readonly catalog: typeof Agents.Service;
  records: Records;
  git: Git;
  delivery: Delivery;
  sources: RepositorySources;
  workspaces: Workspaces;
  runtime: Runtime;
  config: Config;
  locks: Locks;
}

const allowedSetupFiles = new Set([
  "openspec/config.yaml",
  "openspec/changes/archive/.gitkeep",
  "openspec/specs/.gitkeep",
]);

type SetupAction = "prepare" | "deliver" | "approve" | "finish";

// Setup has native resources and delivery checkpoints, but is not a WorkGraph execution.
export class ProjectSetup {
  constructor(private c: SetupDependencies) {}

  private readiness = Effect.fn("ProjectSetup.readiness")(
    { self: this },
    function* (p: Project, e: SetupExecution) {
      for (const session of [
        e.explore_session_id,
        e.apply_session_id,
        e.review_session_id,
        e.research_session_id,
      ]) {
        if (session && (yield* this.c.runtime.session(session)).busy) {
          return yield* new CrewError(
            "WRITER_BUSY",
            "An active or queued writer prevents setup merge",
          );
        }
      }
      const observation = yield* observePreflight(this.c.git, this.c.workspaces, p, e);
      e = { ...e, finishing: { ...e.finishing, schema_version: 1, preflight: observation } };
      e = yield* this.save(e, ["finishing"]);
      if (observation.status !== "ready") {
        return yield* new CrewError(
          "CLEANUP_PREFLIGHT",
          `Setup merge waits for retained-file disposition: ${JSON.stringify(observation.paths)}${observation.truncated ? " (incomplete sample)" : ""}`,
        );
      }
      if (
        !e.worktree_directory ||
        e.archived_tree !== (yield* this.c.git.tree(e.worktree_directory))
      ) {
        return yield* new CrewError("SETUP_CHANGED", "Prepared setup tree changed before merge");
      }
      return e;
    },
  );

  private save = Effect.fn("ProjectSetup.save")(
    { self: this },
    function* (e: SetupExecution, fields: readonly ExecutionOwnedField[]) {
      e = yield* this.c.records.saveSetupOwned(e, fields);
      return e;
    },
  );

  run = Effect.fn("ProjectSetup.run")(
    { self: this },
    function* (id: RepositoryId, action: SetupAction, supervisor: SessionId, initialize: boolean) {
      yield* Effect.try({ try: () => identifier(id), catch: CrewError.from });
      return yield* this.c.locks.with(
        LockKey.make(`setup-${id}`),
        () =>
          this.runInternal(id, action, supervisor, initialize).pipe(
            Effect.tapError((error) => this.recordFailure(id, error.message)),
          ),
        { waitSeconds: 0 },
      );
    },
    completedProgress("setup"),
  );

  private recordFailure(id: RepositoryId, message: string) {
    return Effect.gen({ self: this }, function* () {
      let e = yield* this.c.records.setup(id);
      if (e && e.current_phase !== "completed" && e.current_phase !== "queued") {
        e = { ...e, error_or_recovery_reason: message };
        if (e.operation) e = { ...e, operation: { ...e.operation, status: "uncertain" } };
        yield* this.save(e, ["error_or_recovery_reason", "operation"]);
      }
    });
  }

  reconcileQueued = Effect.fn("ProjectSetup.reconcileQueued")({ self: this }, function* () {
    const queued = (yield* this.c.records.setupScan).values
      .filter((e) => e.current_phase === "queued")
      .sort(
        (a, b) =>
          a.updated_at.localeCompare(b.updated_at) ||
          a.repository_id.localeCompare(b.repository_id),
      );
    for (const request of queued) {
      const id = request.repository_id;
      yield* this.c.locks
        .with(
          LockKey.make(`setup-${id}`),
          () =>
            Effect.gen({ self: this }, function* () {
              const current = yield* this.c.records.setup(id);
              if (
                current?.current_phase !== "queued" ||
                current.execution_id !== request.execution_id ||
                !current.supervisor_session_id
              )
                return;
              yield* this.runInternal(id, "prepare", current.supervisor_session_id, true).pipe(
                Effect.tapError((error) => this.recordFailure(id, error.message)),
              );
            }),
          { waitSeconds: 0 },
        )
        .pipe(
          Effect.catch((error) =>
            error.code === "LOCKED"
              ? Effect.void
              : Effect.logError("AbraCode queued setup", id, error),
          ),
        );
    }
  });

  private admitSetup(
    id: RepositoryId,
    registered: Project,
    waiting: SetupExecution | undefined,
    action: SetupAction,
    supervisor: SessionId,
    initialize: boolean,
  ) {
    return Effect.gen({ self: this }, function* () {
      if (waiting && action !== "prepare") {
        return yield* new CrewError("SETUP_PHASE", "Setup is queued for preparation");
      }
      if (!waiting && !(action === "prepare" && initialize)) {
        return yield* new CrewError(
          "OPENSPEC_AUTHORIZATION",
          "Prepare setup with initialize_openspec:true only when initialization is authorized",
        );
      }
      return yield* this.c.records.withActiveIndex(() =>
        Effect.gen({ self: this }, function* () {
          const scan = yield* this.c.records.capacityRecords();
          if (scan.diagnostics.length) return yield* unknownCapacity();
          const retained = [...scan.executions, ...scan.setups].filter(consumesRetained);
          const reason =
            retained.length >= this.c.config.max_executions
              ? "Waiting for global execution slot capacity"
              : retained.filter((x) => x.repository_id === id).length >= registered.max_executions
                ? "Waiting for repository execution slot capacity"
                : undefined;
          if (waiting) {
            if (reason === waiting.error_or_recovery_reason && reason) return waiting;
            waiting = {
              ...waiting,
              error_or_recovery_reason: reason,
              current_phase: reason ? "queued" : "provisioning",
            };
            return yield* this.save(waiting, ["current_phase", "error_or_recovery_reason"]);
          }
          const executionID = ExecutionId.make(`abra-setup-${randomUUID()}`);
          let setup = yield* createConfiguredExecution(
            registered,
            {
              issue_id: IssueId.make(`setup-${id}`),
              repository_id: id,
              execution_id: executionID,
              workflow_policy: "full-openspec",
              current_phase: reason ? "queued" : "provisioning",
              setup: true,
              branch: BranchName.make(`setup/${executionID}`),
              openspec_change: "",
              supervisor_session_id: supervisor,
            },
            this.c.config,
          ).pipe(
            Effect.updateContext((caller: Context.Context<never>) =>
              Context.merge(Context.make(Agents, this.c.catalog), caller),
            ),
          );
          setup = { ...setup, error_or_recovery_reason: reason };
          setup = yield* this.c.records.create(setup);
          return setup;
        }),
      );
    });
  }

  private prepare(registered: Project, p: Project, e: SetupExecution) {
    return Effect.gen({ self: this }, function* () {
      if (e.current_phase !== "provisioning") return e;
      if (!p.project_id) {
        p = { ...p, project_id: yield* this.c.runtime.project(p.path) };
        yield* this.c.records.saveProject({ ...registered, project_id: p.project_id });
      }
      if (!e.base_commit) {
        const base = yield* this.c.sources.base(p, e.execution_id);
        e = { ...e, base_commit: base.commit, target_branch: base.target_branch };
        e = yield* this.save(e, ["base_commit", "target_branch"]);
      }
      if (
        !e.worktree_directory &&
        (yield* this.c.sources.inspect(p.path, e.base_commit!)).openspec_config !== null
      ) {
        yield* this.c.records.saveProject({
          ...registered,
          project_id: p.project_id,
          openspec: true,
          target_branch: e.target_branch ?? registered.target_branch,
          inspected_commit: e.base_commit,
        });
        e = { ...e, current_phase: "completed" };
        return yield* this.save(e, ["current_phase"]);
      }
      e = yield* this.c.workspaces.provision(p, e, this.save);
      const path = e.worktree_directory;
      const base = e.base_commit;
      if (!path || !base)
        return yield* new CrewError("WORKTREE", "Prepare the setup worktree and base commit first");
      if (!(yield* retainedEntry(join(path, "openspec/config.yaml"), "file"))) {
        yield* this.c.git.runner.run(
          this.c.config.commands.openspec,
          ["init", "--tools", "none", "--no-animation", path],
          path,
        );
      }
      const files = [
        yield* this.c.git.run(path, ["diff", "--name-only", base, "--"]),
        yield* this.c.git.run(path, ["ls-files", "--others", "--exclude-standard"]),
      ].flatMap((output) => output.split("\n").filter(Boolean));
      if (!(files.length > 0 && files.every((name) => allowedSetupFiles.has(name)))) {
        return yield* new CrewError(
          "SETUP_CONTENT",
          `Setup may only initialize OpenSpec configuration and directory placeholders; preserve unexpected files for inspection: ${files.join(", ")}`,
        );
      }
      // Inspect the generated configuration through the real repository-local CLI.
      const config = yield* decode(
        OpenSpecConfigSchema,
        yield* parseYaml(
          yield* readFile(join(path, "openspec/config.yaml"), "utf8"),
          "Generated OpenSpec configuration",
        ),
        "Generated OpenSpec configuration",
      );
      if (!config || typeof config.schema !== "string") {
        return yield* new CrewError(
          "SETUP_CONFIG",
          "Generated OpenSpec configuration must name a schema",
        );
      }
      const schemas = yield* json(
        this.c.git.runner,
        DiscoverySchema,
        this.c.config.commands.openspec,
        ["schemas", "--json"],
        path,
      );
      if (!schemas.some((s) => s.name === config.schema)) {
        return yield* new CrewError(
          "SETUP_SCHEMA",
          "Generated configuration names an unavailable schema",
        );
      }
      yield* this.c.git.run(path, ["add", "--", ...files]);
      e = { ...e, archived_tree: yield* this.c.git.tree(path), current_phase: "planning" };
      return yield* this.save(e, ["archived_tree", "current_phase"]);
    });
  }

  private deliver(p: Project, e: SetupExecution) {
    return Effect.gen({ self: this }, function* () {
      const worktree = e.worktree_directory;
      if (!worktree) return yield* new CrewError("WORKTREE", "Prepare the setup worktree first");
      if (!["planning", "delivering"].includes(e.current_phase)) {
        return yield* new CrewError("SETUP_PHASE", "Setup is not ready for delivery");
      }
      yield* this.c.git.validate(p, e);
      if (
        !e.archived_tree ||
        (yield* this.c.git.tree(worktree)) !== e.archived_tree ||
        (yield* this.c.git.run(worktree, ["diff", "--name-only"])) ||
        (yield* this.c.git.run(worktree, ["ls-files", "--others", "--exclude-standard"]))
      ) {
        return yield* new CrewError(
          "SETUP_CHANGED",
          "Prepared setup content changed; preserve it for inspection",
        );
      }
      e = { ...e, current_phase: "delivering" };
      e = yield* this.save(e, ["current_phase"]);
      const commit = yield* this.c.git.commit(
        worktree,
        e.issue_id,
        `Initialize OpenSpec for ${p.id}`,
      );
      yield* this.c.git.assertCommitTree(worktree, commit, e.archived_tree!);
      const result = yield* this.c.delivery.deliver(p, e, {
        commit,
        destination: { kind: "initial", pr: e.pull_request_reference },
      });
      if (result.commit !== commit) {
        return yield* new CrewError(
          "DELIVERY_CHANGED",
          "Published setup commit differs from the reviewed tree",
        );
      }
      e = {
        ...e,
        delivered_commit: commit,
        pull_request_reference: result.pr,
        current_phase: "awaiting_merge",
      };
      return yield* this.save(e, ["delivered_commit", "pull_request_reference", "current_phase"]);
    });
  }

  private verifyDeliveredWorktree(p: Project, e: SetupExecution) {
    return Effect.gen({ self: this }, function* () {
      const worktree = e.worktree_directory;
      if (!worktree) return yield* new CrewError("WORKTREE", "Prepare the setup worktree first");
      yield* this.c.git.validate(p, e);
      if (
        (yield* this.c.git.head(worktree)) !== e.delivered_commit ||
        (yield* this.c.git.dirty(worktree))
      ) {
        return yield* new CrewError("SETUP_CHANGED", "Delivered setup worktree changed");
      }
    });
  }

  private approve(id: RepositoryId, p: Project, e: SetupExecution, supervisor: SessionId) {
    return Effect.gen({ self: this }, function* () {
      if (!e.worktree_directory) {
        return yield* new CrewError("WORKTREE", "Prepare the setup worktree first");
      }
      if (!["awaiting_merge", "cleaning"].includes(e.current_phase)) {
        return yield* new CrewError("SETUP_PHASE", "Deliver setup before approval or cleanup");
      }
      if (e.current_phase !== "awaiting_merge") return { setup: e };
      yield* this.verifyDeliveredWorktree(p, e);
      if (p.delivery !== "github-pr") {
        return yield* new CrewError(
          "DELIVERY_POLICY",
          "Branch delivery does not require merge approval",
        );
      }
      const pr = yield* this.c.delivery.inspect(p, e);
      if (
        !pr ||
        pr.url !== e.pull_request_reference ||
        pr.headRefOid !== e.delivered_commit ||
        pr.baseRefName !== e.target_branch
      ) {
        return yield* new CrewError("PR_HEAD", "Setup PR identity changed before approval");
      }
      if (!e.delivered_commit) {
        return yield* new CrewError("SETUP_PHASE", "Deliver setup before approval or cleanup");
      }
      const delivered = e.delivered_commit;
      e = yield* this.readiness(p, e);
      const { decision, receipt, execution } = yield* collectForm(
        e,
        this.c.records,
        this.c.runtime,
        { kind: "merge", session_id: supervisor, fingerprint: delivered },
        `Authorize OpenSpec setup merge for ${id}`,
      );
      e = execution;
      if (decision === "pending") {
        return { setup: e, approval_required: true as const, form_id: receipt.form_id };
      }
      if (decision === "rejected") {
        return yield* new CrewError("APPROVAL_REJECTED", "Human rejected the setup merge");
      }
      return { setup: e };
    });
  }

  private finish(registered: Project, p: Project, e: SetupExecution, worktreeVerified = false) {
    return Effect.gen({ self: this }, function* () {
      if (!e.worktree_directory) {
        return yield* new CrewError("WORKTREE", "Prepare the setup worktree first");
      }
      if (!["awaiting_merge", "cleaning"].includes(e.current_phase)) {
        return yield* new CrewError("SETUP_PHASE", "Deliver setup before approval or cleanup");
      }
      if (e.current_phase === "awaiting_merge") {
        if (!worktreeVerified) yield* this.verifyDeliveredWorktree(p, e);
        if (
          p.delivery === "github-pr" &&
          (yield* this.c.delivery.inspect(p, e))?.state !== "MERGED"
        ) {
          if (
            e.merge_approval_required !== false &&
            !e.approval_receipts.some(
              (a) => a.fingerprint === e.delivered_commit && a.authorized_at,
            )
          ) {
            return yield* new CrewError(
              "MERGE_APPROVAL",
              "Human authorization is required before setup merge",
            );
          }
          e = yield* this.readiness(p, e);
          const result = yield* this.c.delivery.merge(p, e, undefined, () =>
            this.readiness(p, e).pipe(
              Effect.map((saved) => {
                e = saved;
              }),
            ),
          );
          if (result.category !== "completed") {
            e = { ...e, error_or_recovery_reason: result.reason };
            return yield* this.save(e, ["error_or_recovery_reason"]);
          }
        }
        e = {
          ...e,
          delivery_receipt: yield* this.c.delivery.evidence(p, e),
          current_phase: "cleaning",
        };
        e = yield* this.save(e, ["delivery_receipt", "current_phase"]);
      }
      const { execution, blocker } = yield* this.c.workspaces.retire(p, e, this.save);
      e = execution;
      if (blocker) {
        return yield* new CrewError(
          blocker.paths.some((path) => path.category === "untracked")
            ? "DIRTY_WORKTREE"
            : "IGNORED_WORK",
          `Setup cleanup blocked; preserve retained paths ${JSON.stringify(blocker.paths).slice(0, 4096)}${blocker.truncated ? " (truncated sample)" : ""} before retrying setup finish`,
        );
      }
      // A preserved branch alone does not make the default branch ready for normal work.
      const base = yield* this.c.sources.fetch(
        p.path,
        registered.branch_policy === "default" ? undefined : registered.target_branch,
      );
      const inspection = yield* this.c.sources.inspect(p.path, base.commit);
      yield* this.c.records.saveProject({
        ...registered,
        project_id: p.project_id,
        openspec: inspection.openspec_config !== null,
        target_branch: base.target_branch,
        inspected_commit: base.commit,
      });
      e = { ...e, current_phase: "completed" };
      return yield* this.save(e, ["current_phase"]);
    });
  }

  private runInternal = Effect.fn("ProjectSetup.runInternal")(
    { self: this },
    function* (id: RepositoryId, action: SetupAction, supervisor: SessionId, initialize: boolean) {
      const registered = yield* this.c.records.project(id);
      if (!registered) {
        return yield* new CrewError("PROJECT_MISSING", "Repository is not registered");
      }
      let e: SetupExecution | undefined = yield* this.c.records.setup(id);
      if (e && e.delivery_policy !== registered.delivery) {
        return yield* new CrewError(
          "POLICY_DRIFT",
          "Setup delivery policy changed; preserve resources and repair",
        );
      }
      if (!e || e.current_phase === "queued") {
        e = yield* this.admitSetup(id, registered, e, action, supervisor, initialize);
      }
      if (e.current_phase === "queued" || e.current_phase === "completed") return e;
      const p = { ...registered, target_branch: e.target_branch ?? registered.target_branch };
      const operation = {
        id: OperationId.make(`op-${randomUUID()}`),
        action: OperationAction.make(`setup-${action}`),
        status: "prepared" as const,
        generation: e.control_generation,
        fingerprint: inputFingerprint(e),
        expected: `Reconcile setup ${action} against retained native branch/worktree and delivery identities`,
        started_at: yield* Clock.currentTimeMillis,
      };
      e = yield* this.c.records.beginOperation(e, operation);
      yield* progress({ stage: "setup", status: "started" });
      switch (action) {
        case "prepare":
          return yield* this.prepare(registered, p, e);
        case "deliver":
          return yield* this.deliver(p, e);
        case "approve": {
          const approval = yield* this.approve(id, p, e, supervisor);
          if (approval.approval_required) return approval;
          return yield* this.finish(registered, p, approval.setup, true);
        }
        case "finish":
          return yield* this.finish(registered, p, e, false);
      }
    },
  );
}
