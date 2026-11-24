/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect 4.1.4 FileSystem service adapters. */
import * as fs from "node:fs/promises";
import { type MakeDirectoryOptions, type PathLike, type RmOptions } from "node:fs";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ByteSize, Effect, FileSystem, Option, type PlatformError } from "effect";
import { CrewError } from "./domain.ts";
import { AbsolutePath } from "@abracode/contracts/identities";
import { provideFileSystem } from "./platform.ts";

export interface FileStat {
  readonly type: FileSystem.File.Type;
  readonly size: number;
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
  readonly nlink: number;
  readonly uid: number;
  readonly gid: number;
  readonly mtime: Date;
  readonly atime: Date;
  readonly birthtime: Date;
  readonly isFile: () => boolean;
  readonly isDirectory: () => boolean;
  readonly isSymbolicLink: () => boolean;
}

export interface IdentityStat {
  readonly type: FileSystem.File.Type;
  readonly dev: bigint;
  readonly ino: bigint;
  readonly nlink: bigint;
  readonly size: bigint;
  readonly birthtimeNs: bigint;
  readonly isFile: () => boolean;
  readonly isDirectory: () => boolean;
  readonly isSymbolicLink: () => boolean;
}

export interface DirectoryEntry {
  readonly name: string;
  readonly type: FileSystem.File.Type;
  readonly isFile: () => boolean;
  readonly isDirectory: () => boolean;
  readonly isSymbolicLink: () => boolean;
}

const openFlags = new Set<FileSystem.OpenFlag>([
  "r",
  "r+",
  "w",
  "wx",
  "w+",
  "wx+",
  "a",
  "ax",
  "a+",
  "ax+",
]);

const isOpenFlag = (value: unknown): value is FileSystem.OpenFlag =>
  typeof value === "string" && openFlags.has(value as FileSystem.OpenFlag);

const parseMode = (mode: number | string | undefined): number | undefined =>
  typeof mode === "number" ? mode : typeof mode === "string" ? Number.parseInt(mode, 8) : undefined;

// Wait for non-cancellable filesystem mutations before releasing writer ownership.
const mutation = <A>(action: () => Promise<A>) =>
  Effect.tryPromise({ try: action, catch: CrewError.from }).pipe(Effect.uninterruptible);

const pathname = (path: PathLike) => (path instanceof URL ? fileURLToPath(path) : path.toString());

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
) =>
  Effect.flatMap(FileSystem.FileSystem, f).pipe(
    provideFileSystem,
    Effect.mapError(fromPlatformError),
  );

const platformMutation = <A>(
  f: (fs: FileSystem.FileSystem) => Effect.Effect<A, PlatformError.PlatformError>,
) => platform(f).pipe(Effect.uninterruptible);

const toFileStat = (info: FileSystem.File.Info): FileStat => ({
  type: info.type,
  size: Number(ByteSize.toBigInt(info.size)),
  dev: Number(info.dev),
  ino: Number(Option.getOrElse(info.ino, () => 0n)),
  mode: info.mode,
  nlink: Number(Option.getOrElse(info.nlink, () => 0n)),
  uid: Option.getOrElse(info.uid, () => 0),
  gid: Option.getOrElse(info.gid, () => 0),
  mtime: Option.getOrElse(info.mtime, () => new Date(0)),
  atime: Option.getOrElse(info.atime, () => new Date(0)),
  birthtime: Option.getOrElse(info.birthtime, () => new Date(0)),
  isFile: () => info.type === "File",
  isDirectory: () => info.type === "Directory",
  isSymbolicLink: () => info.type === "SymbolicLink",
});

const toIdentityStat = (info: FileSystem.File.Info): IdentityStat => ({
  type: info.type,
  dev: info.dev,
  ino: Option.getOrElse(info.ino, () => 0n),
  nlink: Option.getOrElse(info.nlink, () => 0n),
  size: ByteSize.toBigInt(info.size),
  birthtimeNs: Option.match(info.birthtime, {
    onNone: () => 0n,
    onSome: (date) => BigInt(date.getTime()) * 1_000_000n,
  }),
  isFile: () => info.type === "File",
  isDirectory: () => info.type === "Directory",
  isSymbolicLink: () => info.type === "SymbolicLink",
});

const toDirectoryEntry = (entry: FileSystem.DirectoryEntry): DirectoryEntry => ({
  name: entry.name,
  type: entry.type,
  isFile: () => entry.type === "File",
  isDirectory: () => entry.type === "Directory",
  isSymbolicLink: () => entry.type === "SymbolicLink",
});

export const access = (path: PathLike) => platform((fs) => fs.access(pathname(path)));
export const readlink = (path: PathLike) => platform((fs) => fs.readLink(pathname(path)));
export const identityStat = (path: PathLike): Effect.Effect<IdentityStat, CrewError> =>
  platform((fs) => fs.lstat(pathname(path))).pipe(Effect.map(toIdentityStat));
export const pathExists = (path: PathLike) =>
  lstat(path).pipe(
    Effect.matchEffect({
      onSuccess: () => Effect.succeed(true),
      onFailure: (error) =>
        error.code === "ENOENT" || error.code === "ENOTDIR"
          ? Effect.succeed(false)
          : Effect.fail(error),
    }),
  );
export const lstat = (path: PathLike): Effect.Effect<FileStat, CrewError> =>
  platform((fs) => fs.lstat(pathname(path))).pipe(Effect.map(toFileStat));
export const realpath = (path: PathLike) =>
  platform((fs) => fs.realPath(pathname(path))).pipe(
    Effect.map((value) => AbsolutePath.make(value)),
  );
export const readBytes = (path: PathLike) => platform((fs) => fs.readFile(pathname(path)));
export const readFile = (path: PathLike, encoding: "utf8") =>
  platform((fs) => fs.readFileString(pathname(path), encoding));
export const writeFile = (
  path: PathLike,
  data: string,
  options?: Parameters<typeof fs.writeFile>[2],
) => {
  if (options === undefined || options === null || typeof options === "string") {
    return platformMutation((fs) => fs.writeFileString(pathname(path), data));
  }
  const flag = isOpenFlag(options.flag) ? options.flag : undefined;
  const mode = parseMode(options.mode);
  if (options.flag !== undefined && flag === undefined) {
    return mutation(() => fs.writeFile(path, data, options));
  }
  return platformMutation((fs) => fs.writeFileString(pathname(path), data, { flag, mode }));
};
export const mkdir = (path: PathLike, options?: MakeDirectoryOptions) =>
  platformMutation((fs) =>
    fs.makeDirectory(pathname(path), {
      recursive: options?.recursive,
      mode: parseMode(options?.mode),
    }),
  );
export const mkdtemp = (prefix: string) => {
  const trailingSeparator = prefix.endsWith("/") || prefix.endsWith("\\");
  const directory = trailingSeparator ? prefix : dirname(prefix);
  const leaf = trailingSeparator ? undefined : basename(prefix);
  return platformMutation((fs) =>
    fs.makeTempDirectory({
      directory,
      prefix: leaf,
    }),
  ).pipe(Effect.map((value) => AbsolutePath.make(value)));
};
export const rename = (from: PathLike, to: PathLike) =>
  platformMutation((fs) => fs.rename(pathname(from), pathname(to)));
export const link = (from: PathLike, to: PathLike) =>
  platformMutation((fs) => fs.link(pathname(from), pathname(to)));
export const copyFile = (from: PathLike, to: PathLike) =>
  platformMutation((fs) => fs.copyFile(pathname(from), pathname(to)));
export const rm = (path: PathLike, options?: RmOptions) =>
  platformMutation((fs) =>
    fs.remove(pathname(path), {
      recursive: options?.recursive,
      force: options?.force,
    }),
  );
/** Raw Node FileHandle open preserved for callers requiring O_NONBLOCK, fchmod, and ctimeMs checks. */
export const open = (path: PathLike, flags: string | number) =>
  mutation(() => fs.open(path, flags));
/** Scoped Effect FileSystem open supporting flag, mode, and noFollow options. */
export const openScoped = (
  path: PathLike,
  options?: Parameters<FileSystem.FileSystem["open"]>[1],
) =>
  Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
    fileSystem.open(pathname(path), options),
  ).pipe(Effect.mapError(fromPlatformError));
export function readdir(
  path: PathLike,
  options: {
    withFileTypes: true;
  },
): Effect.Effect<DirectoryEntry[], CrewError>;
export function readdir(path: PathLike): Effect.Effect<string[], CrewError>;
export function readdir(
  path: PathLike,
  options?: {
    withFileTypes: true;
  },
) {
  return options
    ? platform((fs) => fs.readDirectoryEntries(pathname(path))).pipe(
        Effect.map((entries) => entries.map(toDirectoryEntry)),
      )
    : platform((fs) => fs.readDirectory(pathname(path)));
}
export const exists = (path: PathLike) => access(path).pipe(Effect.isSuccess);

const missing = (error: CrewError) => error.code === "ENOENT";
/** Classify only genuine absence at a lifecycle gate. An invalid parent is a failure. */
export const entryExists = (path: PathLike) =>
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
    if (!(kind === "directory" ? stat.isDirectory() : stat.isFile()))
      return yield* new CrewError("RETAINED_PATH", `Expected a retained ${kind} at ${path}`);
    return true;
  });
export const readdirIfPresent = (path: PathLike) =>
  readdir(path).pipe(Effect.catchIf(missing, () => Effect.succeed([])));
