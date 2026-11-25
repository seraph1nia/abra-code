import type { Effect } from "effect";
import type { CrewError, Execution, WorkerModel } from "../domain.ts";
import type { FormId, IssueId, SessionId, ToolName } from "@abracode/contracts/identities";
import type { BindingRead, BindingSelection } from "@abracode/contracts/web/bindings";
import type { Scope } from "../work/scope.ts";
import type { WorkInput } from "../work/intake.ts";
import type { BatchInput, BatchResultSchema } from "../work/batch.ts";
import type { Issue } from "../work/model.ts";
import type { Queries } from "./queries.ts";
import type { PRFeedback } from "./pr-feedback.ts";
import type { ExternalValidation } from "./external-validation.ts";
import type { Reports } from "../reporting/reports.ts";
import type { AttentionService } from "./attention.ts";
import type { Obligations } from "./obligations.ts";
import type { Messages } from "./messages.ts";
import type { WorkerContexts } from "./worker-context.ts";
import type { WorkerSessions } from "./sessions.ts";
import type { CodingChecks } from "./checks.ts";
import type { Leads } from "./leads.ts";

/** Public ports name domain responsibilities. Composition supplies implementations;
 * callers never traverse advancement's private dependency graph. */
type Result<A> = Effect.Effect<A, CrewError>;
export type ReadyWork = Effect.Success<ReturnType<Queries["ready"]>>[number];
export interface AdmissionCommands {
  createWork(
    input: WorkInput,
    supervisor: SessionId,
  ): Result<{ issue: Issue; readiness: ReadyWork | undefined }>;
  createWorkBatch(
    input: BatchInput,
    supervisor: SessionId,
  ): Result<
    Omit<typeof BatchResultSchema.Type, "tasks"> & {
      tasks: Array<{ client_key: string; issue: Issue; readiness: ReadyWork | undefined }>;
    }
  >;
}
export interface ExecutionCommands {
  start(id: IssueId, supervisor?: SessionId): Result<Execution>;
  advance(id: IssueId): Result<Execution>;
  approve(
    id: IssueId,
    kind: "plan" | "merge",
    supervisor: SessionId,
  ): Result<Execution | { execution: Execution; approval_required: boolean; form_id: FormId }>;
  reviseScope(id: IssueId, scope: Scope): Result<Execution>;
  reconcile(id?: IssueId): Result<Execution[]>;
  recordSupervisor(session: SessionId): Result<void>;
  recordWorkerTools(session: SessionId, model: WorkerModel, names: ToolName[]): Result<void>;
  recordWorkerFailure: WorkerSessions["recordFailure"];
  reviewChanges: CodingChecks["reviewChanges"];
  reviewReport: CodingChecks["reviewReport"];
  control(
    id: IssueId,
    action:
      | "pause"
      | "interrupt"
      | "resume"
      | "retry"
      | "steer"
      | "advance"
      | "replan"
      | "recover_planning",
    text?: string,
    request?: { id: import("@abracode/contracts/identities").RequestId; sender: SessionId },
  ): Result<Execution>;
  workMessage(
    input: typeof import("@abracode/contracts/workflow/message-contracts").MessageSendSchema.Type,
    sender: SessionId,
  ): Result<
    typeof import("@abracode/contracts/workflow/message-contracts").MessageIntentSchema.Type
  >;
  readonly close: Effect.Effect<void>;
}
export interface PublicationCommands {
  finish(id: IssueId): Result<Execution>;
}
export interface VerificationCommands extends Pick<
  PRFeedback,
  "correct" | "prAction" | "feedbackDisposition" | "reviewerSuggestions" | "findings"
> {}
export interface ValidationCommands extends Pick<ExternalValidation, "command"> {}
export interface ReportCommands extends Pick<
  Reports,
  | "exportDocument"
  | "readExport"
  | "readDocument"
  | "saveSurface"
  | "recover"
  | "generate"
  | "submit"
> {}
export interface AttentionCommands extends Pick<
  AttentionService,
  "guard" | "observe" | "disposition" | "scan"
> {}
export interface ObligationCommands extends Pick<
  Obligations,
  "supersedeWait" | "question" | "progress" | "wait" | "resolve"
> {}
export interface CommunicationCommands extends Pick<Messages, "reply" | "refuseResolvedReminder"> {}
export interface ContextCommands extends Pick<WorkerContexts, "request"> {}
export interface LeadCommands extends Pick<
  Leads,
  "principal" | "control" | "action" | "scan" | "prompt"
> {}
export interface ControllerServices {
  readonly answerSelection: (
    session: import("@abracode/contracts/identities").SessionId,
    request: import("@abracode/contracts/identities").WebSubmissionId,
    issue: import("@abracode/contracts/identities").IssueId,
    answer: string,
  ) => ReturnType<typeof import("./selected-requests.ts").answerSelection>;
  readonly memory: import("../memory/service.ts").AgentMemory;
  readonly thoughts: import("../work/thoughts.ts").PersonalThoughts;
  readonly inbox: import("../work/github-inbox.ts").GithubInbox;
  readonly queries: Queries;
  readonly admission: AdmissionCommands;
  readonly execution: ExecutionCommands;
  readonly publication: PublicationCommands;
  readonly verification: VerificationCommands;
  readonly validation: ValidationCommands;
  readonly reports: ReportCommands;
  readonly attention: AttentionCommands;
  readonly obligations: ObligationCommands;
  readonly communication: CommunicationCommands;
  readonly contexts: ContextCommands;
  readonly leads: LeadCommands;
  readonly readBinding?: (selection: BindingSelection) => Result<BindingRead>;
}
