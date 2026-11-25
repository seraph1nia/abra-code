import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Effect } from "effect";
import { CrewError, ensure } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { AbsolutePath, type ContentHash } from "@abracode/contracts/identities";
import { open, link, lstat, realpath, pathExists, rm } from "../filesystem.ts";
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
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        ensure(
          /^[a-zA-Z0-9._-]+$/.test(this.name) && ![".", ".."].includes(this.name),
          "REPORT_PATH",
          "Invalid owned report filename",
        );
        const directory = yield* reportDirectory(this.home, this.segments);
        return { directory, path: AbsolutePath.make(join(directory, this.name)) };
      }),
    );
  }

  private verified(path: string, identity?: ReportFileIdentity) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const stat = yield* lstat(path);
        ensure(
          stat.isFile() &&
            !stat.isSymbolicLink() &&
            stat.size <= this.maximumBytes &&
            (yield* realpath(path)) === path,
          "REPORT_PATH",
          "Report must be a bounded owned regular file",
        );
        return yield* Effect.acquireUseRelease(
          open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK),
          (file) =>
            Effect.tryPromise({
              try: async () => {
                const before = await file.stat();
                ensure(
                  before.isFile() &&
                    before.ino === stat.ino &&
                    before.dev === stat.dev &&
                    before.size <= this.maximumBytes,
                  "REPORT_PATH",
                  "Report file ownership changed",
                );
                const buffer = Buffer.alloc(Math.min(before.size + 1, this.maximumBytes + 1));
                let bytes = 0;
                while (bytes < buffer.length) {
                  const read = await file.read(buffer, bytes, buffer.length - bytes, bytes);
                  if (!read.bytesRead) break;
                  bytes += read.bytesRead;
                }
                const after = await file.stat();
                ensure(
                  bytes === before.size &&
                    after.size === before.size &&
                    after.mtimeMs === before.mtimeMs &&
                    after.ctimeMs === before.ctimeMs,
                  "REPORT_TAMPERED",
                  "Report bytes changed during bounded read",
                );
                const text = buffer.subarray(0, bytes).toString("utf8"),
                  hash = reportHash(text);
                ensure(
                  Buffer.byteLength(text) === bytes &&
                    (!identity || (hash === identity.hash && bytes === identity.bytes)),
                  "REPORT_TAMPERED",
                  "Report destination is occupied or no longer matches its retained digest; conflicting bytes were preserved",
                );
                return {
                  text,
                  hash,
                  bytes,
                  path: AbsolutePath.make(path),
                  ino: before.ino,
                  dev: before.dev,
                };
              },
              catch: CrewError.from,
            }),
          (file) =>
            Effect.tryPromise({ try: () => file.close(), catch: CrewError.from }).pipe(
              Effect.catch((error) => Effect.logWarning("Resource cleanup failed", error)),
            ),
        );
      }),
    );
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
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        ensure(
          Buffer.byteLength(text) <= this.maximumBytes &&
            Buffer.byteLength(text) === identity.bytes &&
            reportHash(text) === identity.hash,
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
      }),
    );
  }

  private ownedStage(directory: string, staging: string) {
    ensure(
      staging.startsWith(directory + "/.stage-") &&
        !staging.slice(directory.length + 1).includes("/"),
      "REPORT_PATH",
      "Owned report staging file required",
    );
  }

  publish<A = void>(source: Source, commit?: Effect.Effect<A, CrewError>) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const { directory, path } = yield* this.location();
        ensure(
          source.expectedPath === undefined || source.expectedPath === path,
          "REPORT_PATH",
          "Report destination no longer matches its retained path",
        );
        let staging = "staging" in source ? source.staging : undefined;
        if (staging) this.ownedStage(directory, staging);
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
                  stat.ino === verified.ino && stat.dev === verified.dev && !stat.isSymbolicLink()
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
      }),
    );
  }
}
