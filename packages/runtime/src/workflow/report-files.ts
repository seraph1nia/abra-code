import { Effect } from "effect";
import { CrewError } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { open, link } from "../filesystem.ts";

/** Create exclusively and flush before a publication owner commits its receipt.
 * The caller retains path ownership, digest validation and scratch retirement. */
export const writeReportStaging = (path: string, text: string) =>
  domainEffect(
    Effect.acquireUseRelease(
      open(path, "wx"),
      (file) =>
        Effect.tryPromise({
          try: async () => {
            await file.chmod(0o600);
            await file.writeFile(text, "utf8");
            await file.sync();
          },
          catch: CrewError.from,
        }).pipe(Effect.uninterruptible),
      (file) =>
        Effect.tryPromise({ try: () => file.close(), catch: CrewError.from }).pipe(Effect.orDie),
    ),
  );
/** An occupied destination is preserved. Every caller must verify its exact bytes. */
export const linkReportStaging = (source: string, destination: string) =>
  link(source, destination).pipe(
    Effect.catchIf(
      (error) => error.code === "EEXIST",
      () => Effect.void,
    ),
  );
