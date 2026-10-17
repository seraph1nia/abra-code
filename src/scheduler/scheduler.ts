import { Effect } from "effect";
import { domainEffect } from "../effect.ts";

import { type Controller } from "../workflow/controller.ts";
export class Scheduler {
  constructor(private controller: Controller) {}
  tick = Effect.fn("Scheduler.tick")(
    function* (this: Scheduler) {
      if (!this.controller.queries.settings.autoSchedule) return [];
      const result = [];
      for (const item of yield* this.controller.ready()) {
        if (!item.eligible) continue;
        result.push(
          yield* this.controller
            .start(item.issue.id, yield* this.controller.queries.supervisor())
            .pipe(
              Effect.catch((error) =>
                Effect.succeed({ issue_id: item.issue.id, error: error.message }),
              ),
            ),
        );
      }
      return result;
    }.bind(this),
    domainEffect,
  );
}
