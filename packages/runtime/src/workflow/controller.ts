import { IssueId } from "../identities.ts";
import { Effect } from "effect";
import type {
  ControllerServices,
  ExecutionCommands,
  AdmissionCommands,
  VerificationCommands,
  ValidationCommands,
  ReportCommands,
  AttentionCommands,
  ObligationCommands,
  CommunicationCommands,
  ContextCommands,
  PublicationCommands,
} from "./public-api.ts";
import type { Queries } from "./queries.ts";
import { Visibility } from "../visibility/read-model.ts";
/** Public lifecycle commands and read-only queries; implementation adapters remain private. */
export class Controller {
  readonly queries: Queries;
  constructor(private services: ControllerServices) {
    this.queries = services.queries;
  }
  validation = (...args: Parameters<ValidationCommands["command"]>) =>
    this.services.validation.command(...args);
  close = () => this.services.execution.close;
  prAction = (...args: Parameters<VerificationCommands["prAction"]>) =>
    this.services.verification.prAction(...args);
  feedbackDisposition = (...args: Parameters<VerificationCommands["feedbackDisposition"]>) =>
    this.services.verification.feedbackDisposition(...args);
  correct = (...args: Parameters<VerificationCommands["correct"]>) =>
    this.services.verification.correct(...args);
  reviewerSuggestions = (...args: Parameters<VerificationCommands["reviewerSuggestions"]>) =>
    this.services.verification.reviewerSuggestions(...args);
  findings = (...args: Parameters<VerificationCommands["findings"]>) =>
    this.services.verification.findings(...args);
  visualArtifact = (...args: Parameters<ReportCommands["readArtifact"]>) =>
    this.services.reports.readArtifact(...args);
  exportVisualDocument = (...args: Parameters<ReportCommands["exportDocument"]>) =>
    this.services.reports.exportDocument(...args);
  readVisualExport = (...args: Parameters<ReportCommands["readExport"]>) =>
    this.services.reports.readExport(...args);
  visualDocument = (...args: Parameters<ReportCommands["readDocument"]>) =>
    this.services.reports.readDocument(...args);
  saveVisualSurface = (
    ...args: [
      Parameters<ReportCommands["saveSurface"]>[0],
      Parameters<ReportCommands["saveSurface"]>[1],
      Parameters<ReportCommands["saveSurface"]>[2],
    ]
  ) =>
    this.services.reports.saveSurface(...args, (selection) =>
      new Visibility(this).binding({
        issue_ids: selection.ids.map((id) => IssueId.make(id)),
        include_population: selection.unfiltered,
      }),
    );
  reconcileReports = () => this.services.reports.recover();
  visualReport = (...args: Parameters<ReportCommands["generate"]>) =>
    args[2].surface
      ? this.saveVisualSurface(args[0], args[1], args[2])
      : this.services.reports.generate(...args);
  researchReport = (...args: Parameters<ReportCommands["submit"]>) =>
    this.services.reports.submit(...args);
  reviseScope = (...args: Parameters<ExecutionCommands["reviseScope"]>) =>
    this.services.execution.reviseScope(...args);
  guardAttention = (...args: Parameters<AttentionCommands["guard"]>) =>
    this.services.attention.guard(...args);
  supervise = () => this.services.leads.scan().pipe(Effect.andThen(this.services.attention.scan()));
  readonly lead = () => this.services.leads;
  observeWorker = (...args: Parameters<AttentionCommands["observe"]>) =>
    this.services.attention.observe(...args);
  attentionDisposition = (...args: Parameters<AttentionCommands["disposition"]>) =>
    this.services.attention.disposition(...args);
  waitDisposition = (...args: Parameters<ObligationCommands["supersedeWait"]>) =>
    this.services.obligations.supersedeWait(...args);
  workerQuestion = (...args: Parameters<ObligationCommands["question"]>) =>
    this.services.obligations.question(...args);
  workerProgress = (...args: Parameters<ObligationCommands["progress"]>) =>
    this.services.obligations.progress(...args);
  workerWait = (...args: Parameters<ObligationCommands["wait"]>) =>
    this.services.obligations.wait(...args);
  workMessage = (...args: Parameters<ExecutionCommands["workMessage"]>) =>
    this.services.execution.workMessage(...args);
  workerReply = (...args: Parameters<CommunicationCommands["reply"]>) =>
    this.services.communication.reply(...args);
  refuseResolvedReminder = (...args: Parameters<CommunicationCommands["refuseResolvedReminder"]>) =>
    this.services.communication.refuseResolvedReminder(...args);
  decision = (...args: Parameters<ObligationCommands["resolve"]>) =>
    this.services.obligations.resolve(...args);
  get = (...args: Parameters<Queries["get"]>) => this.queries.get(...args);
  ready = () => this.queries.ready();
  diagnostics = (...args: Parameters<Queries["diagnostics"]>) => this.queries.diagnostics(...args);
  recordSupervisor = (...args: Parameters<ExecutionCommands["recordSupervisor"]>) =>
    this.services.execution.recordSupervisor(...args);
  workerContextRequest = (...args: Parameters<ContextCommands["request"]>) =>
    this.services.contexts.request(...args);
  recordWorkerTools = (...args: Parameters<ExecutionCommands["recordWorkerTools"]>) =>
    this.services.execution.recordWorkerTools(...args);
  createWork = (...args: Parameters<AdmissionCommands["createWork"]>) =>
    this.services.admission.createWork(...args);
  createWorkBatch = (...args: Parameters<AdmissionCommands["createWorkBatch"]>) =>
    this.services.admission.createWorkBatch(...args);
  recordWorkerFailure = (...args: Parameters<ExecutionCommands["recordWorkerFailure"]>) =>
    this.services.execution.recordWorkerFailure(...args);
  start = (...args: Parameters<ExecutionCommands["start"]>) =>
    this.services.execution.start(...args);
  advance = (...args: Parameters<ExecutionCommands["advance"]>) =>
    this.services.execution.advance(...args);
  reviewReport = (...args: Parameters<ExecutionCommands["reviewReport"]>) =>
    this.services.execution.reviewReport(...args);
  approve = (...args: Parameters<ExecutionCommands["approve"]>) =>
    this.services.execution.approve(...args);
  finish = (...args: Parameters<PublicationCommands["finish"]>) =>
    this.services.publication.finish(...args);
  control = (...args: Parameters<ExecutionCommands["control"]>) =>
    this.services.execution.control(...args);
  reconcile = (...args: Parameters<ExecutionCommands["reconcile"]>) =>
    this.services.execution.reconcile(...args);
}
