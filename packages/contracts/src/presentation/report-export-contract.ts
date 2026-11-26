import { Schema } from "effect";
import { ContentHash } from "../identities.ts";
export const portableRendererABI = "abracode-portable-renderer-v4";
export const maximumPortableHTMLBytes = 8 * 1024 * 1024;
export const ReportExportSchema = Schema.Struct({
  document_hash: ContentHash,
  exporter_hash: ContentHash,
  hash: ContentHash,
  bytes: Schema.Int.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(maximumPortableHTMLBytes),
  ),
});
