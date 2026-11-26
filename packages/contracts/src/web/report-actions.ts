import { Schema } from "effect";
import { IssueId, RequestId, ContentHash } from "../identities.ts";
import { SurfaceId } from "./catalog.ts";
export const SaveSurfaceSchema = Schema.Struct({
  issue_id: IssueId,
  request_id: RequestId,
  surface_id: SurfaceId,
  revision: Schema.Int.check(Schema.isGreaterThan(0)),
  title: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(16384))),
}).annotate({ parseOptions: { onExcessProperty: "error" }, reportInput: false });

export const ExportDocumentSchema = Schema.Struct({
  issue_id: IssueId,
  request_id: RequestId,
  hash: ContentHash,
}).annotate({ parseOptions: { onExcessProperty: "error" }, reportInput: false });
export const ReadExportSchema = Schema.Struct({
  ...ExportDocumentSchema.fields,
  exporter_hash: ContentHash,
}).annotate({ parseOptions: { onExcessProperty: "error" }, reportInput: false });
