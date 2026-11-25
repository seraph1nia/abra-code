import { portableRendererABI as rendererABI } from "@abracode/contracts/presentation/report-export-contract";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { Effect, Schema } from "effect";
import { NoticeInventorySchema } from "@abracode/contracts/presentation/notices";
import { ContentHash, RelativePath } from "@abracode/contracts/identities";
import { CrewError, ensure } from "../domain.ts";
import { canonicalJSON } from "../presentation/identity.ts";
import { maximumHTMLBytes, reportHash } from "./report-build.ts";

export const Manifest = Schema.Struct({
  abi: Schema.Literal(rendererABI),
  inputs: Schema.Array(Schema.Struct({ file: RelativePath, hash: ContentHash })).check(
    Schema.isMaxLength(8192),
  ),
  links: Schema.Array(Schema.Tuple([RelativePath, RelativePath])).check(Schema.isMaxLength(8192)),
  notices_hash: ContentHash,
});
const Receipt = Schema.Struct({
  abi: Schema.Literal(rendererABI),
  fingerprint: ContentHash,
  html_hash: ContentHash,
  manifest_hash: ContentHash,
  engine_hash: ContentHash,
  host_hash: ContentHash,
  bytes: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(maximumHTMLBytes)),
});
const Pointer = Schema.Struct({ fingerprint: ContentHash });
export const ManifestJSON = Schema.fromJsonString(Manifest);
export const ReceiptJSON = Schema.fromJsonString(Receipt);
export const PointerJSON = Schema.fromJsonString(Pointer);
export const NoticeInventoryJSON = Schema.fromJsonString(NoticeInventorySchema);

export type Shell = { fingerprint: ContentHash; html: string; engine: string; host: string };
export const diagramFileLimit = 16 * 1024 * 1024;
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

/** No-follow reads bound cache metadata and bytes before parsing or execution. */
async function bounded(path: string, maximum: number) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    ensure(
      before.isFile() && before.size <= maximum,
      "REPORT_SHELL",
      "Renderer input/cache exceeds its regular-file bound",
    );
    const value = await file.readFile();
    const after = await file.stat();
    ensure(
      value.length <= maximum && before.size === after.size && before.mtimeMs === after.mtimeMs,
      "REPORT_SHELL",
      "Renderer input changed during capture",
    );
    return value;
  } finally {
    await file.close();
  }
}

export const readBounded = (path: string, maximum: number) => io(() => bounded(path, maximum));
export const readBoundedText = (path: string, maximum: number) =>
  readBounded(path, maximum).pipe(Effect.map((bytes) => bytes.toString("utf8")));

export function evidence(manifest: string, html: string, engine: string, host: string) {
  const assets = {
    abi: rendererABI,
    manifest_hash: reportHash(manifest),
    html_hash: reportHash(html),
    engine_hash: reportHash(engine),
    host_hash: reportHash(host),
    bytes: Buffer.byteLength(html),
  };
  return { ...assets, fingerprint: reportHash(canonicalJSON(assets)) };
}
