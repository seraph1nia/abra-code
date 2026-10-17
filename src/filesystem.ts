import { AbsolutePath } from "./identities.ts";
import * as fs from "node:fs/promises";
import { type Dirent, type MakeDirectoryOptions, type PathLike, type RmOptions } from "node:fs";
import { Effect, FileSystem } from "effect";
import { provideFileSystem } from "./platform.ts";
import { fileURLToPath } from "node:url";
import { CrewError } from "./domain.ts";
// Node's overloads are kept here; all filesystem failures enter a typed channel.
// Wait for non-cancellable filesystem mutations before releasing writer ownership.
const io = <A>(action: () => Promise<A>) =>
  Effect.tryPromise({ try: action, catch: CrewError.from });
const mutation = <A>(action: () => Promise<A>) => io(action).pipe(Effect.uninterruptible);
const pathname = (path: PathLike) => (path instanceof URL ? fileURLToPath(path) : path.toString());
const platform = <A>(
  f: (fs: FileSystem.FileSystem) => Effect.Effect<A, import("effect/PlatformError").PlatformError>,
) =>
  Effect.flatMap(FileSystem.FileSystem, f).pipe(
    provideFileSystem,
    Effect.mapError((error) => CrewError.from(error.cause ?? error)),
  );

export const access = (path: PathLike) => platform((fs) => fs.access(pathname(path)));
export const readlink = (path: PathLike) => io(() => fs.readlink(path));
export const identityStat = (path: PathLike) => io(() => fs.lstat(path, { bigint: true }));
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
export const lstat = (path: PathLike) => io(() => fs.lstat(path));
export const realpath = (path: PathLike) =>
  platform((fs) => fs.realPath(pathname(path))).pipe(
    Effect.map((value) => AbsolutePath.make(value)),
  );
export const readFile = (path: PathLike, encoding: "utf8") =>
  platform((fs) => fs.readFileString(pathname(path), encoding));
export const writeFile = (
  path: PathLike,
  data: string,
  options?: Parameters<typeof fs.writeFile>[2],
) =>
  options === undefined
    ? platform((fs) => fs.writeFileString(pathname(path), data)).pipe(Effect.uninterruptible)
    : mutation(() => fs.writeFile(path, data, options));
export const mkdir = (path: PathLike, options?: MakeDirectoryOptions) =>
  mutation(() => fs.mkdir(path, options));
export const mkdtemp = (prefix: string) =>
  mutation(() => fs.mkdtemp(prefix)).pipe(Effect.map((value) => AbsolutePath.make(value)));
export const rename = (from: PathLike, to: PathLike) => mutation(() => fs.rename(from, to));
export const copyFile = (from: PathLike, to: PathLike) => mutation(() => fs.copyFile(from, to));
export const rm = (path: PathLike, options?: RmOptions) => mutation(() => fs.rm(path, options));
export const open = (path: PathLike, flags: string | number) =>
  mutation(() => fs.open(path, flags));
export function readdir(
  path: PathLike,
  options: {
    withFileTypes: true;
  },
): Effect.Effect<Dirent[], CrewError>;
export function readdir(path: PathLike): Effect.Effect<string[], CrewError>;
export function readdir(
  path: PathLike,
  options?: {
    withFileTypes: true;
  },
) {
  return options
    ? io(() => fs.readdir(path, options))
    : platform((fs) => fs.readDirectory(pathname(path)));
}
export const exists = (path: PathLike) =>
  access(path).pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }));
