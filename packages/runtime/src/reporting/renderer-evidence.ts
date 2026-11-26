import { captureRegularFile, captureText } from "@abracode/report-export/renderer-cache";
import { ContentHash } from "@abracode/contracts/identities";
import { Effect, Schema } from "effect";
import { NoticeInventorySchema } from "@abracode/contracts/presentation/notices";
import { CrewError } from "../domain.ts";
export {
  Manifest,
  ManifestJSON,
  PointerJSON,
  readPreparedBundle,
  diagramFileLimit,
  evidence,
} from "@abracode/report-export/renderer-cache";
export const NoticeInventoryJSON = Schema.fromJsonString(NoticeInventorySchema);

export type Shell = { fingerprint: ContentHash; html: string; engine: string; host: string };
export const io = <A>(read: () => Promise<A>) =>
  Effect.tryPromise({ try: read, catch: CrewError.from });

export function decodeShellJSON<A>(
  codec: Schema.Codec<A, string>,
  text: string,
  message: string,
): Effect.Effect<A, CrewError> {
  return Schema.decodeEffect(codec, { reportInput: false })(text).pipe(
    Effect.mapError(() => new CrewError("REPORT_SHELL", message)),
  );
}

export const readBounded = (path: string, maximum: number) =>
  io(() => captureRegularFile(path, maximum)).pipe(Effect.map((file) => file.buffer));
export const readBoundedText = (path: string, maximum: number) =>
  io(() => captureText(path, maximum));
