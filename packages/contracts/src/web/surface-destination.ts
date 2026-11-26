import { Schema } from "effect";
import { Identifier, SessionId } from "../identities.ts";
import { Positive } from "../primitives.ts";
export const SurfaceId = Identifier;
export const ComponentId = Schema.String.check(Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9_]{0,100}$/u));

export const SurfaceDestinationSchema = Schema.Struct({
  session_id: SessionId,
  surface_id: SurfaceId,
  revision: Positive,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
