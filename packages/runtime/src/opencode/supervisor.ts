import { AbsolutePath } from "@abracode/contracts/identities";
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
          limit: 100,
          ...(cursor ? { cursor } : { order: "asc" as const }),
        });
        const session = page.data.find((s) => s.metadata?.abracode_supervisor_home === home);
        if (session) return session;
        cursor = page.cursor.next ?? undefined;
      } while (cursor);
    }),
  );
}
