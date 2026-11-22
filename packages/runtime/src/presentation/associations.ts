import type { PublicationQuery } from "@abracode/contracts/presentation/contracts";
import type { NativeStore } from "../storage/store.ts";
import { committedScope } from "../visibility/invalidations.ts";
import { Effect } from "effect";
import { CrewError } from "../domain.ts";
import { decode } from "../decode.ts";
import {
  LockKey,
  StorageKey,
  StoragePrefix,
  type SessionId,
  type MessageId,
} from "../identities.ts";
import type { Store } from "../storage/store.ts";
import type { Locks } from "../storage/lock.ts";
import { PresentationAttachmentSchema, type PresentationDiagnosticSchema } from "./contracts.ts";
import { canonicalJSON, presentationHash as hash } from "./identity.ts";

type Attachment = typeof PresentationAttachmentSchema.Type;
function associationKey(value: Attachment) {
  const slot =
    value.target.kind === "surface"
      ? value.target.surface_id
      : value.target.kind === "review"
        ? value.target.review_id
        : value.target.request_id;
  return StorageKey.make(
    `web/presentation/${value.session_id}/${hash(value.message_id)}/${hash([value.source, value.tool_call_id, value.target.kind, slot])}`,
  );
}

/** Search the compact producing-message associations. Only opening a result reads its publication. */
export function searchPublications(
  store: Pick<NativeStore, "page">,
  session: SessionId,
  query: typeof PublicationQuery.Type,
) {
  return Effect.gen(function* () {
    const prefix = StoragePrefix.make("web/presentation/" + session + "/");
    const page = yield* store.page(prefix, query.cursor, 32);
    const entries: Attachment[] = [];
    const needle = query.search?.trim().toLowerCase() ?? "";
    let incomplete = false;
    for (const row of page.entries) {
      const result = yield* decode(
        PresentationAttachmentSchema,
        row.value,
        "Publication association",
      ).pipe(Effect.result);
      if (
        result._tag === "Failure" ||
        result.success.session_id !== session ||
        associationKey(result.success) !== row.key
      ) {
        incomplete = true;
        continue;
      }
      const item = result.success,
        target = item.target;
      if (target.kind === "artifact" || (query.kind && query.kind !== target.kind)) continue;
      const id = target.kind === "surface" ? target.surface_id : target.review_id;
      if (
        [id, target.kind, String(target.revision), item.message_id, item.tool_call_id].some((v) =>
          v?.toLowerCase().includes(needle),
        )
      )
        entries.push(item);
    }
    return { entries, next: page.next, incomplete };
  });
}

/** Native presentation owners attach only already-published resources and proven
 * producing message identities. Observation reads never write or replay them. */
export class PresentationAssociations {
  constructor(
    private store: Store,
    private locks: Locks,
  ) {}
  associate(attachment: typeof PresentationAttachmentSchema.Type) {
    return this.locks.with(LockKey.make("web-presentations"), () =>
      Effect.gen({ self: this }, function* () {
        const value = yield* decode(
          PresentationAttachmentSchema,
          attachment,
          "Presentation association",
        );
        const key = associationKey(value);
        const prior = yield* this.store.get(key);
        if (prior !== undefined) {
          if (canonicalJSON(prior) !== canonicalJSON(value))
            return yield* new CrewError(
              "PRESENTATION_CONFLICT",
              "A retained message association cannot be rebound",
            );
        } else {
          yield* this.store.set(key, value);
          yield* committedScope({ presentations: true });
        }
      }),
    );
  }
  retained(attachment: Attachment) {
    return this.store
      .get(associationKey(attachment))
      .pipe(
        Effect.map(
          (value) => value !== undefined && canonicalJSON(value) === canonicalJSON(attachment),
        ),
      );
  }
  read(session: SessionId, messages: readonly MessageId[]) {
    return Effect.gen({ self: this }, function* () {
      const entries: (typeof PresentationAttachmentSchema.Type)[] = [];
      const diagnostics: (typeof PresentationDiagnosticSchema.Type)[] = [];
      let observed = 0;
      for (const message of messages.slice(0, 100)) {
        const rows = yield* this.store.entries(
          StoragePrefix.make(`web/presentation/${session}/${hash(message)}/`),
        );
        for (const row of rows) {
          if (observed++ >= 200) return { entries, diagnostics, truncated: true };
          const parsed = yield* decode(PresentationAttachmentSchema, row.value, row.key).pipe(
            Effect.result,
          );
          if (
            parsed._tag === "Failure" ||
            parsed.success.session_id !== session ||
            parsed.success.message_id !== message
          )
            diagnostics.push({
              message_id: message,
              unavailable:
                "A retained presentation association is unavailable; its original record was preserved.",
            });
          else entries.push(parsed.success);
        }
      }
      return { entries, diagnostics, truncated: messages.length > 100 };
    });
  }
}
