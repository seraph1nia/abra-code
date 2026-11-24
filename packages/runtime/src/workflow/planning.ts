import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Effect } from "effect";
import { CrewError, ensure, type Execution, type Project, type Role } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import {
  Fingerprint,
  type RequestId,
  type SessionId,
  timestamp,
} from "@abracode/contracts/identities";
import { directoryIdentity, sameDirectory } from "../git/retirement.ts";
import type { Git } from "../git/repository.ts";
import type { Records } from "../storage/store.ts";
import type { WorkGraph } from "../work/graph.ts";
import type { Runtime } from "../opencode/runtime.ts";
import type { OpenSpec } from "../openspec/adapter.ts";
import type { SessionInspection } from "./session-inspection.ts";
import type { Obligations } from "./obligations.ts";
import { assertApprovalActor } from "./authorization.ts";
import { readWorkerContext, compatibleContext } from "./worker-context.ts";
import { activeSynchronization } from "./synchronization.ts";
import { externalOwns } from "@abracode/contracts/validation/contracts";
import { messageRequests } from "@abracode/contracts/workflow/message-contracts";
import { realpath } from "../filesystem.ts";
import { resolve } from "node:path";
import {
  currentPlanning,
  type PlanningAttempt,
  type PlanningSource,
} from "./planning-contracts.ts";

const digest = (value: unknown) =>
  Fingerprint.make(createHash("sha256").update(JSON.stringify(value)).digest("hex"));
const refs = (a: PlanningAttempt) => `refs/abracode/planning/${a.execution_id}/${a.id}`;
const hasLegacyReplanGap = (e: Execution) =>
  !e.planning_base_commit &&
  !activeSynchronization(e) &&
  e.approval_receipts.some((r) => r.kind === "plan" && r.authorized_at);
const legacyReplanError = () =>
  new CrewError(
    "PLANNING_BASELINE_REQUIRED",
    "Legacy controlled replan has no attributable baseline; use explicit recovery",
  );
type Request = { id: RequestId; sender: SessionId };
interface Dependencies {
  records: Records;
  git: Git;
  work: WorkGraph;
  runtime: Runtime;
  spec: OpenSpec;
  inspection: SessionInspection;
  obligations: Obligations;
}
/** One controller owner for source boundaries. Forms collect evidence; only
 * explicit control consumes adoption. No publication or Apply authority here. */
export class PlanningBaselines {
  constructor(private c: Dependencies) {}
  private save = (e: Execution, a: PlanningAttempt) => {
    const all = e.planning?.attempts ?? [];
    e.planning = {
      schema_version: 1,
      attempts: all.some((old) => old.id === a.id)
        ? all.map((old) => (old.id === a.id ? a : old))
        : [...all, a],
    };
    return this.c.records.saveOwned(e, ["planning"]);
  };
  private fence = Effect.fn("Planning.fence")(
    function* (this: PlanningBaselines, e: Execution, p: Project) {
      const current = yield* this.c.records.execution(e.issue_id);
      ensure(
        current &&
          current.execution_id === e.execution_id &&
          current.control_generation === e.control_generation &&
          current.operation?.id === e.operation?.id &&
          !current.stop_status,
        "STALE_OPERATION",
        "Planning control ownership changed",
      );
      const issue = yield* this.c.work.show(e.issue_id);
      ensure(
        issue.assignee === e.execution_id && ["in_progress", "blocked"].includes(issue.status),
        "CLAIM_LOST",
        "Planning requires the retained execution claim",
      );
      ensure(
        issue.repository_id === e.repository_id && issue.workflow_policy === e.workflow_policy,
        "WORK_DRIFT",
        "Planning issue repository/policy changed",
      );
      ensure(
        !e.stop_status && e.current_phase !== "interrupted",
        "CONTROL_PAUSED",
        "Resume paused work explicitly",
      );
      ensure(!externalOwns(e), "EXTERNAL_CUSTODY", "Return external custody before planning");
      ensure(
        e.workflow_policy === "full-openspec" &&
          !e.setup &&
          !e.archive_path &&
          !e.provisional &&
          !e.delivered_commit &&
          !e.finishing?.publication &&
          !activeSynchronization(e) &&
          !["archiving", "delivering", "awaiting_merge", "cleaning", "completed"].includes(
            e.current_phase,
          ),
        "REPLAN_PHASE",
        "Controlled planning must precede archival/publication",
      );
      yield* this.c.git.validate(p, e);
      ensure(
        e.worktree_directory &&
          e.worktree_identity &&
          sameDirectory(e.worktree_identity, yield* directoryIdentity(e.worktree_directory)),
        "WORKTREE_IDENTITY",
        "Planning requires the original worktree directory identity",
      );
      yield* this.c.inspection.validateLocations(e);
      yield* this.c.spec.assertSchema(e);
      ensure(
        e.openspec_schema_binding?.state === "bound",
        "SCHEMA_UNAVAILABLE",
        "Planning needs the retained schema binding",
      );
    }.bind(this),
    domainEffect,
  );
  private quiescent = Effect.fn("Planning.quiescent")(
    function* (this: PlanningBaselines, e: Execution) {
      ensure(
        !messageRequests(e.messages).some((m) => m.status === "admission_uncertain"),
        "MESSAGE_UNCERTAIN",
        "Pause and confirm native stop before replacing an uncertain instruction",
      );
      const sessionIds = [
        e.explore_session_id,
        e.apply_session_id,
        e.review_session_id,
        e.research_session_id,
      ].filter((id): id is SessionId => Boolean(id));
      const states = yield* Effect.forEach(sessionIds, (id) => this.c.runtime.session(id), {
        concurrency: "unbounded",
      });
      ensure(
        states.every((s) => !s.busy),
        "WRITER_BUSY",
        "A managed session still runs in this worktree",
      );
      ensure(
        !e.session_intent &&
          !e.capacity_wait &&
          !["preparing", "uncertain"].includes(e.capacity_reservation?.status ?? ""),
        "PLANNING_ADMISSION",
        "Resolve queued or uncertain admission before planning",
      );
      ensure(
        states.every(
          (s) =>
            !s.executing &&
            !s.completion_pending &&
            !s.queued_prompt_ids?.length &&
            !s.diagnostic_error,
        ),
        "WRITER_BUSY",
        "A managed assignment is running, completing or queued",
      );
    }.bind(this),
    domainEffect,
  );
  private binding = Effect.fn("Planning.binding")(
    function* (this: PlanningBaselines, e: Execution, a: PlanningAttempt) {
      const root = e.worktree_directory!;
      const common = yield* realpath(
        resolve(root, yield* this.c.git.run(root, ["rev-parse", "--git-common-dir"])),
      );
      ensure(
        a.execution_id === e.execution_id &&
          a.issue_id === e.issue_id &&
          a.repository_id === e.repository_id &&
          a.branch === e.branch &&
          a.change === e.openspec_change &&
          e.openspec_schema_binding?.state === "bound" &&
          a.schema_hash === e.openspec_schema_binding.hash &&
          sameDirectory(a.worktree, yield* directoryIdentity(root)) &&
          common === a.common_dir,
        "PLANNING_IDENTITY",
        "Retained planning binding changed",
      );
      ensure(
        a.generation === e.control_generation ||
          a.continuations.some((v) => v.generation === e.control_generation),
        "PLANNING_GENERATION",
        "Explicit supported continuation required for this baseline",
      );
    }.bind(this),
    domainEffect,
  );
  private observe = Effect.fn("Planning.observe")(
    function* (this: PlanningBaselines, e: Execution): Effect.fn.Return<PlanningSource, CrewError> {
      const root = e.worktree_directory!;
      const head = yield* this.c.git.head(root);
      const fingerprint = yield* this.c.git.fingerprint(root);
      const trees = yield* this.c.git.sourceTrees(root);
      ensure(
        head === (yield* this.c.git.head(root)) &&
          fingerprint === (yield* this.c.git.fingerprint(root)),
        "PLANNING_RACE",
        "Source changed during private capture",
      );
      return { head, fingerprint, ...trees };
    }.bind(this),
    domainEffect,
  );
  private pins = Effect.fn("Planning.pins")(
    function* (this: PlanningBaselines, e: Execution, a: PlanningAttempt, check = false) {
      ensure(a.source, "PLANNING_BASELINE_REQUIRED", "No reconstructable source baseline");
      const source = a.source;
      yield* Effect.forEach(
        ["index", "candidate"] as const,
        (view) =>
          check
            ? this.c.git.assertPinnedTree(e.worktree_directory!, `${refs(a)}/${view}`, source[view])
            : this.c.git.pinTree(e.worktree_directory!, `${refs(a)}/${view}`, source[view]),
        { concurrency: 2 },
      );
    }.bind(this),
    domainEffect,
  );
  private delta = Effect.fn("Planning.delta")(
    function* (
      this: PlanningBaselines,
      e: Execution,
      a: PlanningAttempt,
      observed: PlanningSource,
    ) {
      ensure(
        a.source && a.pinned,
        "PLANNING_BASELINE_REQUIRED",
        "Planning baseline/pins are unavailable",
      );
      const source = a.source;
      yield* this.pins(e, a, true);
      ensure(
        observed.head === source.head,
        "EXPLORE_SOURCE_EDIT",
        "Explore changed the admitted HEAD",
      );
      yield* Effect.forEach(
        ["index", "candidate"] as const,
        (view) =>
          this.c.git.planningDelta(
            e.worktree_directory!,
            source[view],
            observed[view],
            e.openspec_change,
          ),
        { concurrency: 2 },
      );
    }.bind(this),
    domainEffect,
  );
  /** Initial/correction/synchronization planning retains its own commit/tree boundary. */
  private trusted = Effect.fn("Planning.trusted")(
    function* (this: PlanningBaselines, e: Execution, source: PlanningSource) {
      const sync = activeSynchronization(e);
      const commit = e.planning_base_commit ?? e.openspec_update_commit ?? e.base_commit!;
      ensure(source.head === commit, "EXPLORE_SOURCE_EDIT", "Explore changed its trusted HEAD");
      const base = sync?.planning_base_tree ?? commit;
      yield* Effect.forEach(
        ["index", "candidate"] as const,
        (view) =>
          this.c.git.planningDelta(e.worktree_directory!, base, source[view], e.openspec_change),
        { concurrency: 2 },
      );
      return commit;
    }.bind(this),
    domainEffect,
  );
  private provenance = Effect.fn("Planning.provenance")(
    function* (
      this: PlanningBaselines,
      e: Execution,
      source: PlanningSource,
    ): Effect.fn.Return<PlanningAttempt["provenance"], CrewError> {
      const a = e.finishing?.attribution;
      if (
        a?.generation === e.control_generation &&
        a.head === source.head &&
        a.fingerprint === source.fingerprint
      ) {
        const context = yield* readWorkerContext(this.c.records.store, a.prompt_id);
        compatibleContext(context, {
          execution_id: e.execution_id,
          generation: e.control_generation,
          role: "apply",
          session_id: a.session_id,
          prompt_id: a.prompt_id,
        });
        ensure(
          context.issue_id === e.issue_id &&
            context.repository_id === e.repository_id &&
            context.directory === e.worktree_directory &&
            context.scope_fingerprint === e.plan_fingerprint &&
            (e.plan_approval_required === false ||
              context.approvals.some(
                (r) =>
                  r.kind === "plan" &&
                  r.fingerprint === context.scope_fingerprint &&
                  !!r.authorized_at &&
                  !r.rejected_at &&
                  e.approval_receipts.some((old) => isDeepStrictEqual(old, r)),
              )),
          "PLANNING_ATTRIBUTION",
          "Apply attribution lacks its authorized captured context",
        );
        return {
          kind: "apply",
          session_id: a.session_id,
          prompt_id: a.prompt_id,
          context_id: a.prompt_id,
          at: a.at,
        };
      }
      // A clean trusted source is useful before initial Apply; unknown source
      // must not be blessed because an idle session happens to report success.
      const commit = yield* this.trusted(e, source).pipe(
        Effect.mapError(
          () =>
            new CrewError(
              "PLANNING_ATTRIBUTION",
              "Current source lacks prior matching authorized Apply attribution; use explicit planning recovery",
            ),
        ),
      );
      return { kind: "trusted", commit };
    }.bind(this),
    domainEffect,
  );
  prepare = Effect.fn("Planning.prepare")(
    function* (
      this: PlanningBaselines,
      e: Execution,
      p: Project,
      action: "replan" | "recover_planning",
      request: Request,
      text?: string,
    ) {
      yield* assertApprovalActor(e, request.sender);
      yield* this.fence(e, p);
      const input = digest([action, request.sender, text ?? ""]);
      let a = e.planning?.attempts.find((old) => old.request_id === request.id);
      if (a) {
        ensure(
          a.input === input && a.action === action && a.sender === request.sender,
          "REQUEST_REBIND",
          "Planning request identifies different input",
        );
        ensure(
          a.id === currentPlanning(e)?.id,
          "PLANNING_SUPERSEDED",
          "This planning request is historical",
        );
        yield* this.binding(e, a);
        if (a.admissions.length) {
          // Never create another prompt for an uncertain/admitted request.
          if (a.stage === "violated")
            return yield* new CrewError(
              "EXPLORE_SOURCE_EDIT",
              "Retained planning violation requires explicit recovery",
            );
          return { ready: false, admitted: true };
        }
      }
      yield* this.quiescent(e);
      if (!a) {
        const prior = currentPlanning(e);
        ensure(
          action === "recover_planning" || !prior || prior.stage === "applying",
          "PLANNING_UNRESOLVED",
          "An unresolved planning intent/violation cannot be replaced by replan",
        );
        if (action === "recover_planning")
          ensure(
            ["recovery_required", "failed", "blocked"].includes(e.current_phase) &&
              (["exploring", "planning", "awaiting_plan_approval"].includes(e.resume_phase ?? "") ||
                !!prior),
            "PLANNING_RECOVERY_PHASE",
            "Only stranded pre-delivery planning can be recovered",
          );
        const observed = yield* this.observe(e);
        let provenance: PlanningAttempt["provenance"];
        let source = observed;
        if (action === "replan") provenance = yield* this.provenance(e, observed);
        else if (
          prior?.source &&
          prior.pinned &&
          prior.admissions.length &&
          !prior.violations.length &&
          prior.stage !== "applying" &&
          prior.provenance.kind !== "prospective_adoption"
        ) {
          yield* this.binding(e, prior);
          yield* this.delta(e, prior, observed);
          provenance = { kind: "historical", attempt: prior.id };
          source = prior.source;
        } else provenance = { kind: "prospective_adoption" };
        yield* this.fence(e, p);
        ensure(
          observed.fingerprint === (yield* this.c.git.fingerprint(e.worktree_directory!)),
          "PLANNING_RACE",
          "Source changed before intent persistence",
        );
        ensure(
          e.operation && e.openspec_schema_binding?.state === "bound",
          "PLANNING_OWNERSHIP",
          "Owned operation/schema required",
        );
        a = {
          schema_version: 1,
          id: digest([e.execution_id, request.id, input]),
          request_id: request.id,
          input,
          action,
          sender: request.sender,
          generation: e.control_generation,
          operation_id: e.operation.id,
          issue_id: e.issue_id,
          repository_id: e.repository_id,
          execution_id: e.execution_id,
          worktree: yield* directoryIdentity(e.worktree_directory!),
          branch: e.branch,
          common_dir: p.git_common_dir,
          change: e.openspec_change,
          schema_hash: e.openspec_schema_binding.hash,
          at: yield* timestamp,
          expected_head: source.head,
          expected_fingerprint: source.fingerprint,
          prior: {
            phase: e.current_phase,
            plan: e.plan_fingerprint,
            verification: e.verification_receipt?.fingerprint,
            review: e.review_receipt?.fingerprint,
            approvals: [...e.approval_receipts],
            error: e.error_or_recovery_reason,
            prompt_id: e.prompt_id,
            context_id: e.worker_context_id,
          },
          provenance,
          stage: "prepared",
          admissions: [],
          continuations: [],
          violations: [],
          ...(provenance.kind === "historical" ? { source } : {}),
        };
        // Journal ref identity and expected content before capture/pinning.
        yield* this.save(e, a);
      }
      yield* this.binding(e, a);
      if (!a.source) {
        const source = yield* this.observe(e);
        ensure(
          source.head === a.expected_head && source.fingerprint === a.expected_fingerprint,
          "PLANNING_RACE",
          "Prepared source changed; the same intent cannot recapture new content",
        );
        yield* this.fence(e, p);
        a = { ...a, source, stage: "captured" };
        yield* this.save(e, a);
      }
      yield* this.pins(e, a, !!a.pinned);
      a = { ...a, pinned: true };
      const observed = yield* this.observe(e);
      if (a.provenance.kind === "historical") yield* this.delta(e, a, observed);
      else
        ensure(
          isDeepStrictEqual(observed, a.source),
          a.stage === "offered" ? "PLANNING_OFFER_CHANGED" : "PLANNING_RACE",
          "Captured/offered source changed; no automatic recapture",
        );
      yield* this.fence(e, p);
      yield* this.quiescent(e);
      if (a.provenance.kind === "prospective_adoption" && !a.authorization) {
        a = { ...a, stage: "offered" };
        yield* this.save(e, a);
        const target = {
          schema_version: 1 as const,
          kind: "planning_baseline_adoption" as const,
          generation: a.generation,
          attempt: a,
        };
        const key = yield* this.c.obligations.openFinishing(
          e,
          target,
          "Adopt this exact current source as a NEW planning baseline, not historical reconstruction. This grants no implementation, publication, merge or cleanup authority. Fresh plan approval, checks and independent Review remain required.",
        );
        const decision = e.decisions?.find(
          (d) => d.key === key && d.generation === e.control_generation,
        );
        if (
          decision?.status !== "answered" ||
          decision.finishing_answer?.action !== "authorize" ||
          !decision.form_id ||
          !decision.form_session ||
          !isDeepStrictEqual(decision.finishing_target, target)
        )
          return { ready: false, admitted: false };
        yield* assertApprovalActor(e, decision.form_session);
        // The offer never changes. Collection alone cannot resume this execution.
        ensure(
          isDeepStrictEqual(yield* this.observe(e), a.source),
          "PLANNING_OFFER_CHANGED",
          "Exact offered content changed",
        );
        yield* this.fence(e, p);
        a = {
          ...a,
          authorization: {
            key,
            form_id: decision.form_id,
            session_id: decision.form_session,
            at: yield* timestamp,
          },
        };
      }
      a = { ...a, stage: "ready" };
      yield* this.save(e, a);
      return { ready: true, admitted: false };
    }.bind(this),
    domainEffect,
  );
  assertDelta = Effect.fn("Planning.assertDelta")(
    function* (this: PlanningBaselines, e: Execution) {
      const a = currentPlanning(e);
      if (a?.stage === "applying") return;
      const observed = yield* this.observe(e);
      if (!a) {
        if (["exploring", "planning"].includes(e.current_phase) && hasLegacyReplanGap(e))
          return yield* legacyReplanError();
        yield* this.trusted(e, observed);
        return;
      }
      yield* this.binding(e, a);
      ensure(
        !a.violations.length,
        "EXPLORE_SOURCE_EDIT",
        "Original planning violation remains retained; explicit recovery required",
      );
      const result = yield* Effect.result(this.delta(e, a, observed));
      if (result._tag === "Failure") {
        if (["EXPLORE_SOURCE_EDIT", "SPEC_SYMLINK"].includes(result.failure.code))
          yield* this.save(e, {
            ...a,
            stage: "violated",
            violations: [
              ...a.violations,
              {
                generation: e.control_generation,
                at: yield* timestamp,
                code: result.failure.code,
                reason: result.failure.message,
                source: observed,
                session_id: e.explore_session_id,
                prompt_id: e.prompt_id,
              },
            ],
          });
        return yield* result.failure;
      }
    }.bind(this),
    domainEffect,
  );
  planned = (e: Execution) => {
    const a = currentPlanning(e);
    return a ? this.save(e, { ...a, stage: "planned" }) : Effect.void;
  };
  private effectiveProject = Effect.fn("Planning.effectiveProject")(
    function* (this: PlanningBaselines, e: Execution) {
      const p = yield* this.c.records.project(e.repository_id);
      ensure(p, "PROJECT_MISSING", "Planning repository registration is unavailable");
      ensure(
        e.delivery_policy === p.delivery,
        "POLICY_DRIFT",
        "Registered delivery policy changed during execution",
      );
      return { ...p, verification: e.effective_policy.verification };
    }.bind(this),
    domainEffect,
  );
  beforeAdmission = Effect.fn("Planning.beforeAdmission")(
    function* (this: PlanningBaselines, e: Execution, role: Role) {
      const a = currentPlanning(e);
      if (
        !a &&
        role === "explore" &&
        e.workflow_policy === "full-openspec" &&
        hasLegacyReplanGap(e)
      )
        return yield* legacyReplanError();
      if (!a || (role !== "explore" && role !== "apply")) return;
      if (role === "explore")
        ensure(
          ["ready", "planning"].includes(a.stage),
          "PLANNING_BASELINE_REQUIRED",
          "Controlled Explore lacks an admitted baseline",
        );
      if (role === "apply" && a.stage === "applying") return;
      const project = yield* this.effectiveProject(e);
      yield* this.fence(e, project);
      yield* this.assertDelta(e);
    }.bind(this),
    domainEffect,
  );
  preparedAdmission = Effect.fn("Planning.preparedAdmission")(
    function* (this: PlanningBaselines, e: Execution, role: Role) {
      const a = currentPlanning(e);
      if (!a || (role !== "explore" && role !== "apply") || a.stage === "applying") return;
      const project = yield* this.effectiveProject(e);
      yield* this.fence(e, project);
      yield* this.assertDelta(e);
      ensure(
        e.prompt_id && e.worker_context_id && e.active_role === role,
        "PLANNING_ADMISSION",
        "Planning needs its captured prompt/context",
      );
      if (role === "explore") {
        ensure(e.explore_session_id, "PLANNING_ADMISSION", "Explore session missing");
        yield* this.save(e, {
          ...a,
          stage: "planning",
          admissions: [
            ...a.admissions,
            {
              generation: e.control_generation,
              session_id: e.explore_session_id,
              prompt_id: e.prompt_id,
              context_id: e.worker_context_id,
            },
          ],
        });
      } else yield* this.save(e, { ...a, stage: "applying" });
    }.bind(this),
    domainEffect,
  );
  continue = Effect.fn("Planning.continue")(
    function* (this: PlanningBaselines, e: Execution, p: Project) {
      const a = currentPlanning(e);
      if (!a || a.stage === "applying") return;
      ensure(
        e.stop_status === "confirmed",
        "PLANNING_GENERATION",
        "Baseline continuation requires a confirmed stop",
      );
      // Keep origin generation immutable. Revalidate identity/delta with a
      // temporary continuation, then persist only after every guard succeeds.
      const continued = {
        ...a,
        continuations: [
          ...a.continuations,
          { generation: e.control_generation, at: yield* timestamp },
        ],
      };
      yield* this.binding(e, continued);
      ensure(
        !a.violations.length && !!a.source && !!a.pinned,
        "EXPLORE_SOURCE_EDIT",
        "Cannot resume a violated/missing baseline",
      );
      yield* this.delta(e, continued, yield* this.observe(e));
      yield* this.c.git.validate(p, e);
      yield* this.c.inspection.validateLocations(e);
      yield* this.quiescent(e);
      const issue = yield* this.c.work.show(e.issue_id);
      ensure(
        issue.assignee === e.execution_id &&
          issue.repository_id === e.repository_id &&
          issue.workflow_policy === e.workflow_policy &&
          !externalOwns(e),
        "CLAIM_LOST",
        "Planning continuation ownership changed",
      );
      yield* this.save(e, continued);
    }.bind(this),
    domainEffect,
  );
}
