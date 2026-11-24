import type { VisualBuildSummarySchema } from "../reporting/report-contracts.ts";
import type { ArtifactSummarySchema } from "@abracode/contracts/web/wire";
import { artifactPageSize } from "@abracode/contracts/web/wire";
export function artifactSummary(
  build: typeof VisualBuildSummarySchema.Type,
): typeof ArtifactSummarySchema.Type {
  return {
    request_id: build.request.request_id,
    ...(build.request.title !== undefined ? { title: build.request.title } : {}),
    format:
      build.format === "a2ui-snapshot" || build.artifact?.schema_version === 2
        ? "a2ui-snapshot"
        : "legacy-html",
    status: build.status,
    generation: build.generation,
    ...(build.artifact
      ? {
          hash: build.artifact.hash,
          bytes: build.artifact.bytes,
          captured_at: build.artifact.observed_at,
        }
      : {}),
    ...(build.error !== undefined ? { error: build.error } : {}),
  };
}
export function artifactPage(
  builds: readonly (typeof VisualBuildSummarySchema.Type)[],
  offset = 0,
) {
  return {
    artifacts: builds.slice(offset, offset + artifactPageSize).map(artifactSummary),
    total: builds.length,
    offset,
    limit: artifactPageSize,
    ...(offset + artifactPageSize < builds.length
      ? { next_offset: offset + artifactPageSize }
      : {}),
  };
}
