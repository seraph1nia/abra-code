import type { Effect } from "effect";
import type { ContentHash, IssueId, RequestId, SessionId } from "@abracode/contracts/identities";
import type { ReportProducer } from "@abracode/contracts/presentation/report-document";
import type { ReportExportSchema } from "@abracode/contracts/presentation/report-export-contract";
import type { BindingRead, BindingSelection } from "@abracode/contracts/web/bindings";
import type {
  ReportInputSchema,
  ReportReceiptSchema,
  VisualBuild,
  VisualRenderRequestSchema,
} from "@abracode/contracts/workflow/report-contracts";
import type { CrewError, Execution } from "../domain.ts";

type ReportResult<A> = Effect.Effect<A, CrewError>;
type ReportReceipt = typeof ReportReceiptSchema.Type;
type ReportExportReceipt = typeof ReportExportSchema.Type;

/** Minimal typed port for workflow consumers; decouples workflow from reporting internals. */
export interface ReportPort {
  submit(
    session: SessionId,
    input: typeof ReportInputSchema.Type,
  ): ReportResult<ReportReceipt | (ReportReceipt & { visual: VisualBuild })>;
  publish(e: Execution): ReportResult<ReportReceipt>;
  verify(e: Execution): ReportResult<void>;
  read(e: Execution): ReportResult<string>;
  generate(
    session: SessionId,
    issue: IssueId,
    request: typeof VisualRenderRequestSchema.Type,
    producer?: ReportProducer,
  ): ReportResult<VisualBuild>;
  saveSurface(
    session: SessionId,
    issue: IssueId,
    raw: typeof VisualRenderRequestSchema.Type,
    observe: (selection: BindingSelection) => ReportResult<BindingRead>,
  ): ReportResult<VisualBuild>;
  exportDocument(
    issue: IssueId,
    request: RequestId,
    hash: ContentHash,
  ): ReportResult<ReportExportReceipt>;
  readExport(
    issue: IssueId,
    request: RequestId,
    hash: ContentHash,
    exporter: ContentHash,
  ): ReportResult<ReportExportReceipt & { html: string }>;
  readDocument(
    issue: IssueId,
    request: RequestId,
    hash: ContentHash,
  ): ReportResult<{ json: string; hash: ContentHash; bytes: number }>;
  readArtifact(
    issue: IssueId,
    request: RequestId,
  ): ReportResult<{ html: string; hash: ContentHash; bytes: number }>;
  readonly reconcile: ReportResult<void>;
}
