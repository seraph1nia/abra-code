import { exactParseOptions } from "@abracode/contracts/primitives";
import {
  ScopedMemorySearch,
  ScopedMemoryRead,
  MemoryPage,
  MemoryBody,
  MemoryPublication,
  MemoryReference,
} from "@abracode/contracts/visibility/memory";
import { PublicationPage, PublicationQuery } from "@abracode/contracts/presentation/contracts";
import {
  ReviewSelectionSchema,
  ReviewViewSchema,
  ReviewListQuerySchema,
  ReviewListSchema,
  ReviewAssetQuerySchema,
  ReviewAssetDataSchema,
  ReviewSubmitSchema,
  ReviewReceiptSchema,
  ReviewResponseQuerySchema,
  ReviewReceiptLookupSchema,
} from "@abracode/contracts/web/reviews";
import { PrepareDiagramSelectionSchema } from "@abracode/contracts/web/diagram-actions";
import { AgentCatalogSchema } from "@abracode/contracts/web/agent-settings";
import { DiagramPreparationSchema } from "@abracode/contracts/presentation/diagrams";
import { ReportExportSchema } from "@abracode/contracts/presentation/report-export-contract";
import { Rpc } from "@opencode/plugin/rpc";
import { Schema } from "effect";
import { SessionId, IssueId, MessageId } from "@abracode/contracts/identities";
import { SurfaceId } from "@abracode/contracts/web/catalog";
import { DocumentArtifactSchema, ArtifactSummarySchema } from "@abracode/contracts/web/wire";
import {
  SaveSurfaceSchema,
  ExportDocumentSchema,
  ReadExportSchema,
} from "@abracode/contracts/web/report-actions";
import { ResourceSelectionSchema } from "@abracode/contracts/web/resources";
import {
  ReceiptSchema,
  ReceiptLookupSchema,
  ReceiptQuerySchema,
  SubmissionSchema,
  SurfaceEntrySchema,
  SurfaceIndexEntrySchema,
  ProjectsSchema,
  CheckpointSchema,
  NativeHistorySchema,
  PresentationPageSchema,
} from "@abracode/contracts/web/workspace-wire";

const errors = { refused: Schema.Struct({ code: Schema.String }) };
const method = <I, O>(input: Schema.Codec<I, unknown>, output: Schema.Codec<O, unknown>) => ({
  input: input.annotate(exactParseOptions),
  output: output,
  errors,
});
/** Authenticated native RPC, never mounted as a generic browser proxy. */
export const webGateway = Rpc.define({
  id: "abracode-web",
  events: {},
  methods: {
    observeSections: method(
      Schema.Struct({
        session_id: SessionId,
        receipts: Schema.Boolean,
        surfaces: Schema.Boolean,
        projects: Schema.Boolean,
        message_ids: Schema.optionalKey(Schema.Array(MessageId).check(Schema.isMaxLength(100))),
      }),
      Schema.Struct({
        receipts: Schema.optionalKey(Schema.Array(ReceiptSchema).check(Schema.isMaxLength(100))),
        surfaces: Schema.optionalKey(Schema.Array(SurfaceIndexEntrySchema)),
        presentations: Schema.optionalKey(PresentationPageSchema),
        projects: Schema.optionalKey(ProjectsSchema),
      }),
    ),
    memorySearch: method(
      Schema.Struct({ session_id: SessionId, ...ScopedMemorySearch.fields }),
      MemoryPage,
    ),
    memoryRead: method(
      Schema.Struct({ session_id: SessionId, ...ScopedMemoryRead.fields }),
      MemoryBody,
    ),
    memoryPublish: method(
      Schema.Struct({ session_id: SessionId, ...MemoryPublication.fields }),
      MemoryReference,
    ),
    memoryEnabled: method(Schema.Struct({ session_id: SessionId }), Schema.Boolean),
    agents: method(Schema.Struct({ session_id: SessionId }), AgentCatalogSchema),
    reviewReceipt: method(
      Schema.Struct({ session_id: SessionId, ...ReviewResponseQuerySchema.fields }),
      ReviewReceiptLookupSchema,
    ),
    reviewList: method(
      Schema.Struct({ session_id: SessionId, ...ReviewListQuerySchema.fields }),
      ReviewListSchema,
    ),
    review: method(
      Schema.Struct({ session_id: SessionId, ...ReviewSelectionSchema.fields }),
      ReviewViewSchema,
    ),
    reviewAsset: method(
      Schema.Struct({ session_id: SessionId, ...ReviewAssetQuerySchema.fields }),
      ReviewAssetDataSchema,
    ),
    reviewSubmit: method(
      Schema.Struct({ session_id: SessionId, ...ReviewSubmitSchema.fields }),
      ReviewReceiptSchema,
    ),
    prepareDiagrams: method(
      Schema.Struct({ session_id: SessionId, selection: PrepareDiagramSelectionSchema }),
      DiagramPreparationSchema,
    ),
    publications: method(
      Schema.Struct({ session_id: SessionId, ...PublicationQuery.fields }),
      PublicationPage,
    ),
    surface: method(
      Schema.Struct({
        session_id: SessionId,
        surface_id: SurfaceId,
        revision: Schema.Int.check(Schema.isGreaterThan(0)),
      }),
      SurfaceEntrySchema,
    ),
    presentations: method(
      Schema.Struct({
        session_id: SessionId,
        message_ids: Schema.Array(MessageId).check(Schema.isMaxLength(100)),
      }),
      PresentationPageSchema,
    ),
    resolve: method(
      Schema.Struct({ session_id: SessionId, target: ResourceSelectionSchema }),
      ResourceSelectionSchema,
    ),
    submit: method(
      Schema.Struct({
        session_id: SessionId,
        ...SubmissionSchema.fields,
      }),
      ReceiptSchema,
    ),
    history: method(
      Schema.Struct({
        session_id: SessionId,
        issue_id: IssueId,
        artifact_offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
      }),
      NativeHistorySchema,
    ),
    artifactDocument: method(
      Schema.Struct({
        session_id: SessionId,
        ...ExportDocumentSchema.fields,
      }),
      DocumentArtifactSchema,
    ),
    artifactSummary: method(
      Schema.Struct({
        session_id: SessionId,
        ...ExportDocumentSchema.fields,
      }),
      ArtifactSummarySchema,
    ),
    exportDocument: method(
      Schema.Struct({ session_id: SessionId, ...ExportDocumentSchema.fields }),
      ReportExportSchema,
    ),
    readExport: method(
      Schema.Struct({ session_id: SessionId, ...ReadExportSchema.fields }),
      Schema.Struct({
        ...ReportExportSchema.fields,
        html: Schema.String.check(Schema.isMaxLength(8 * 1024 * 1024)),
      }),
    ),
    saveSurface: method(
      Schema.Struct({ session_id: SessionId, ...SaveSurfaceSchema.fields }),
      ArtifactSummarySchema,
    ),
    receipt: method(
      Schema.Struct({ session_id: SessionId, ...ReceiptQuerySchema.fields }),
      ReceiptLookupSchema,
    ),
    projects: method(Schema.Struct({ session_id: SessionId }), ProjectsSchema),
    checkpoint: method(
      Schema.Struct({ session_id: SessionId, form_id: Schema.String }),
      CheckpointSchema,
    ),
  },
});
