import { Effect, Schema } from "effect";
import { Rpc } from "@opencode/plugin";
import type { Context } from "@opencode/plugin/effect/plugin";
import { SessionMessage } from "@opencode/schema/session-message";
import { domainEffect } from "../../src/effect.ts";
import { ReceiptSchema } from "../../src/web/workspace-wire.ts";

const value = { type: "object" as const, additionalProperties: true };
export const receiptHistoryProbe = Rpc.define({
  id: "abracode-receipt-history-test",
  methods: {
    seedReceiptHistory: {
      input: value,
      output: {
        type: "object",
        properties: { count: { type: "integer" } },
        required: ["count"],
        additionalProperties: false,
      },
    },
  },
  events: {},
});

/** Installed only in the workspace fixture's private copy of the plugin so it
 * can seed that plugin's storage namespace through the public SDK. */
export function registerReceiptHistoryProbe(ctx: Context) {
  return domainEffect(
    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- Native registration declares unknown; domainEffect normalizes it at this test boundary.
    ctx.rpc
      .register(receiptHistoryProbe, {
        seedReceiptHistory: (input) =>
          Effect.gen(function* () {
            const { session, request_id } = input as { session: string; request_id: string };
            const prefix = `web/receipt/${session}/`;
            const original = yield* ctx.storage.get(prefix + request_id);
            const receipt = yield* Schema.decodeUnknownEffect(ReceiptSchema)(original);
            if (receipt.status !== "admitted")
              return yield* Effect.die(new Error("A real original admission is required"));
            for (let index = 0; index < 101; index++) {
              const id = `native-receipt-history-${index}`;
              yield* ctx.storage.set(prefix + id, {
                ...receipt,
                request_id: id,
                message_id: SessionMessage.ID.create(),
                at: new Date(Date.parse(receipt.at) + index + 1).toISOString(),
              });
            }
            return { count: 101 };
          }).pipe(Effect.orDie),
      })
      .pipe(Effect.asVoid),
  );
}
