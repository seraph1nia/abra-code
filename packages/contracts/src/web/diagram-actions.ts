import { Schema } from "effect";
import { IssueId, RequestId, ContentHash } from "../identities.ts";
import { ComponentId } from "./catalog.ts";

export const PrepareDiagramSelectionSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("surface"),
    surface_id: ComponentId,
    revision: Schema.Int.check(Schema.isGreaterThan(0)),
    hash: ContentHash,
  }),
  Schema.Struct({
    kind: Schema.Literal("report"),
    issue_id: IssueId,
    request_id: RequestId,
    hash: ContentHash,
  }),
]).annotate({ parseOptions: { onExcessProperty: "error" }, reportInput: false });
export type PrepareDiagramSelection = typeof PrepareDiagramSelectionSchema.Type;
