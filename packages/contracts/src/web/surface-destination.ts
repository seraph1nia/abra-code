import { Schema } from "effect";
import { SessionId } from "../identities.ts";
import { Positive } from "../primitives.ts";
export const ComponentId = Schema.String.check(
  Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/),
);

export const SurfaceDestinationSchema = Schema.Struct({
  session_id: SessionId,
  surface_id: ComponentId,
  revision: Positive,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
