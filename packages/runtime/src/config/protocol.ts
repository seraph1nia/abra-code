import { Rpc } from "@opencode/plugin/rpc";
import { Schema } from "effect";
import { SessionId, AbsolutePath } from "../identities.ts";
import { ConfigurationReportSchema } from "./declarations.ts";
import { Count } from "../contracts.ts";
export const configuration = Rpc.define({
  id: "abracode-configuration",
  methods: {
    reconcile: {
      input: Schema.toStandardSchemaV1(
        Schema.Struct({
          session_id: SessionId,
          action: Schema.Literals(["status", "apply"]),
          page: Schema.optional(Count),
          config_path: Schema.optional(AbsolutePath),
        }),
      ),
      output: Schema.toStandardSchemaV1(ConfigurationReportSchema),
      errors: { refused: Schema.toStandardSchemaV1(Schema.Struct({ code: Schema.String })) },
    },
  },
  events: {},
});
