import { fileSystemDriver } from "./platform.ts";
import * as fs from "node:fs/promises";
import { Effect, FileSystem, type PlatformError } from "effect";
import { CrewError } from "./domain.ts";
import { AbsolutePath } from "@abracode/contracts/identities";

// Wait for non-cancellable filesystem mutations before releasing writer ownership.
const mutation = <A>(action: () => Promise<A>) =>
  Effect.tryPromise({ try: action, catch: CrewError.from }).pipe(Effect.uninterruptible);

const fromPlatformError = (error: PlatformError.PlatformError): CrewError => {
  const underlying = error.reason.cause ?? error.cause;
  if (
    typeof underlying === "object" &&
    underlying !== null &&
    "code" in underlying &&
    typeof underlying.code === "string" &&
    underlying.code.trim().length > 0
  ) {
    return CrewError.from(underlying);
  }
  switch (error.reason._tag) {
    case "NotFound":
      return new CrewError("ENOENT", error.message, error);
    case "AlreadyExists":
      return new CrewError("EEXIST", error.message, error);
    case "PermissionDenied":
      return new CrewError("EACCES", error.message, error);
    case "Busy":
      return new CrewError("EBUSY", error.message, error);
    default:
      return CrewError.from(underlying ?? error);
  }
};

const platform = <A>(
  f: (fs: FileSystem.FileSystem) => Effect.Effect<A, PlatformError.PlatformError>,
) => Effect.flatMap(fileSystemDriver, f).pipe(Effect.mapError(fromPlatformError));

const platformMutation = <A>(
  f: (fs: FileSystem.FileSystem) => Effect.Effect<A, PlatformError.PlatformError>,
) => platform(f).pipe(Effect.uninterruptible);

export const access = (path: string) => platform((fs) => fs.access(path));
export const readlink = (path: string) => platform((fs) => fs.readLink(path));
export const pathExists = (path: string) =>
  lstat(path).pipe(
    Effect.as(true),
    Effect.catchIf(
      (error) => error.code === "ENOENT" || error.code === "ENOTDIR",
      () => Effect.succeed(false),
    ),
  );
export const lstat = (path: string) => platform((fs) => fs.lstat(path));
export const realpath = (path: string) =>
  platform((fs) => fs.realPath(path)).pipe(Effect.map((value) => AbsolutePath.make(value)));
export const readBytes = (path: string) => platform((fs) => fs.readFile(path));
export const readFile = (path: string, encoding: "utf8") =>
  platform((fs) => fs.readFileString(path, encoding));
export const writeFile = (
  path: string,
  data: string,
  options?: { readonly flag?: FileSystem.OpenFlag; readonly mode?: number },
) => platformMutation((fs) => fs.writeFileString(path, data, options));
export const mkdir = (
  path: string,
  options?: Parameters<FileSystem.FileSystem["makeDirectory"]>[1],
) => platformMutation((fs) => fs.makeDirectory(path, options));
export const scopedTemporaryDirectory = (prefix: string) =>
  Effect.flatMap(fileSystemDriver, (fs) => fs.makeTempDirectoryScoped({ prefix })).pipe(
    Effect.map((path) => AbsolutePath.make(path)),
    Effect.mapError(fromPlatformError),
  );

export const temporaryDirectory = (directory: string, prefix: string) =>
  platformMutation((fs) => fs.makeTempDirectory({ directory, prefix })).pipe(
    Effect.map((path) => AbsolutePath.make(path)),
  );
export const rename = (from: string, to: string) => platformMutation((fs) => fs.rename(from, to));
export const link = (from: string, to: string) => platformMutation((fs) => fs.link(from, to));
export const copyFile = (from: string, to: string) =>
  platformMutation((fs) => fs.copyFile(from, to));
export const rm = (path: string, options?: Parameters<FileSystem.FileSystem["remove"]>[1]) =>
  platformMutation((fs) => fs.remove(path, options));
/** Raw Node FileHandle open preserved for callers requiring O_NONBLOCK, fchmod, and ctimeMs checks. */
export const open = (path: string, flags: string | number) => mutation(() => fs.open(path, flags));
export const readdir = (path: string) => platform((fs) => fs.readDirectory(path));
export const readDirectoryEntries = (path: string) =>
  platform((fs) => fs.readDirectoryEntries(path));
export const exists = (path: string) => access(path).pipe(Effect.isSuccess);

const missing = (error: CrewError) => error.code === "ENOENT";
/** Classify only genuine absence at a lifecycle gate. An invalid parent is a failure. */
export const entryExists = (path: string) =>
  access(path).pipe(
    Effect.as(true),
    Effect.catchIf(missing, () =>
      // An inaccessible symlink target does not make the entry itself absent.
      lstat(path).pipe(
        Effect.as(true),
        Effect.catchIf(missing, () => Effect.succeed(false)),
      ),
    ),
  );
/** Present retained entries must have the expected kind before lifecycle adoption. */
export const retainedEntry = (path: string, kind: "file" | "directory") =>
  Effect.gen(function* () {
    if (!(yield* entryExists(path))) return false;
    const stat = yield* lstat(path);
    if (stat.type !== (kind === "directory" ? "Directory" : "File"))
      return yield* new CrewError("RETAINED_PATH", `Expected a retained ${kind} at ${path}`);
    return true;
  });
export const readdirIfPresent = (path: string) =>
  readdir(path).pipe(Effect.catchIf(missing, () => Effect.succeed([])));
