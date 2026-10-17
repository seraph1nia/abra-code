import { progress, completedProgress } from "../opencode/progress.ts";
import { OperationAction } from "../identities.ts";
import {
  LockKey,
  OperationId,
  IssueId,
  ExecutionId,
  BranchName,
  timestamp,
  RepositoryId,
  SessionId,
} from "../identities.ts";

import { createExecution } from "../workflow/execution.ts";

import { Clock, Effect } from "effect";
import { inputFingerprint } from "../workflow/operations.ts";
import { observePreflight } from "../workflow/finishing-readiness.ts";
import { domainEffect } from "../effect.ts";

import { randomUUID } from "node:crypto";
import { access, readFile } from "../filesystem.ts";
import { join } from "node:path";
import { Form } from "@opencode/schema/form";
import { decode } from "../decode.ts";
import { json } from "../process.ts";
import { DiscoverySchema } from "../openspec/adapter.ts";
import { OpenSpecConfigSchema, parseYaml } from "./contracts.ts";
import { CrewError, identifier, type SetupExecution, type Config } from "../domain.ts";
import { type Records } from "../storage/store.ts";
import { type Git } from "../git/repository.ts";
import { type Delivery } from "../git/delivery.ts";
import { type RepositorySources } from "../git/source.ts";
import { type Workspaces } from "../git/workspaces.ts";
import { type Runtime } from "../opencode/runtime.ts";
import { type Locks } from "../storage/lock.ts";

interface SetupDependencies {
  records: Records;
  git: Git;
  delivery: Delivery;
  sources: RepositorySources;
  workspaces: Workspaces;
  runtime: Runtime;
  config: Config;
  locks: Locks;
}
// Setup has native resources and delivery checkpoints, but is not a WorkGraph execution.
export class ProjectSetup {
  constructor(private c: SetupDependencies) {}
  private readiness = Effect.fn("ProjectSetup.readiness")(
    function* (this: ProjectSetup, p: import("../domain.ts").Project, e: SetupExecution) {
      for (const session of [
        e.explore_session_id,
        e.apply_session_id,
        e.review_session_id,
        e.research_session_id,
      ])
        if (session && (yield* this.c.runtime.session(session)).busy)
          return yield* new CrewError(
            "WRITER_BUSY",
            "An active or queued writer prevents setup merge",
          );
      const observation = yield* observePreflight(this.c.git, this.c.workspaces, p, e);
      e.finishing = { ...e.finishing, schema_version: 1, preflight: observation };
      yield* this.save(e);
      if (observation.status !== "ready")
        return yield* new CrewError(
          "CLEANUP_PREFLIGHT",
          `Setup merge waits for retained-file disposition: ${JSON.stringify(observation.paths)}${observation.truncated ? " (incomplete sample)" : ""}`,
        );
      if (e.archived_tree !== (yield* this.c.git.tree(e.worktree_directory!)))
        return yield* new CrewError("SETUP_CHANGED", "Prepared setup tree changed before merge");
    }.bind(this),
    domainEffect,
  );
  private save = Effect.fn("ProjectSetup.save")(
    function* (this: ProjectSetup, e: SetupExecution) {
      e.updated_at = yield* timestamp;
      yield* this.c.records.saveSetup(e);
      return e;
    }.bind(this),
    domainEffect,
  );
  run = Effect.fn("ProjectSetup.run")(
    function* (
      this: ProjectSetup,
      id: RepositoryId,
      action: "prepare" | "deliver" | "approve" | "finish",
      supervisor: SessionId,
      initialize: boolean,
    ) {
      identifier(id);
      return yield* this.c.locks
        .with(
          LockKey.make(`setup-${id}`),
          () => this.runInternal(id, action, supervisor, initialize),
          { waitSeconds: 0 },
        )
        .pipe(
          Effect.tapError((error) =>
            Effect.gen({ self: this }, function* () {
              const e = yield* this.c.records.setup(id);
              if (e && e.current_phase !== "completed") {
                e.error_or_recovery_reason = error.message;
                if (e.operation) e.operation = { ...e.operation, status: "uncertain" };
                yield* this.save(e);
              }
            }),
          ),
        );
    }.bind(this),
    completedProgress("setup"),
  );
  private runInternal = Effect.fn("ProjectSetup.runInternal")(
    function* (
      this: ProjectSetup,
      id: RepositoryId,
      action: "prepare" | "deliver" | "approve" | "finish",
      supervisor: SessionId,
      initialize: boolean,
    ) {
      const registered = yield* this.c.records.project(id);
      if (!registered)
        return yield* new CrewError("PROJECT_MISSING", "Repository is not registered");
      let e: SetupExecution | undefined = yield* this.c.records.setup(id);
      if (!e) {
        if (!(action === "prepare" && initialize))
          return yield* new CrewError(
            "OPENSPEC_AUTHORIZATION",
            "Prepare setup with initialize_openspec:true only when initialization is authorized",
          );
        e = yield* this.c.records.coordinateCommit(() =>
          domainEffect(
            Effect.gen({ self: this }, function* () {
              const retained = [
                ...(yield* this.c.records.executions()),
                ...(yield* this.c.records.setupScan()).values,
              ].filter((x) => x.current_phase !== "completed");
              if (!(retained.length < this.c.config.max_executions))
                return yield* new CrewError(
                  "CAPACITY",
                  "Global retained execution capacity reached",
                );
              if (
                !(retained.filter((x) => x.repository_id === id).length < registered.max_executions)
              )
                return yield* new CrewError(
                  "CAPACITY",
                  "Repository retained execution capacity reached",
                );
              const executionID = ExecutionId.make(`abra-setup-${randomUUID()}`);
              const setup = yield* createExecution(
                registered,
                {
                  issue_id: IssueId.make(`setup-${id}`),
                  repository_id: id,
                  execution_id: executionID,
                  workflow_policy: "full-openspec",
                  current_phase: "provisioning",
                  setup: true,
                  branch: BranchName.make(`setup/${executionID}`),
                  openspec_change: "",
                  supervisor_session_id: supervisor,
                },
                this.c.config,
              );
              yield* this.save(setup);
              return setup;
            }),
          ),
        );
      }
      if (!(e.delivery_policy === registered.delivery))
        return yield* new CrewError(
          "POLICY_DRIFT",
          "Setup delivery policy changed; preserve resources and repair",
        );
      const p = { ...registered, target_branch: e.target_branch ?? registered.target_branch };
      if (e.current_phase === "completed") return e;
      e.operation = {
        id: OperationId.make(`op-${randomUUID()}`),
        action: OperationAction.make(`setup-${action}`),
        status: "prepared",
        generation: e.control_generation,
        fingerprint: inputFingerprint(e),
        expected: `Reconcile setup ${action} against retained native branch/worktree and delivery identities`,
        started_at: yield* Clock.currentTimeMillis,
      };
      yield* this.save(e);
      yield* progress({ stage: "setup", status: "started" });
      if (action === "prepare") {
        if (e.current_phase !== "provisioning") return e;
        if (!p.project_id) {
          p.project_id = yield* this.c.runtime.project(p.path);
          yield* this.c.records.saveProject({
            ...registered,
            project_id: p.project_id,
          });
        }
        if (!e.base_commit) {
          const base = yield* this.c.sources.base(p, e.execution_id);
          e.base_commit = base.commit;
          e.target_branch = base.target_branch;
          yield* this.save(e);
        }
        if (
          !e.worktree_directory &&
          (yield* this.c.sources.inspect(p.path, e.base_commit)).openspec_config !== null
        ) {
          yield* this.c.records.saveProject({
            ...registered,
            project_id: p.project_id,
            openspec: true,
            target_branch: e.target_branch!,
            inspected_commit: e.base_commit,
          });
          e.current_phase = "completed";
          return yield* this.save(e);
        }
        yield* this.c.workspaces.provision(p, e, () => this.save(e!));
        const path = e.worktree_directory!;
        if (
          !(yield* access(join(path, "openspec/config.yaml")).pipe(
            Effect.match({ onSuccess: () => true, onFailure: () => false }),
          ))
        )
          yield* this.c.git.runner.run(
            this.c.config.commands.openspec,
            ["init", "--tools", "none", "--no-animation", path],
            path,
          );
        const files = [
          yield* this.c.git.run(path, ["diff", "--name-only", e.base_commit!, "--"]),
          yield* this.c.git.run(path, ["ls-files", "--others", "--exclude-standard"]),
        ].flatMap((output) => output.split("\n").filter(Boolean));
        const allowed = new Set([
          "openspec/config.yaml",
          "openspec/changes/archive/.gitkeep",
          "openspec/specs/.gitkeep",
        ]);
        if (!(files.length > 0 && files.every((name) => allowed.has(name))))
          return yield* new CrewError(
            "SETUP_CONTENT",
            `Setup may only initialize OpenSpec configuration and directory placeholders; preserve unexpected files for inspection: ${files.join(", ")}`,
          );
        // Inspect the generated configuration through the real repository-local CLI.
        const config = yield* decode(
          OpenSpecConfigSchema,
          yield* parseYaml(
            yield* readFile(join(path, "openspec/config.yaml"), "utf8"),
            "Generated OpenSpec configuration",
          ),
          "Generated OpenSpec configuration",
        );
        if (!(config && typeof config.schema === "string"))
          return yield* new CrewError(
            "SETUP_CONFIG",
            "Generated OpenSpec configuration must name a schema",
          );
        const schemas = yield* json(
          this.c.git.runner,
          DiscoverySchema,
          this.c.config.commands.openspec,
          ["schemas", "--json"],
          path,
        );
        if (!schemas.some((s) => s.name === config.schema))
          return yield* new CrewError(
            "SETUP_SCHEMA",
            "Generated configuration names an unavailable schema",
          );
        yield* this.c.git.run(path, ["add", "--", ...files]);
        e.archived_tree = yield* this.c.git.tree(path);
        e.current_phase = "planning";
        return yield* this.save(e);
      }
      if (!e.worktree_directory)
        return yield* new CrewError("WORKTREE", "Prepare the setup worktree first");
      if (action === "deliver") {
        if (!["planning", "delivering"].includes(e.current_phase))
          return yield* new CrewError("SETUP_PHASE", "Setup is not ready for delivery");
        yield* this.c.git.validate(p, e);
        if (
          !(
            (yield* this.c.git.tree(e.worktree_directory)) === e.archived_tree &&
            !(yield* this.c.git.run(e.worktree_directory, ["diff", "--name-only"])) &&
            !(yield* this.c.git.run(e.worktree_directory, [
              "ls-files",
              "--others",
              "--exclude-standard",
            ]))
          )
        )
          return yield* new CrewError(
            "SETUP_CHANGED",
            "Prepared setup content changed; preserve it for inspection",
          );
        e.current_phase = "delivering";
        yield* this.save(e);
        const result = yield* this.c.delivery.deliver(p, e);
        e.delivered_commit = result.commit;
        e.pull_request_reference = result.pr;
        e.current_phase = "awaiting_merge";
        return yield* this.save(e);
      }
      if (!["awaiting_merge", "cleaning"].includes(e.current_phase))
        return yield* new CrewError("SETUP_PHASE", "Deliver setup before approval or cleanup");
      if (e.current_phase === "awaiting_merge") {
        yield* this.c.git.validate(p, e);
        if (
          !(
            (yield* this.c.git.head(e.worktree_directory)) === e.delivered_commit &&
            !(yield* this.c.git.dirty(e.worktree_directory))
          )
        )
          return yield* new CrewError("SETUP_CHANGED", "Delivered setup worktree changed");
        if (action === "approve") {
          const pr = yield* this.c.delivery.inspect(p, e);
          if (
            !(
              pr &&
              pr.url === e.pull_request_reference &&
              pr.headRefOid === e.delivered_commit &&
              pr.baseRefName === e.target_branch
            )
          )
            return yield* new CrewError("PR_HEAD", "Setup PR identity changed before approval");
          yield* this.readiness(p, e);
          if (!(p.delivery === "github-pr"))
            return yield* new CrewError(
              "DELIVERY_POLICY",
              "Branch delivery does not require merge approval",
            );
          let approval = e.approval_receipts.find(
            (a) => a.fingerprint === e!.delivered_commit && !a.rejected_at,
          );
          if (!approval) {
            approval = {
              kind: "merge",
              fingerprint: e.delivered_commit!,
              form_id: Form.ID.create(),
              session_id: supervisor,
            };
            e.approval_receipts.push(approval);
            yield* this.save(e);
          }
          if (!approval.authorized_at) {
            yield* this.c.runtime.requestApproval(
              approval.session_id,
              approval.form_id,
              `Authorize OpenSpec setup merge for ${id}`,
              approval.fingerprint,
            );
            const decision = yield* this.c.runtime.approval(approval.session_id, approval.form_id);
            if (decision === "pending")
              return { setup: e, approval_required: true, form_id: approval.form_id };
            if (decision === "rejected") {
              approval.rejected_at = yield* timestamp;
              yield* this.save(e);
              return yield* new CrewError("APPROVAL_REJECTED", "Human rejected the setup merge");
            }
            approval.authorized_at = yield* timestamp;
            yield* this.save(e);
          }
        }
        if (
          p.delivery === "github-pr" &&
          (yield* this.c.delivery.inspect(p, e))?.state !== "MERGED"
        ) {
          if (
            !(
              e.merge_approval_required === false ||
              e.approval_receipts.some(
                (a) => a.fingerprint === e!.delivered_commit && a.authorized_at,
              )
            )
          )
            return yield* new CrewError(
              "MERGE_APPROVAL",
              "Human authorization is required before setup merge",
            );
          yield* this.readiness(p, e);
          const result = yield* this.c.delivery.merge(p, e, undefined, () => this.readiness(p, e!));
          if (result.category !== "completed") {
            e.error_or_recovery_reason = result.reason;
            return yield* this.save(e);
          }
        }
        e.delivery_receipt = yield* this.c.delivery.evidence(p, e);
        e.current_phase = "cleaning";
        yield* this.save(e);
      }
      const blocker = yield* this.c.workspaces.retire(p, e, () => this.save(e!));
      if (blocker)
        return yield* new CrewError(
          blocker.paths.some((path) => path.category === "untracked")
            ? "DIRTY_WORKTREE"
            : "IGNORED_WORK",
          `Setup cleanup blocked; preserve retained paths ${JSON.stringify(blocker.paths).slice(0, 4096)}${blocker.truncated ? " (truncated sample)" : ""} before retrying setup finish`,
        );
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
      e.current_phase = "completed";
      return yield* this.save(e);
    }.bind(this),
    domainEffect,
  );
}
