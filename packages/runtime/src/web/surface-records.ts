import { collectDiagrams } from "@abracode/contracts/presentation/diagrams";
import { presentationHash } from "../presentation/identity.ts";
import { Schema } from "effect";
import { SurfaceRecordSchema, type UnavailableSurfaceSchema } from "./workspace-wire.ts";
import { normalizeSurface } from "./surfaces.ts";
import type { SurfaceRecord } from "./contracts.ts";

/** A corrupt saved view is isolated; the original native record is never modified. */
export function loadSurfaceRecord(
  value: unknown,
  key: string,
): SurfaceRecord | typeof UnavailableSurfaceSchema.Type {
  try {
    const record = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(value);
    const surface = normalizeSurface(record.surface);
    return Schema.decodeUnknownSync(SurfaceRecordSchema)({
      ...record,
      history: record.history ?? "latest-only",
      surface,
    });
  } catch {
    return {
      surface_id: key.split("/").at(-1) ?? "unavailable",
      unavailable: "Generated view unavailable: its saved catalog or structure is invalid.",
    };
  }
}
export function compactSurface(entry: SurfaceRecord | typeof UnavailableSurfaceSchema.Type) {
  return "unavailable" in entry
    ? entry
    : {
        surface_id: entry.surface.createSurface.surfaceId,
        revision: entry.revision,
        at: entry.at,
        ...(entry.history ? { history: entry.history } : {}),
      };
}

export function observedSurface(
  record: SurfaceRecord,
  verifiedHash?: SurfaceRecord["surface_hash"],
): SurfaceRecord {
  return collectDiagrams(record.surface.createSurface.components).length
    ? { ...record, surface_hash: verifiedHash ?? presentationHash(record.surface) }
    : record;
}
