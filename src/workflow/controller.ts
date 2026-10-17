import { Advancement } from "./advancement.ts";
/** Public lifecycle commands and read-only queries; implementation adapters remain private. */
export class Controller {
  private workflow: Advancement;
  readonly queries: Advancement["queries"];
  constructor(...args: ConstructorParameters<typeof Advancement>) {
    this.workflow = new Advancement(...args);
    this.queries = this.workflow.queries;
  }
  validation = (...args: Parameters<Advancement["external"]["command"]>) =>
    this.workflow.external.command(...args);
  close = () => this.workflow.close();
  prAction = (...args: Parameters<Advancement["prFeedback"]["prAction"]>) =>
    this.workflow.prFeedback.prAction(...args);
  feedbackDisposition = (...args: Parameters<Advancement["prFeedback"]["feedbackDisposition"]>) =>
    this.workflow.prFeedback.feedbackDisposition(...args);
  correct = (...args: Parameters<Advancement["prFeedback"]["correct"]>) =>
    this.workflow.prFeedback.correct(...args);
  reviewerSuggestions = (...args: Parameters<Advancement["prFeedback"]["reviewerSuggestions"]>) =>
    this.workflow.prFeedback.reviewerSuggestions(...args);
  findings = (...args: Parameters<Advancement["prFeedback"]["findings"]>) =>
    this.workflow.prFeedback.findings(...args);
  researchReport = (...args: Parameters<Advancement["reports"]["submit"]>) =>
    this.workflow.reports.submit(...args);
  reviseScope = (...args: Parameters<Advancement["reviseScope"]>) =>
    this.workflow.reviseScope(...args);
  guardAttention = (...args: Parameters<Advancement["attention"]["guard"]>) =>
    this.workflow.attention.guard(...args);
  supervise = (...args: Parameters<Advancement["attention"]["scan"]>) =>
    this.workflow.attention.scan(...args);
  observeWorker = (...args: Parameters<Advancement["attention"]["observe"]>) =>
    this.workflow.attention.observe(...args);
  attentionDisposition = (...args: Parameters<Advancement["attention"]["disposition"]>) =>
    this.workflow.attention.disposition(...args);
  waitDisposition = (...args: Parameters<Advancement["obligations"]["supersedeWait"]>) =>
    this.workflow.obligations.supersedeWait(...args);
  workerQuestion = (...args: Parameters<Advancement["obligations"]["question"]>) =>
    this.workflow.obligations.question(...args);
  workerProgress = (...args: Parameters<Advancement["obligations"]["progress"]>) =>
    this.workflow.obligations.progress(...args);
  workerWait = (...args: Parameters<Advancement["obligations"]["wait"]>) =>
    this.workflow.obligations.wait(...args);
  decision = (...args: Parameters<Advancement["obligations"]["resolve"]>) =>
    this.workflow.obligations.resolve(...args);
  get = (...args: Parameters<Advancement["get"]>) => this.queries.get(...args);
  ready = () => this.queries.ready();
  diagnostics = (...args: Parameters<Advancement["diagnostics"]>) =>
    this.queries.diagnostics(...args);
  recordSupervisor = (...args: Parameters<Advancement["recordSupervisor"]>) =>
    this.workflow.recordSupervisor(...args);
  workerContextRequest = (...args: Parameters<Advancement["workerContexts"]["request"]>) =>
    this.workflow.workerContexts.request(...args);
  recordWorkerTools = (...args: Parameters<Advancement["recordWorkerTools"]>) =>
    this.workflow.recordWorkerTools(...args);
  createWork = (...args: Parameters<Advancement["createWork"]>) =>
    this.workflow.createWork(...args);
  recordWorkerFailure = (...args: Parameters<Advancement["recordWorkerFailure"]>) =>
    this.workflow.recordWorkerFailure(...args);
  start = (...args: Parameters<Advancement["start"]>) => this.workflow.start(...args);
  advance = (...args: Parameters<Advancement["advance"]>) => this.workflow.advance(...args);
  reviewReport = (...args: Parameters<Advancement["reviewReport"]>) =>
    this.workflow.reviewReport(...args);
  approve = (...args: Parameters<Advancement["approve"]>) => this.workflow.approve(...args);
  finish = (...args: Parameters<Advancement["finish"]>) => this.workflow.finish(...args);
  control = (...args: Parameters<Advancement["control"]>) => this.workflow.control(...args);
  reconcile = (...args: Parameters<Advancement["reconcile"]>) => this.workflow.reconcile(...args);
}
