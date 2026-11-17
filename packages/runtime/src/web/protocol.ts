import { ReviewSelectionSchema, ReviewViewSchema, ReviewListQuerySchema, ReviewListSchema, ReviewAssetQuerySchema, ReviewAssetDataSchema, ReviewSubmitSchema, ReviewReceiptSchema } from "@abracode/contracts/web/reviews";
import { PrepareDiagramSelectionSchema } from "@abracode/contracts/web/diagram-actions";
import { DiagramPreparationSchema } from "@abracode/contracts/presentation/diagrams";
import { ReportExportSchema } from "../presentation/report-export-contract.ts";
import { Rpc } from "@opencode/plugin/rpc";
import { Schema } from "effect";
import { SessionId, IssueId, RequestId, MessageId, ContentHash } from "../identities.ts";
import { ComponentId } from "./catalog.ts";
import { ArtifactSchema, DocumentArtifactSchema, ArtifactSummarySchema } from "./wire.ts";
import { SaveSurfaceSchema, ExportDocumentSchema, ReadExportSchema } from "./report-actions.ts";
import { ResourceSelectionSchema } from "./resources.ts";
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
} from "./workspace-wire.ts";

const errors = { refused: Schema.toStandardSchemaV1(Schema.Struct({ code: Schema.String })) };
const method = <I, O>(input: Schema.Codec<I, unknown>, output: Schema.Codec<O, unknown>) => ({
  input: Schema.toStandardSchemaV1(input, {
    parseOptions: { onExcessProperty: "error", reportInput: false },
  }),
  output: Schema.toStandardSchemaV1(output),
  errors,
});
/** Authenticated native RPC, never mounted as a generic browser proxy. */
export const webGateway = Rpc.define({
  id: "abracode-web",
  events: {},
  methods: {
    reviewList:method(Schema.Struct({session_id:SessionId,...ReviewListQuerySchema.fields}),ReviewListSchema),
    review:method(Schema.Struct({session_id:SessionId,...ReviewSelectionSchema.fields}),ReviewViewSchema),
    reviewAsset:method(Schema.Struct({session_id:SessionId,...ReviewAssetQuerySchema.fields}),ReviewAssetDataSchema),
    reviewSubmit:method(Schema.Struct({session_id:SessionId,...ReviewSubmitSchema.fields}),ReviewReceiptSchema),
    prepareDiagrams: method(
      Schema.Struct({ session_id: SessionId, selection: PrepareDiagramSelectionSchema }),
      DiagramPreparationSchema,
    ),
    surface: method(
      Schema.Struct({
        session_id: SessionId,
        surface_id: ComponentId,
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
    artifact: method(
      Schema.Struct({ session_id: SessionId, issue_id: IssueId, request_id: RequestId }),
      ArtifactSchema,
    ),
    artifactDocument: method(
      Schema.Struct({
        session_id: SessionId,
        issue_id: IssueId,
        request_id: RequestId,
        hash: ContentHash,
      }),
      DocumentArtifactSchema,
    ),
    artifactSummary: method(
      Schema.Struct({
        session_id: SessionId,
        issue_id: IssueId,
        request_id: RequestId,
        hash: ContentHash,
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
    receipts: method(Schema.Struct({ session_id: SessionId }), Schema.Array(ReceiptSchema)),
    surfaces: method(
      Schema.Struct({ session_id: SessionId }),
      Schema.Array(SurfaceIndexEntrySchema),
    ),
    projects: method(Schema.Struct({ session_id: SessionId }), ProjectsSchema),
    checkpoint: method(
      Schema.Struct({ session_id: SessionId, form_id: Schema.String }),
      CheckpointSchema,
    ),
  },
});
