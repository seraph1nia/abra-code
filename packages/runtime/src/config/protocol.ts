import { exactParseOptions } from "@abracode/contracts/primitives";
import { Rpc } from "@opencode/plugin/rpc";
import { Schema } from "effect";
import { SessionId, AbsolutePath } from "@abracode/contracts/identities";
import { ConfigurationReportSchema } from "./declarations.ts";
import { Count } from "@abracode/contracts/primitives";
export const configuration = Rpc.define({
  id: "abracode-configuration",
  methods: {
    reconcile: {
      input: Schema.Struct({
        session_id: SessionId,
        action: Schema.Literals(["status", "apply"]),
        page: Schema.optional(Count),
        config_path: Schema.optional(AbsolutePath),
      }).annotate(exactParseOptions),
      output: ConfigurationReportSchema,
      errors: { refused: Schema.Struct({ code: Schema.String }) },
    },
  },
  events: {},
});
