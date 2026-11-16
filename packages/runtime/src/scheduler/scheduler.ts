import { Effect, Schema, Semaphore } from "effect";
import { domainEffect } from "../effect.ts";
import { decode } from "../decode.ts";
import { Priority } from "../contracts.ts";
import { RepositoryId, StorageKey, type IssueId } from "../identities.ts";
import { type Records } from "../storage/store.ts";
import { type Controller } from "../workflow/controller.ts";

const Cursor = Schema.Struct({
  schema_version: Schema.Literal(1),
  last: Schema.Array(Schema.Struct({ priority: Priority, repository_id: RepositoryId })).check(
    Schema.isMaxLength(5),
  ),
}).check(
  Schema.makeFilter(
    (cursor) =>
      new Set(cursor.last.map((item) => item.priority)).size === cursor.last.length ||
      "Scheduler priorities must be unique",
  ),
);
const key = StorageKey.make("scheduler/rotation");
/** The existing central scheduler-leader lock owns cursor writes across processes.
 * Local serialization also makes overlapping calls to this instance harmless. */
export class Scheduler {
  private turn = Semaphore.makeUnsafe(1);
  constructor(
    private controller: Controller,
    private records: Records,
  ) {}
  tick = Effect.fn("Scheduler.tick")(
    function* (this: Scheduler) {
      if (!this.controller.queries.settings.autoSchedule) return [];
      return yield* this.turn.withPermits(1)(
        Effect.gen({ self: this }, function* () {
          const authority = yield* this.controller.queries.automaticAuthority();
          if (!authority.session_id) return [];
          let cursor = yield* decode(
            Cursor,
            (yield* this.records.store.get(key)) ?? { schema_version: 1, last: [] },
            "Scheduler rotation",
          );
          const attempted = new Set<IssueId>();
          const results = [];
          const limit = (yield* this.controller.ready()).length;
          for (let attempt = 0; attempt < limit; attempt++) {
            const eligible = (yield* this.controller.ready()).filter(
              (item) => item.eligible && !attempted.has(item.issue.id),
            );
            if (!eligible.length) break;
            const priority = Math.min(...eligible.map((item) => item.issue.priority));
            const candidates = eligible.filter((item) => item.issue.priority === priority);
            const repositories = [...new Set(candidates.map((item) => item.repository_id))].sort();
            const previous = cursor.last.find((item) => item.priority === priority)?.repository_id;
            const repository =
              repositories.find((id) => previous === undefined || id > previous) ??
              repositories[0]!;
            const item = candidates
              .filter((item) => item.repository_id === repository)
              .sort((a, b) => (a.issue.id < b.issue.id ? -1 : a.issue.id > b.issue.id ? 1 : 0))[0]!;
            attempted.add(item.issue.id);
            // Rotate within this tick even on failure. Persist only once the
            // controller has retained an execution intent for the selected issue.
            cursor = {
              schema_version: 1,
              last: [
                ...cursor.last.filter((item) => item.priority !== priority),
                { priority, repository_id: repository },
              ].sort((a, b) => a.priority - b.priority),
            };
            results.push(
              yield* this.controller
                .start(item.issue.id, authority.session_id)
                .pipe(
                  Effect.catch((error) =>
                    Effect.succeed({ issue_id: item.issue.id, error: error.message }),
                  ),
                ),
            );
            if (yield* this.records.execution(item.issue.id))
              yield* this.records.store.set(key, cursor);
          }
          return results;
        }),
      );
    }.bind(this),
    domainEffect,
  );
}
