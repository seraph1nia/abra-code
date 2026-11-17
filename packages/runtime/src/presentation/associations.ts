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
        const slot =
          value.target.kind === "surface" ? value.target.surface_id : value.target.kind === "review" ? value.target.review_id : value.target.request_id;
        const key = StorageKey.make(
          `web/presentation/${value.session_id}/${hash(value.message_id)}/${hash([value.source, value.tool_call_id, value.target.kind, slot])}`,
        );
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
