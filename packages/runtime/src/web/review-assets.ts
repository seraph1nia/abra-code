import { readFilePrefix } from "../storage/bounded-read.ts";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import {
  ReviewPublishSchema,
  ReviewAssetDataSchema,
  type ReviewRecord,
} from "@abracode/contracts/web/reviews";
import { AbsolutePath, ContentHash, SessionId, StorageKey } from "@abracode/contracts/identities";
import { CrewError } from "../domain.ts";
import { decode } from "../decode.ts";
import type { Store } from "../storage/store.ts";
import { within } from "../visibility/documents.ts";
import { PublicationStore } from "./publication-store.ts";

const digest = (bytes: Uint8Array) =>
  ContentHash.make(createHash("sha256").update(bytes).digest("hex"));
const fail = (message: string) => new CrewError("REVIEW_REFUSED", message);
const assetKey = (session: SessionId, hash: ContentHash) =>
  StorageKey.make(`web/review/${session}/asset/${hash}`);
export class ReviewAssets {
  constructor(
    private store: Store,
    private publications: PublicationStore,
  ) {}
  capture(
    session: SessionId,
    root: AbsolutePath | undefined,
    previews: NonNullable<typeof ReviewPublishSchema.Type.previews>,
  ) {
    return Effect.gen({ self: this }, function* () {
      if (previews.length && !root)
        return yield* fail("Design images require an owned source worktree");
      const assets: ReviewRecord["assets"][number][] = [];
      let total = 0;
      for (const preview of previews) {
        if (assets.some((a) => a.id === preview.id))
          return yield* fail("Preview identifiers must be unique");
        const bytes = yield* Effect.tryPromise({
          try: async () => {
            const tree = AbsolutePath.make(await realpath(root!));
            const original = resolve(tree, preview.path),
              canonical = AbsolutePath.make(await realpath(original));
            if (!within(tree, canonical) || canonical !== original)
              throw fail("Preview must be a regular, non-symlink file inside its owned worktree");
            const handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
              const stat = await handle.stat();
              if (!stat.isFile() || stat.size > 2 * 1024 * 1024)
                throw fail("Preview exceeds 2 MiB or is not a regular file");
              const { buffer, limited } = await readFilePrefix(handle, 2 * 1024 * 1024);
              if (limited) throw fail("Preview exceeds 2 MiB");
              return buffer;
            } finally {
              await handle.close();
            }
          },
          catch: CrewError.from,
        });
        total += bytes.length;
        if (total > 8 * 1024 * 1024) return yield* fail("Review previews exceed 8 MiB");
        const mime =
          bytes.length >= 24 &&
          bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? ("image/png" as const)
            : bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
              ? ("image/jpeg" as const)
              : bytes.length >= 12 &&
                  bytes.toString("ascii", 0, 4) === "RIFF" &&
                  bytes.toString("ascii", 8, 12) === "WEBP"
                ? ("image/webp" as const)
                : undefined;
        if (!mime) return yield* fail("Preview must be PNG, JPEG or WebP raster content");
        const asset = { id: preview.id, hash: digest(bytes), mime, bytes: bytes.length };
        // Asset content is immutable and independent of the worktree lifecycle.
        yield* this.publications.immutable(
          assetKey(session, asset.hash),
          {
            hash: asset.hash,
            mime,
            bytes: asset.bytes,
            data: bytes.toString("base64"),
          },
          "Retained review identity conflicts with existing content",
        );
        assets.push(asset);
      }
      return assets;
    });
  }
  read(session: SessionId, asset: ReviewRecord["assets"][number]) {
    return Effect.gen({ self: this }, function* () {
      const raw = yield* this.store.get(assetKey(session, asset.hash));
      const data = yield* decode(
        Schema.Record(Schema.String, Schema.Json),
        raw,
        "Retained image data",
      );
      const value = yield* decode(ReviewAssetDataSchema, { ...data, id: asset.id }, "Review image");
      const bytes = Buffer.from(value.data, "base64");
      if (
        bytes.length !== asset.bytes ||
        digest(bytes) !== asset.hash ||
        value.hash !== asset.hash ||
        value.bytes !== asset.bytes ||
        value.mime !== asset.mime
      )
        return yield* fail("Retained image integrity check failed");
      return value;
    });
  }
}
