import { WorkflowError } from "../../errors.ts";
import { controlLead } from "./registration.ts";
import { Effect } from "effect";
import { type MessageId, type SessionId } from "@abracode/contracts/identities";
import { type MessageSendSchema } from "@abracode/contracts/workflow/message-contracts";
import { type Config, CrewError } from "../../domain.ts";
import { type Runtime } from "../../opencode/runtime.ts";
import { type Locks } from "../../storage/lock.ts";
import { type Records } from "../../storage/store.ts";
import { type BatchInput, type BatchResult } from "../../work/batch.ts";
import { type WorkGraph } from "../../work/graph.ts";
import { readLeads, type LeadAction, type LeadControl } from "./contracts.ts";
import {
  createLeadRequest,
  executeLeadAction,
  verifyLeadPrompt,
  type LeadControlDeps,
} from "./control.ts";
import { LeadStore } from "./store.ts";
import { LeadLifecycle } from "./lifecycle.ts";
/** Management principals are separate from phase workers. Native sessions own context;
 * this bounded ledger owns only scope, routing and proposals, under controller locks. */
export class LeadActions {
  constructor(
    private config: Config,
    private records: Records,
    private work: WorkGraph,
    private runtime: Runtime,
    private locks: Locks,
    private createBatch: (
      input: BatchInput,
      parent: SessionId,
    ) => Effect.Effect<BatchResult, CrewError>,
    private message: (
      input: typeof MessageSendSchema.Type,
      parent: SessionId,
    ) => Effect.Effect<unknown, CrewError>,
    private memory?: import("../../memory/service.ts").AgentMemory,
  ) {
    this.store = new LeadStore(records, work);
    this.lifecycle = new LeadLifecycle(
      config,
      records,
      runtime,
      locks,
      this.store,
      (lead, issue, id, text) => createLeadRequest(this.controlDeps(), lead, issue, id, text),
    );
  }
  private readonly store: LeadStore;
  private readonly lifecycle: LeadLifecycle;
  principal = (session: SessionId) => this.store.principal(session);
  scan = () => this.lifecycle.scan();

  private controlDeps(): LeadControlDeps {
    return {
      config: this.config,
      records: this.records,
      work: this.work,
      runtime: this.runtime,
      locks: this.locks,
      createBatch: this.createBatch,
      message: this.message,
      memory: this.memory,
      commit: (fn) => this.store.commit(fn),
      save: (record) => this.store.save(record),
      principal: this.store.principal,
      current: (session, revision) => this.store.current(session, revision),
      scoped: (lead, issue) => this.store.scoped(lead, issue),
      root: (parent) => this.root(parent),
      reconcileOne: this.lifecycle.reconcileOne,
    };
  }

  private root(parent: SessionId) {
    return Effect.gen({ self: this }, function* () {
      const supervisor = yield* this.records.supervisor;
      const leads = yield* readLeads(this.records);
      if (
        supervisor !== parent ||
        leads.some((l) => l.session_id === parent || l.retired_sessions.includes(parent))
      )
        return yield* new WorkflowError("ABRA_REQUIRED", "Retained parent Abra required");
      const state = yield* this.runtime.session(parent);
      if (state.agent !== "abra" || state.directory !== this.config.home)
        return yield* new WorkflowError("ABRA_REQUIRED", "Central Abra required");
      return leads;
    });
  }

  control = Effect.fn("Leads.control")(
    { self: this },
    function* (parent: SessionId, raw: LeadControl) {
      return yield* controlLead(this.controlDeps(), parent, raw);
    },
  );

  action = Effect.fn("Leads.action")(
    { self: this },
    function* (session: SessionId, raw: LeadAction) {
      return yield* executeLeadAction(this.controlDeps(), session, raw);
    },
  );

  prompt = (session: SessionId, id: MessageId, text: string, delivery: string) =>
    verifyLeadPrompt(this.controlDeps(), session, id, text, delivery);
}
