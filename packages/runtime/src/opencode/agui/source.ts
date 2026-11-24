import { NativeSessionProjection, type NativeEventEnvelope } from "./native-state.ts";
import { DateTime, Effect } from "effect";
import type { OpenCodeClient } from "@opencode/client/effect";
import type { Session } from "@opencode/schema/session";
import { CrewError } from "../../domain.ts";
import { domainEffect } from "../../effect.ts";
import type { SessionId } from "@abracode/contracts/identities";
import { projectNativeMessage, type ToolPresenter } from "./messages.ts";

export type AuthorizedConnection = { client: OpenCodeClient; session: Session.Info };
/** Own native paging, cursor custody and visible projection; admission stays durable with its owner. */
export class NativeSessionReader {
  private cursors = new Set<string>();
  private projection: NativeSessionProjection;
  private initialized = false;
  private reading = false;
  private queued: NativeEventEnvelope[] = [];
  constructor(
    private sessionID: SessionId,
    private authorized: () => Effect.Effect<AuthorizedConnection, CrewError>,
    private present?: ToolPresenter,
  ) {
    this.projection = new NativeSessionProjection(sessionID, present);
  }
  private remember(cursor: string | undefined) {
    if (!cursor) return;
    this.cursors.add(cursor);
    if (this.cursors.size > 500) this.cursors.delete(this.cursors.values().next().value!);
  }
  private finishRead() {
    this.reading = false;
    for (const event of this.queued.splice(0)) this.projection.apply(event);
  }
  read(options: { transcript?: boolean; inbox?: boolean } = {}) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const { client, session } = yield* this.authorized();
        const busy = Boolean(
          session.time.busy &&
          (!session.time.idle ||
            DateTime.toEpochMillis(session.time.busy) > DateTime.toEpochMillis(session.time.idle)),
        );
        if (options.transcript) this.reading = true;
        const page = options.transcript
          ? yield* client.message.list({ sessionID: this.sessionID, limit: 100, order: "desc" })
          : undefined;
        this.remember(page?.cursor.next);
        const inbox = options.inbox
          ? yield* client.session.inbox.list({ sessionID: this.sessionID })
          : undefined;
        if (page) {
          this.projection.baseline(
            [...page.data].reverse(),
            busy,
            inbox ?? this.projection.current().inbox,
            true,
          );
          this.initialized = true;
          this.finishRead();
        }
        return {
          client,
          session,
          page,
          busy,
          model: session.model
            ? `${session.model.providerID}/${session.model.id}${session.model.variant ? `#${session.model.variant}` : ""}`
            : undefined,
          messages: page ? this.projection.current().messages : undefined,
          inbox: inbox
            ?.filter((entry) => entry.type === "user")
            .map((entry) => ({ id: entry.id, text: entry.payload.text, delivery: entry.delivery })),
        };
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (options.transcript && this.reading) this.finishRead();
          }),
        ),
      ),
    );
  }
  apply(event: NativeEventEnvelope) {
    if (this.reading) {
      if (this.queued.length < 512) this.queued.push(event);
      else return this.projection.apply({ type: "server.connected" });
      return {};
    }
    return this.projection.apply(event);
  }
  current() {
    return this.initialized ? this.projection.current() : undefined;
  }
  readonly status = this.read().pipe(Effect.map(({ busy }) => ({ busy })));
  history(cursor: string) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        if (!this.cursors.has(cursor))
          return yield* new CrewError(
            "WEB_CURSOR",
            "History cursor was not issued for this Abra session; refresh first",
          );
        const { client } = yield* this.authorized();
        const page = yield* client.message.list({ sessionID: this.sessionID, cursor, limit: 100 });
        this.remember(page.cursor.next);
        return {
          client,
          messages: [...page.data]
            .reverse()
            .flatMap((message) => projectNativeMessage(message, this.present) ?? []),
          older: page.cursor.next,
          messageIDs: page.data.map((message) => message.id),
        };
      }),
    );
  }
}
