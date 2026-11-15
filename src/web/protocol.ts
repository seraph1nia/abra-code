import { Rpc } from "@opencode/plugin/rpc";
import { Schema } from "effect";
import { SessionId, IssueId, RequestId } from "../identities.ts";

const errors = { refused: Schema.toStandardSchemaV1(Schema.Struct({ code: Schema.String })) };
const method = <I>(input: Schema.Codec<I, unknown>) => ({
  input: Schema.toStandardSchemaV1(input),
  output: Schema.toStandardSchemaV1(Schema.Json),
  errors,
});
/** Authenticated native RPC, never mounted as a generic browser proxy. */
export const webGateway = Rpc.define({
  id: "abracode-web",
  events: {},
  methods: {
    submit: method(
      Schema.Struct({
        session_id: SessionId,
        request_id: Schema.String,
        text: Schema.String,
        delivery: Schema.Literals(["queue", "steer"]),
      }),
    ),
    history: method(Schema.Struct({ session_id: SessionId, issue_id: IssueId })),
    artifact: method(
      Schema.Struct({ session_id: SessionId, issue_id: IssueId, request_id: RequestId }),
    ),
    receipts: method(Schema.Struct({ session_id: SessionId })),
    surfaces: method(Schema.Struct({ session_id: SessionId })),
    projects: method(Schema.Struct({ session_id: SessionId })),
    checkpoint: method(Schema.Struct({ session_id: SessionId, form_id: Schema.String })),
  },
});
