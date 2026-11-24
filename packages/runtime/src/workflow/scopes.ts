import { externalOwns } from "@abracode/contracts/validation/contracts";
import { ObligationKey } from "@abracode/contracts/identities";
import { Clock, Effect } from "effect";
import { type Execution, type Issue, CrewError } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { decode, decodeJSON } from "../decode.ts";
import { ScopeSchema, completeScope, scopeIdentity, type Scope } from "../work/scope.ts";
import { type Records } from "../storage/store.ts";
import { appendDecision, makeControllerDecision } from "./decision-ledger.ts";
import { assertTransition, resetDeliveryArtifacts } from "./transitions.ts";
export { scopeIdentity } from "../work/scope.ts";

export class Scopes {
  constructor(private records: Records) {}
  initialize = Effect.fn("Scopes.initialize")(
    function* (this: Scopes, e: Execution, issue: Issue) {
      if (!e.scope) {
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
            e.decisions = appendDecision(
              e.decisions,
              makeControllerDecision({
                key: ObligationKey.make("scope-contract"),
                generation: e.control_generation,
                scope: e.workflow_policy,
                question:
                  "Provide the scoped work contract as JSON with goal, nonempty acceptance array, and constraints array. This answer does not approve the scope.",
                openedAt: yield* Clock.currentTimeMillis,
              }),
            );
          }
          yield* this.records.saveOwned(e, ["decisions"]);
          return false;
        }
        e.scope = {
          schema_version: 1,
          revision: 1,
          contract: candidate,
          fingerprint: scopeIdentity(1, candidate),
        };
      }
      e.plan_fingerprint = e.scope.fingerprint;
      delete e.resume_after_decision;
      yield* this.records.saveOwned(e, ["scope", "plan_fingerprint", "resume_after_decision"]);
      return true;
    }.bind(this),
    domainEffect,
  );
  validateRevision = Effect.fn("Scopes.validateRevision")(function* (e: Execution, input: Scope) {
    if (externalOwns(e))
      return yield* new CrewError(
        "EXTERNAL_CUSTODY",
        "Return external branch custody before admitting a native writer or changing its scope",
      );
    if (!(!e.stop_status && e.current_phase !== "interrupted"))
      return yield* new CrewError(
        "SCOPE_PAUSED",
        "Resume paused work explicitly before revising its scope",
      );
    if (
      !(
        e.workflow_policy !== "full-openspec" &&
        !["archiving", "delivering", "awaiting_merge", "cleaning", "completed"].includes(
          e.current_phase,
        )
      )
    )
      return yield* new CrewError("SCOPE_PHASE", "Scope revision must precede delivery");
    return yield* decode(ScopeSchema, input, "scope revision");
  }, domainEffect);
  revise = Effect.fn("Scopes.revise")(
    function* (
      this: Scopes,
      e: Execution,
      input: Scope,
      saveControl: (e: Execution) => Effect.Effect<unknown, CrewError>,
    ) {
      const contract = yield* this.validateRevision(e, input);
      assertTransition(e.current_phase, "awaiting_plan_approval");
      if (e.scope) e.scope_history = [...(e.scope_history ?? []), e.scope];
      const revision = (e.scope?.revision ?? 0) + 1;
      e.scope = {
        schema_version: 1,
        revision,
        contract,
        fingerprint: scopeIdentity(revision, contract),
      };
      e.plan_fingerprint = e.scope.fingerprint;
      if (e.report_receipt) e.report_history = [...(e.report_history ?? []), e.report_receipt];
      resetDeliveryArtifacts(e, { clearReportArtifacts: true });
      e.capacity_observed_idle = true;
      e.decisions = e.decisions?.map((d) =>
        d.status === "open" ? { ...d, status: "superseded" as const } : d,
      );
      e.current_phase = "awaiting_plan_approval";
      yield* saveControl(e);
      return e;
    }.bind(this),
    domainEffect,
  );
}
