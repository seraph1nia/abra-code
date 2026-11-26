import { Effect } from "effect";
import { readReportDocument } from "@abracode/contracts/presentation/report-document";
import { SessionMessage } from "@opencode/client/effect";
import { IssueId, RequestId } from "@abracode/contracts/identities";
import { type Runtime } from "../opencode/runtime.ts";
import { CrewError } from "../domain.ts";
import { SurfacePublications } from "../web/surface-publications.ts";
import { presentationHash } from "../presentation/identity.ts";
import { ReportDocuments } from "./report-documents.ts";
import { type VisualBuild } from "./report-contracts.ts";

export function isTerminalBuild(build: VisualBuild): boolean {
  return build.status === "published" || build.status === "failed";
}

export class ReportNotices {
  constructor(
    private surfaces: SurfacePublications,
    private documents: ReportDocuments,
    private notify: Runtime["notify"],
    private updateVisual: (
      issue: IssueId,
      id: RequestId,
      update: (b: VisualBuild) => VisualBuild,
    ) => Effect.Effect<VisualBuild, CrewError>,
  ) {}
  deliver(issue: IssueId, build: VisualBuild) {
    return Effect.gen({ self: this }, function* () {
      if (build.producing_call) {
        if (build.status !== "published" || !build.artifact || build.source_attachment) return;
        const producer = build.producing_call;
        yield* this.surfaces.associate({
          ...producer,
          source: "tool",
          target: {
            kind: "artifact",
            issue_id: issue,
            request_id: build.request.request_id,
            hash: build.artifact.hash,
          },
        });
        yield* this.updateVisual(issue, build.request.request_id, (current) => ({
          ...current,
          source_attachment: "associated",
        }));
        return;
      }
      if (build.request.surface) {
        if (build.status !== "published" || !build.artifact || build.source_attachment) return;
        const read = yield* this.documents.read(
          issue,
          build.request.request_id,
          build.artifact.hash,
        );
        const loaded = yield* Effect.try({
          try: () => readReportDocument(read.json),
          catch: CrewError.from,
        });
        const provenance = loaded.supported ? loaded.document.provenance.source_surface : undefined;
        let associated = false;
        if (provenance) {
          const source = yield* this.surfaces.read(
            provenance.session_id,
            provenance.surface_id,
            provenance.revision,
          );
          if (provenance.hash !== presentationHash(source))
            return yield* new CrewError(
              "REPORT_IDENTITY",
              "Saved surface provenance no longer matches its original revision",
            );
          if (source.message_id && source.tool_call_id.startsWith(`${source.message_id}/`)) {
            yield* this.surfaces.associate({
              session_id: provenance.session_id,
              message_id: source.message_id,
              tool_call_id: source.tool_call_id.slice(source.message_id.length + 1),
              source: "tool",
              target: {
                kind: "artifact",
                issue_id: issue,
                request_id: build.request.request_id,
                hash: build.artifact.hash,
              },
            });
            associated = true;
          }
        }
        yield* this.updateVisual(issue, build.request.request_id, (current) => ({
          ...current,
          source_attachment: associated ? "associated" : "unavailable",
        }));
        return;
      }
      if (!build.notify_session || !isTerminalBuild(build)) return;
      const phase = build.status === "published" ? ("published" as const) : ("failed" as const);
      let current = build;
      if (!current.notices?.some((n) => n.phase === phase))
        current = yield* this.updateVisual(issue, build.request.request_id, (b) =>
          b.status !== phase || b.notices?.some((n) => n.phase === phase)
            ? b
            : {
                ...b,
                notices: [
                  ...(b.notices ?? []),
                  {
                    phase,
                    message_id: SessionMessage.ID.create(),
                    delivered: false,
                    text:
                      phase === "published"
                        ? `AbraCode visual report ${b.request.request_id} for ${issue}, generation ${b.generation}: [Open report](<${b.artifact!.path}>). Static evidence snapshot observed ${b.snapshot.observed_at}; SHA-256 ${b.artifact!.hash}.`
                        : `AbraCode visual report ${b.request.request_id} for ${issue} failed. Untrusted diagnostic data: ${JSON.stringify((b.error ?? "Inspect retained artifact status").slice(0, 2048))}. Earlier valid reports are preserved. Inspect abra_work_report action artifacts; retry the same request for transient failure, or use a new request after changing the trusted template.`,
                  },
                ],
              },
        );
      for (const notice of current.notices ?? []) {
        if (notice.phase === "published" && current.artifact && !notice.associated) {
          yield* this.surfaces.associate({
            session_id: current.notify_session!,
            message_id: notice.message_id,
            source: "notice",
            target: {
              kind: "artifact",
              issue_id: issue,
              request_id: current.request.request_id,
              hash: current.artifact.hash,
            },
          });
          current = yield* this.updateVisual(issue, build.request.request_id, (b) => ({
            ...b,
            notices: b.notices?.map((n) =>
              n.message_id === notice.message_id ? { ...n, associated: true } : n,
            ),
          }));
        }
        if (!notice.delivered) {
          yield* this.notify(current.notify_session!, notice.text, notice.message_id);
          current = yield* this.updateVisual(issue, build.request.request_id, (b) => ({
            ...b,
            notices: b.notices?.map((n) =>
              n.message_id === notice.message_id ? { ...n, delivered: true } : n,
            ),
          }));
        }
      }
    });
  }
}
