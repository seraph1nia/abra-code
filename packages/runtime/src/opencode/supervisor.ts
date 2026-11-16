import { AbsolutePath } from "../identities.ts";
import { domainEffect } from "../effect.ts";
import { Effect } from "effect";
import { type OpenCodeClient } from "@opencode/client/effect";
export function findSupervisor(client: OpenCodeClient, home: AbsolutePath) {
  return domainEffect(
    Effect.gen(function* () {
      let cursor: import("@opencode/client/effect/api").SessionListInput["cursor"];
      do {
        const page = yield* client.session.list({
          directory: home,
          order: "asc",
          limit: 100,
          cursor,
        });
        const session = page.data.find((s) => s.metadata?.abracode_supervisor_home === home);
        if (session) return session;
        cursor = page.cursor.next ?? undefined;
      } while (cursor);
    }),
  );
}
