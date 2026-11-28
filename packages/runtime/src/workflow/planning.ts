import { sha256 } from "../digest.ts";
import { WorkflowError } from "../errors.ts";
import { tryDomainValue } from "../effect.ts";
import { isDeepStrictEqual } from "node:util";
import { Effect } from "effect";
import { CrewError, type Execution, type Project, type Role } from "../domain.ts";
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
import type { SessionState } from "../opencode/runtime.ts";
import type { OpenSpec } from "../openspec/adapter.ts";
import type { SessionInspection } from "./worker-assignment.ts";
import type { Obligations } from "./obligations.ts";
import { type ApprovalActorCheck } from "./authorization.ts";
import { readWorkerContext, compatibleContext } from "./worker-context.ts";
import { activeSynchronization } from "./finishing/synchronization.ts";
import { externalOwns } from "@abracode/contracts/validation/contracts";
import { messageRequests } from "@abracode/contracts/workflow/message-contracts";
import { realpath } from "../filesystem.ts";
import { resolve } from "node:path";
import {
  currentPlanning,
  type PlanningAttempt,
  type PlanningSource,
} from "./planning-contracts.ts";

const digest = (value: unknown) => Fingerprint.make(sha256(JSON.stringify(value)));
const refs = (a: PlanningAttempt) => `refs/abracode/planning/${a.execution_id}/${a.id}`;
type Request = { id: RequestId; sender: SessionId };
interface Dependencies {
  assertActor: ApprovalActorCheck;
  records: Records;
  git: Git;
  work: WorkGraph;
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
    e = {
      ...e,
      planning: {
        schema_version: 1,
        attempts: all.some((old) => old.id === a.id)
          ? all.map((old) => (old.id === a.id ? a : old))
          : [...all, a],
      },
    };
    return this.c.records.saveOwned(e, ["planning"]);
  };
  private fence = Effect.fn("Planning.fence")({ self: this }, function* (e: Execution, p: Project) {
    const current = yield* this.c.records.execution(e.issue_id);
    if (
      !current ||
      current.execution_id !== e.execution_id ||
      current.control_generation !== e.control_generation ||
      current.operation?.id !== e.operation?.id ||
      current.stop_status
    )
      return yield* new WorkflowError("STALE_OPERATION", "Planning control ownership changed");
    const issue = yield* this.c.work.show(e.issue_id);
    if (issue.assignee !== e.execution_id || !["in_progress", "blocked"].includes(issue.status))
      return yield* new WorkflowError(
        "CLAIM_LOST",
        "Planning requires the retained execution claim",
      );
    if (issue.repository_id !== e.repository_id || issue.workflow_policy !== e.workflow_policy)
      return yield* new WorkflowError("WORK_DRIFT", "Planning issue repository/policy changed");
    if (e.stop_status || e.current_phase === "interrupted")
      return yield* new WorkflowError("CONTROL_PAUSED", "Resume paused work explicitly");
    if (externalOwns(e))
      return yield* new WorkflowError(
        "EXTERNAL_CUSTODY",
        "Return external custody before planning",
      );
    if (
      e.workflow_policy !== "full-openspec" ||
      e.setup ||
      e.archive_path ||
      e.provisional ||
      e.delivered_commit ||
      e.finishing?.publication ||
      activeSynchronization(e) ||
      ["archiving", "delivering", "awaiting_merge", "cleaning", "completed"].includes(
        e.current_phase,
      )
    )
      return yield* new WorkflowError(
        "REPLAN_PHASE",
        "Controlled planning must precede archival/publication",
      );
    yield* this.c.git.validate(p, e);
    if (
      !(
        e.worktree_directory &&
        e.worktree_identity &&
        sameDirectory(e.worktree_identity, yield* directoryIdentity(e.worktree_directory))
      )
    )
      return yield* new WorkflowError(
        "WORKTREE_IDENTITY",
        "Planning requires the original worktree directory identity",
      );
    yield* this.c.spec.assertSchema(e);
    if (e.openspec_schema_binding?.state !== "bound")
      return yield* new WorkflowError(
        "SCHEMA_UNAVAILABLE",
        "Planning needs the retained schema binding",
      );
    return yield* this.c.inspection.validateLocations(e);
  });
  private quiescent = Effect.fn("Planning.quiescent")(function* (
    e: Execution,
    states: readonly SessionState[],
  ) {
    if (messageRequests(e.messages).some((m) => m.status === "admission_uncertain"))
      return yield* new WorkflowError(
        "MESSAGE_UNCERTAIN",
        "Pause and confirm native stop before replacing an uncertain instruction",
      );
    if (!states.every((s) => !s.busy))
      return yield* new WorkflowError(
        "WRITER_BUSY",
        "A managed session still runs in this worktree",
      );
    if (
      e.session_intent ||
      e.capacity_wait ||
      ["preparing", "uncertain"].includes(e.capacity_reservation?.status ?? "")
    )
      return yield* new WorkflowError(
        "PLANNING_ADMISSION",
        "Resolve queued or uncertain admission before planning",
      );
    if (
      !states.every(
        (s) =>
          !s.executing &&
          !s.completion_pending &&
          !s.queued_prompt_ids?.length &&
          !s.diagnostic_error,
      )
    )
      return yield* new WorkflowError(
        "WRITER_BUSY",
        "A managed assignment is running, completing or queued",
      );
  });
  private binding = Effect.fn("Planning.binding")(
    { self: this },
    function* (e: Execution, a: PlanningAttempt) {
      const root = e.worktree_directory!;
      const common = yield* realpath(
        resolve(root, yield* this.c.git.run(root, ["rev-parse", "--git-common-dir"])),
      );
      if (
        a.execution_id !== e.execution_id ||
        a.issue_id !== e.issue_id ||
        a.repository_id !== e.repository_id ||
        a.branch !== e.branch ||
        a.change !== e.openspec_change ||
        e.openspec_schema_binding?.state !== "bound" ||
        a.schema_hash !== e.openspec_schema_binding.hash ||
        !sameDirectory(a.worktree, yield* directoryIdentity(root)) ||
        common !== a.common_dir
      )
        return yield* new WorkflowError("PLANNING_IDENTITY", "Retained planning binding changed");
      if (
        a.generation !== e.control_generation &&
        !a.continuations.some((v) => v.generation === e.control_generation)
      )
        return yield* new WorkflowError(
          "PLANNING_GENERATION",
          "Explicit supported continuation required for this baseline",
        );
    },
  );
  private observe = Effect.fn("Planning.observe")(
    { self: this },
    function* (e: Execution): Effect.fn.Return<PlanningSource, CrewError> {
      const root = e.worktree_directory!;
      const before = yield* this.c.git.fingerprintState(root);
      const trees = yield* this.c.git.sourceTrees(root);
      const after = yield* this.c.git.fingerprintState(root);
      if (before.head !== after.head || before.fingerprint !== after.fingerprint)
        return yield* new WorkflowError("PLANNING_RACE", "Source changed during private capture");
      return { ...before, ...trees };
    },
  );
  private pins = Effect.fn("Planning.pins")(
    { self: this },
    function* (e: Execution, a: PlanningAttempt, check = false) {
      if (!a.source)
        return yield* new WorkflowError(
          "PLANNING_BASELINE_REQUIRED",
          "No reconstructable source baseline",
        );
      const source = a.source;
      yield* Effect.forEach(
        ["index", "candidate"] as const,
        (view) =>
          check
            ? this.c.git.assertPinnedTree(e.worktree_directory!, `${refs(a)}/${view}`, source[view])
            : this.c.git.pinTree(e.worktree_directory!, `${refs(a)}/${view}`, source[view]),
        { concurrency: 2 },
      );
    },
  );
  private delta = Effect.fn("Planning.delta")(
    { self: this },
    function* (e: Execution, a: PlanningAttempt, observed: PlanningSource) {
      if (!(a.source && a.pinned))
        return yield* new WorkflowError(
          "PLANNING_BASELINE_REQUIRED",
          "Planning baseline/pins are unavailable",
        );
      const source = a.source;
      yield* this.pins(e, a, true);
      if (observed.head !== source.head)
        return yield* new WorkflowError("EXPLORE_SOURCE_EDIT", "Explore changed the admitted HEAD");
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
    },
  );
  /** Initial/correction/synchronization planning retains its own commit/tree boundary. */
  private trusted = Effect.fn("Planning.trusted")(
    { self: this },
    function* (e: Execution, source: PlanningSource) {
      const sync = activeSynchronization(e);
      const commit = e.planning_base_commit ?? e.openspec_update_commit ?? e.base_commit!;
      if (source.head !== commit)
        return yield* new WorkflowError("EXPLORE_SOURCE_EDIT", "Explore changed its trusted HEAD");
      const base = sync?.planning_base_tree ?? commit;
      yield* Effect.forEach(
        ["index", "candidate"] as const,
        (view) =>
          this.c.git.planningDelta(e.worktree_directory!, base, source[view], e.openspec_change),
        { concurrency: 2 },
      );
      return commit;
    },
  );
  private provenance = Effect.fn("Planning.provenance")(
    { self: this },
    function* (
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
        yield* tryDomainValue(compatibleContext, context, {
          execution_id: e.execution_id,
          generation: e.control_generation,
          role: "apply",
          session_id: a.session_id,
          prompt_id: a.prompt_id,
        });
        if (
          context.issue_id !== e.issue_id ||
          context.repository_id !== e.repository_id ||
          context.directory !== e.worktree_directory ||
          context.scope_fingerprint !== e.plan_fingerprint ||
          (e.plan_approval_required !== false &&
            !context.approvals.some(
              (r) =>
                r.kind === "plan" &&
                r.fingerprint === context.scope_fingerprint &&
                !!r.authorized_at &&
                !r.rejected_at &&
                e.approval_receipts.some((old) => isDeepStrictEqual(old, r)),
            ))
        )
          return yield* new WorkflowError(
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
            new WorkflowError(
              "PLANNING_ATTRIBUTION",
              "Current source lacks prior matching authorized Apply attribution; use explicit planning recovery",
            ),
        ),
      );
      return { kind: "trusted", commit };
    },
  );
  private prepareIntent = Effect.fn("Planning.prepareIntent")(
    { self: this },
    function* (
      e: Execution,
      p: Project,
      action: PlanningAttempt["action"],
      request: Request,
      input: Fingerprint,
    ) {
      const prior = currentPlanning(e);
      const revisingReviewedPlan =
        action === "replan" &&
        !!e.proposal_review &&
        e.current_phase === "awaiting_plan_approval" &&
        prior?.stage === "planned" &&
        !!prior.source &&
        !!prior.pinned &&
        prior.admissions.length > 0 &&
        !prior.violations.length;
      if (
        action !== "recover_planning" &&
        prior &&
        prior.stage !== "applying" &&
        !revisingReviewedPlan
      )
        return yield* new WorkflowError(
          "PLANNING_UNRESOLVED",
          "An unresolved planning intent/violation cannot be replaced by replan",
        );
      if (action === "recover_planning")
        if (
          !["recovery_required", "failed", "blocked"].includes(e.current_phase) ||
          (!["exploring", "planning", "awaiting_plan_approval"].includes(e.resume_phase ?? "") &&
            !prior)
        )
          return yield* new WorkflowError(
            "PLANNING_RECOVERY_PHASE",
            "Only stranded pre-delivery planning can be recovered",
          );
      const observed = yield* this.observe(e);
      let provenance: PlanningAttempt["provenance"];
      let source = observed;
      if (action === "replan" && !revisingReviewedPlan)
        provenance = yield* this.provenance(e, observed);
      else if (
        prior?.source &&
        prior.pinned &&
        prior.admissions.length &&
        !prior.violations.length &&
        prior.stage !== "applying" &&
        (prior.provenance.kind !== "prospective_adoption" ||
          (revisingReviewedPlan && !!prior.authorization))
      ) {
        yield* this.binding(e, prior);
        yield* this.delta(e, prior, observed);
        provenance = { kind: "historical", attempt: prior.id };
        source = prior.source;
      } else provenance = { kind: "prospective_adoption" };
      yield* this.fence(e, p);
      if (observed.fingerprint !== (yield* this.c.git.fingerprint(e.worktree_directory!)))
        return yield* new WorkflowError(
          "PLANNING_RACE",
          "Source changed before intent persistence",
        );
      if (!e.operation || e.openspec_schema_binding?.state !== "bound")
        return yield* new WorkflowError("PLANNING_OWNERSHIP", "Owned operation/schema required");
      const attempt: PlanningAttempt = {
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
      return { execution: yield* this.save(e, attempt), attempt, observed };
    },
  );
  prepare = Effect.fn("Planning.prepare")(
    { self: this },
    function* (
      e: Execution,
      p: Project,
      action: "replan" | "recover_planning",
      request: Request,
      text?: string,
    ) {
      yield* this.c.assertActor(request.sender);
      const states = yield* this.fence(e, p);
      const input = digest([action, request.sender, text ?? ""]);
      let observation: PlanningSource | undefined;
      let a = e.planning?.attempts.find((old) => old.request_id === request.id);
      if (a) {
        if (a.input !== input || a.action !== action || a.sender !== request.sender)
          return yield* new WorkflowError(
            "REQUEST_REBIND",
            "Planning request identifies different input",
          );
        if (a.id !== currentPlanning(e)?.id)
          return yield* new WorkflowError(
            "PLANNING_SUPERSEDED",
            "This planning request is historical",
          );
        if (a.admissions.length) {
          yield* this.binding(e, a);
          // Never create another prompt for an uncertain/admitted request.
          if (a.stage === "violated")
            return yield* new WorkflowError(
              "EXPLORE_SOURCE_EDIT",
              "Retained planning violation requires explicit recovery",
            );
          return { execution: e, ready: false, admitted: true };
        }
      }
      yield* this.quiescent(e, states);
      if (!a) {
        const prepared = yield* this.prepareIntent(e, p, action, request, input);
        e = prepared.execution;
        a = prepared.attempt;
        observation = prepared.observed;
      }
      yield* this.binding(e, a);
      if (!a.source) {
        // Within one preparation the private tree objects already exist. Recheck their
        // content after journaling. A restarted request must reconstruct its own capture.
        const source = observation ?? (yield* this.observe(e));
        const current = observation
          ? yield* this.c.git.fingerprintState(e.worktree_directory!)
          : source;
        if (current.head !== a.expected_head || current.fingerprint !== a.expected_fingerprint)
          return yield* new WorkflowError(
            "PLANNING_RACE",
            "Prepared source changed; the same intent cannot recapture new content",
          );
        yield* this.fence(e, p);
        a = { ...a, source, stage: "captured" };
        e = yield* this.save(e, a);
      }
      yield* this.pins(e, a, !!a.pinned);
      a = { ...a, pinned: true };
      const observed = yield* this.observe(e);
      if (a.provenance.kind === "historical") yield* this.delta(e, a, observed);
      else if (!isDeepStrictEqual(observed, a.source))
        return yield* new WorkflowError(
          a.stage === "offered" ? "PLANNING_OFFER_CHANGED" : "PLANNING_RACE",
          "Captured/offered source changed; no automatic recapture",
        );
      yield* this.quiescent(e, yield* this.fence(e, p));
      if (a.provenance.kind === "prospective_adoption" && !a.authorization) {
        a = { ...a, stage: "offered" };
        e = yield* this.save(e, a);
        const target = {
          schema_version: 1 as const,
          kind: "planning_baseline_adoption" as const,
          generation: a.generation,
          attempt: a,
        };
        const opened = yield* this.c.obligations.openFinishing(
          e,
          target,
          "Adopt this exact current source as a NEW planning baseline, not historical reconstruction. This grants no implementation, publication, merge or cleanup authority. Fresh plan approval, checks and independent Review remain required.",
        );
        const { key } = opened;
        e = opened.execution;
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
          return { execution: e, ready: false, admitted: false };
        yield* this.c.assertActor(decision.form_session);
        // The offer never changes. Collection alone cannot resume this execution.
        if (!isDeepStrictEqual(yield* this.observe(e), a.source))
          return yield* new WorkflowError(
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
      e = yield* this.save(e, a);
      return { execution: e, ready: true, admitted: false };
    },
  );
  assertDelta = Effect.fn("Planning.assertDelta")({ self: this }, function* (e: Execution) {
    const a = currentPlanning(e);
    if (a?.stage === "applying") return;
    const observed = yield* this.observe(e);
    if (!a) {
      yield* this.trusted(e, observed);
      return;
    }
    yield* this.binding(e, a);
    if (a.violations.length)
      return yield* new WorkflowError(
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
  });
  planned = (e: Execution) => {
    const a = currentPlanning(e);
    return a ? this.save(e, { ...a, stage: "planned" }) : Effect.succeed(e);
  };
  private effectiveProject = Effect.fn("Planning.effectiveProject")(
    { self: this },
    function* (e: Execution) {
      const p = yield* this.c.records.project(e.repository_id);
      if (!p)
        return yield* new WorkflowError(
          "PROJECT_MISSING",
          "Planning repository registration is unavailable",
        );
      if (e.delivery_policy !== p.delivery)
        return yield* new WorkflowError(
          "POLICY_DRIFT",
          "Registered delivery policy changed during execution",
        );
      return { ...p, verification: e.effective_policy.verification };
    },
  );
  beforeAdmission = Effect.fn("Planning.beforeAdmission")(
    { self: this },
    function* (e: Execution, role: Role) {
      const a = currentPlanning(e);
      if (!a || (role !== "explore" && role !== "apply")) return;
      if (role === "explore")
        if (!["ready", "planning"].includes(a.stage))
          return yield* new WorkflowError(
            "PLANNING_BASELINE_REQUIRED",
            "Controlled Explore lacks an admitted baseline",
          );
      if (role === "apply" && a.stage === "applying") return;
      const project = yield* this.effectiveProject(e);
      yield* this.fence(e, project);
      yield* this.assertDelta(e);
    },
  );
  preparedAdmission = Effect.fn("Planning.preparedAdmission")(
    { self: this },
    function* (e: Execution, role: Role) {
      const a = currentPlanning(e);
      if (!a || (role !== "explore" && role !== "apply") || a.stage === "applying") return e;
      const project = yield* this.effectiveProject(e);
      yield* this.fence(e, project);
      yield* this.assertDelta(e);
      if (!e.prompt_id || !e.worker_context_id || e.active_role !== role)
        return yield* new WorkflowError(
          "PLANNING_ADMISSION",
          "Planning needs its captured prompt/context",
        );
      if (role === "explore") {
        if (!e.explore_session_id)
          return yield* new WorkflowError("PLANNING_ADMISSION", "Explore session missing");
        e = yield* this.save(e, {
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
      } else e = yield* this.save(e, { ...a, stage: "applying" });
      return e;
    },
  );
  continue = Effect.fn("Planning.continue")({ self: this }, function* (e: Execution, p: Project) {
    const a = currentPlanning(e);
    if (!a || a.stage === "applying") return e;
    if (e.stop_status !== "confirmed")
      return yield* new WorkflowError(
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
    if (a.violations.length || !a.source || !a.pinned)
      return yield* new WorkflowError(
        "EXPLORE_SOURCE_EDIT",
        "Cannot resume a violated/missing baseline",
      );
    yield* this.delta(e, continued, yield* this.observe(e));
    yield* this.c.git.validate(p, e);
    yield* this.quiescent(e, yield* this.c.inspection.validateLocations(e));
    const issue = yield* this.c.work.show(e.issue_id);
    if (
      issue.assignee !== e.execution_id ||
      issue.repository_id !== e.repository_id ||
      issue.workflow_policy !== e.workflow_policy ||
      externalOwns(e)
    )
      return yield* new WorkflowError("CLAIM_LOST", "Planning continuation ownership changed");
    return yield* this.save(e, continued);
  });
}
