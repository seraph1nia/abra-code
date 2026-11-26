import { captureTextFile } from "@abracode/report-export/renderer-cache";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Effect, Option } from "effect";
import { CrewError } from "../domain.ts";
import { AbsolutePath, type ContentHash } from "@abracode/contracts/identities";
import { open, link, lstat, pathExists, rm } from "../filesystem.ts";
import { reportDirectory, reportHash } from "./report-build.ts";

export type ReportFileIdentity = { hash: ContentHash; bytes: number };
type Source = { identity: ReportFileIdentity; expectedPath?: string } & (
  | { text: string }
  | { staging: string }
);

/** Physical immutable-file protocol. Owners choose policy and commit their own receipts.
 * A retained stage can be resumed without recapture; retirement follows the owner commit. */
export class ReportFile {
  constructor(
    private home: AbsolutePath,
    private segments: readonly string[],
    private name: string,
    private maximumBytes: number,
  ) {}

  private location() {
    return Effect.gen({ self: this }, function* () {
      if (!/^[a-zA-Z0-9._-]+$/.test(this.name) || [".", ".."].includes(this.name))
        return yield* new CrewError("REPORT_PATH", "Invalid owned report filename");
      const directory = yield* reportDirectory(this.home, this.segments);
      return { directory, path: AbsolutePath.make(join(directory, this.name)) };
    });
  }

  private verified(path: string, identity?: ReportFileIdentity) {
    return Effect.gen({ self: this }, function* () {
      const { text, bytes, ino, dev } = yield* Effect.tryPromise({
        try: () => captureTextFile(path, this.maximumBytes),
        catch: CrewError.from,
      });
      const hash = reportHash(text);
      if (identity && (hash !== identity.hash || bytes !== identity.bytes))
        return yield* new CrewError(
          "REPORT_TAMPERED",
          "Report destination is occupied or no longer matches its retained digest; conflicting bytes were preserved",
        );
      return { text, bytes, hash, ino, dev, path: AbsolutePath.make(path) };
    });
  }

  read(identity?: ReportFileIdentity) {
    return this.location().pipe(Effect.flatMap(({ path }) => this.verified(path, identity)));
  }

  existing(identity?: ReportFileIdentity) {
    return this.location().pipe(
      Effect.flatMap(({ path }) =>
        pathExists(path).pipe(
          Effect.flatMap((exists) => (exists ? this.verified(path, identity) : Effect.undefined)),
        ),
      ),
    );
  }

  stage(text: string, identity: ReportFileIdentity) {
    return Effect.gen({ self: this }, function* () {
      if (
        !(Buffer.byteLength(text) <= this.maximumBytes) ||
        Buffer.byteLength(text) !== identity.bytes ||
        reportHash(text) !== identity.hash
      )
        return yield* new CrewError(
          "REPORT_TAMPERED",
          "Report staging digest or size bound changed",
        );
      const { directory, path: destination } = yield* this.location();
      const path = AbsolutePath.make(join(directory, `.stage-${randomUUID()}`));
      yield* Effect.acquireUseRelease(
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
          Effect.tryPromise({
            try: () => file.close(),
            catch: CrewError.from,
          }).pipe(Effect.catch((error) => Effect.logWarning("Resource cleanup failed", error))),
      );
      return { staging: path, path: destination };
    });
  }

  publish<A = void>(source: Source, commit?: Effect.Effect<A, CrewError>) {
    return Effect.gen({ self: this }, function* () {
      const { directory, path } = yield* this.location();
      if (source.expectedPath !== undefined && source.expectedPath !== path)
        return yield* new CrewError(
          "REPORT_PATH",
          "Report destination no longer matches its retained path",
        );
      let staging = "staging" in source ? source.staging : undefined;
      if (
        staging &&
        (!staging.startsWith(directory + "/.stage-") ||
          staging.slice(directory.length + 1).includes("/"))
      )
        return yield* new CrewError("REPORT_PATH", "Owned report staging file required");
      if (!(yield* pathExists(path))) {
        if ("text" in source) staging = (yield* this.stage(source.text, source.identity)).staging;
        else staging = source.staging;
        yield* this.verified(staging, source.identity);
        yield* link(staging, path).pipe(
          Effect.catchIf(
            (e) => e.code === "EEXIST",
            () => Effect.void,
          ),
        );
      }
      const file = yield* this.verified(path, source.identity);
      const result = yield* commit ?? Effect.void;
      if (staging) {
        // Changed evidence is preserved; cleanup cannot invalidate a durable owner receipt.
        const scratch = staging;
        yield* this.verified(scratch, source.identity).pipe(
          Effect.flatMap((verified) =>
            lstat(scratch).pipe(
              Effect.flatMap((stat) =>
                Option.getOrUndefined(stat.ino) === BigInt(verified.ino) &&
                stat.dev === BigInt(verified.dev) &&
                stat.type === "File"
                  ? rm(scratch)
                  : Effect.void,
              ),
            ),
          ),
          Effect.catch((error) =>
            Effect.logWarning("Report staging scratch preserved", error.code),
          ),
        );
      }
      return { file, result };
    });
  }
}
