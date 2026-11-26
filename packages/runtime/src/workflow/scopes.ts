import { WorkflowError } from "../errors.ts";
import { tryDomainValue } from "../effect.ts";
import { applyExecutionPatch } from "../storage/store.ts";
import { externalOwns } from "@abracode/contracts/validation/contracts";
import { ObligationKey } from "@abracode/contracts/identities";
import { Clock, Effect } from "effect";
import { type Execution, type Issue, CrewError } from "../domain.ts";
import { decode, decodeJSON } from "../decode.ts";
import { ScopeSchema, completeScope, scopeIdentity, type Scope } from "../work/scope.ts";
import { type Records } from "../storage/store.ts";
import { appendDecision, makeControllerDecision } from "./decision-ledger.ts";
import { assertTransition, resetDeliveryArtifactsPatch } from "./transitions.ts";
export { scopeIdentity } from "../work/scope.ts";

export class Scopes {
  constructor(private records: Records) {}
  initialize = Effect.fn("Scopes.initialize")(
    { self: this },
    function* (e: Execution, issue: Issue) {
      let scope = e.scope;
      if (!scope) {
        const answer = e.decisions?.find(
          (d) =>
            d.key === "scope-contract" &&
            d.status === "answered" &&
            d.generation === e.control_generation,
        )?.answer;
        const candidate = answer
          ? yield* decodeJSON(ScopeSchema, answer, "scope clarification answer")
          : issue.scope;
        if (!completeScope(candidate)) {
          if (
            !e.decisions?.some(
              (d) => d.key === "scope-contract" && d.generation === e.control_generation,
            )
          ) {
            e = {
              ...e,
              decisions: yield* tryDomainValue(
                appendDecision,
                e.decisions,
                makeControllerDecision({
                  key: ObligationKey.make("scope-contract"),
                  generation: e.control_generation,
                  scope: e.workflow_policy,
                  question:
                    "Provide the scoped work contract as JSON with goal, nonempty acceptance array, and constraints array. This answer does not approve the scope.",
                  openedAt: yield* Clock.currentTimeMillis,
                }),
              ),
            };
          }
          e = yield* this.records.saveOwned(e, ["decisions"]);
          return { execution: e, ready: false };
        }
        scope = {
          schema_version: 1,
          revision: 1,
          contract: candidate,
          fingerprint: scopeIdentity(1, candidate),
        };
      }
      e = yield* this.records.saveOwned(
        { ...e, scope, plan_fingerprint: scope.fingerprint, resume_after_decision: undefined },
        ["scope", "plan_fingerprint", "resume_after_decision"],
      );
      return { execution: e, ready: true };
    },
  );
  validateRevision = Effect.fn("Scopes.validateRevision")(function* (e: Execution, input: Scope) {
    if (externalOwns(e))
      return yield* new WorkflowError(
        "EXTERNAL_CUSTODY",
        "Return external branch custody before admitting a native writer or changing its scope",
      );
    if (e.stop_status || e.current_phase === "interrupted")
      return yield* new WorkflowError(
        "SCOPE_PAUSED",
        "Resume paused work explicitly before revising its scope",
      );
    if (
      e.workflow_policy === "full-openspec" ||
      ["archiving", "delivering", "awaiting_merge", "cleaning", "completed"].includes(
        e.current_phase,
      )
    )
      return yield* new WorkflowError("SCOPE_PHASE", "Scope revision must precede delivery");
    return yield* decode(ScopeSchema, input, "scope revision");
  });
  revise = Effect.fn("Scopes.revise")(
    { self: this },
    function* (
      e: Execution,
      input: Scope,
      saveControl: (e: Execution) => Effect.Effect<Execution, CrewError>,
    ) {
      const contract = yield* this.validateRevision(e, input);
      yield* tryDomainValue(assertTransition, e, "awaiting_plan_approval", "scope");
      const revision = (e.scope?.revision ?? 0) + 1;
      const fingerprint = scopeIdentity(revision, contract);
      e = {
        ...(yield* tryDomainValue(() =>
          applyExecutionPatch(e, resetDeliveryArtifactsPatch({ clearReportArtifacts: true })),
        )),
        ...(e.scope && { scope_history: [...(e.scope_history ?? []), e.scope] }),
        ...(e.report_receipt && {
          report_history: [...(e.report_history ?? []), e.report_receipt],
        }),
        scope: { schema_version: 1, revision, contract, fingerprint },
        plan_fingerprint: fingerprint,
        capacity_observed_idle: true,
        decisions: e.decisions?.map((d) =>
          d.status === "open" ? { ...d, status: "superseded" } : d,
        ),
        current_phase: "awaiting_plan_approval",
      };
      return yield* saveControl(e);
    },
  );
}
