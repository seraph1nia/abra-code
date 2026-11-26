import { ByteSize, Effect, FileSystem, Option, Schema } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { basename, join, sep } from "node:path";
import type { MemoryScope, MemorySearch, MemoryRead } from "@abracode/contracts/visibility/memory";
import { FileLocks, type Locks } from "../storage/lock.ts";
import { AbsolutePath, LockKey, type RepositoryId } from "@abracode/contracts/identities";
import { CrewError } from "../domain.ts";
import { decode } from "../decode.ts";
import { sha256 } from "../digest.ts";
import { provideFileSystem } from "../platform.ts";
import { memoryError, type MemoryProvider } from "./provider.ts";

export const hash = (value: string | Uint8Array) => sha256(value);
const projectName = (scope: MemoryScope) =>
  scope.kind === "shared" ? "abra-shared" : "abra-" + hash(scope.repository_id);
export const sameScope = (left: MemoryScope, right: MemoryScope) =>
  projectName(left) === projectName(right);
export const conflict = () =>
  new CrewError(
    "MEMORY_CONFLICT",
    "The note changed. Search again to select its current revision.",
  );
const missing = () => new CrewError("MEMORY_MISSING", "The selected Markdown file is unavailable.");
const pathError = () =>
  new CrewError("MEMORY_LOCATION", "Cannot verify the collection or note location.");

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export const providerProjectsSchema = Schema.Struct({
  projects: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      source: Schema.String,
      local_path: Schema.NullOr(Schema.String),
      external_id: Schema.String.check(Schema.isPattern(uuidPattern)),
    }),
  ),
});
export const metadataSchema = Schema.Struct({
  file_path: Schema.String,
  title: Schema.String,
  checksum: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
});
export const searchPageSchema = Schema.Struct({
  has_more: Schema.Boolean,
  results: Schema.Array(
    Schema.Struct({
      file_path: Schema.String,
      project_external_id: Schema.String,
      content: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ).check(Schema.isMaxLength(8)),
});

export type Collection = { scope: MemoryScope; name: string; directory: string; id: string };
function mapFsError(error: PlatformError): CrewError {
  if (error.reason._tag === "NotFound") return missing();
  return memoryError(error);
}

export class MemoryCollections {
  private readonly locks: Locks;
  constructor(
    readonly root: string,
    private provider: Pick<MemoryProvider, "callEffect">,
    private mode: "text" | "hybrid",
    locks?: Locks,
  ) {
    this.locks = locks ?? new FileLocks(AbsolutePath.make(join(this.root, "receipts", "locks")));
  }

  private callProvider(
    name: string,
    args: Record<string, unknown>,
  ): Effect.Effect<unknown, CrewError> {
    return this.provider.callEffect(this.root, name, args);
  }

  projectEffect(scope: MemoryScope): Effect.Effect<Collection, CrewError> {
    return Effect.gen({ self: this }, function* () {
      const fs = yield* FileSystem.FileSystem;
      const name = projectName(scope),
        directory = join(this.root, "vault", name);
      yield* fs
        .makeDirectory(directory, { recursive: true, mode: 0o700 })
        .pipe(Effect.mapError(memoryError));
      const resolved = yield* fs.realPath(directory).pipe(Effect.mapError(memoryError));
      if (resolved !== directory) return yield* pathError();
      const list = () =>
        this.callProvider("bm_project", { command: "list" }).pipe(
          Effect.flatMap((raw) => decode(providerProjectsSchema, raw, "Memory projects")),
          Effect.map((parsed) => parsed.projects),
        );
      let projects = yield* list();
      if (!projects.some((p) => p.name === name)) {
        // The provider persists a single project registry for the installation.
        // Serialize creation across stdio clients as well as concurrent first reads.
        projects = yield* this.locks.with(LockKey.make("memory-projects"), () =>
          Effect.gen({ self: this }, function* () {
            const current = yield* list();
            if (current.some((p) => p.name === name)) return current;
            if (current.some((p) => p.local_path === directory)) return yield* pathError();
            yield* this.callProvider("bm_project", { command: "create", name, path: directory });
            return yield* list();
          }),
        );
      }
      const matches = projects.filter((p) => p.name === name || p.local_path === directory);
      const p = matches[0];
      if (
        matches.length !== 1 ||
        !p ||
        p.local_path !== directory ||
        p.name !== name ||
        p.source !== "local"
      )
        return yield* pathError();
      return { scope, name, directory, id: p.external_id };
    }).pipe(provideFileSystem);
  }

  exactEffect(
    project: Collection,
    path: string,
  ): Effect.Effect<{ raw: string; revision: string }, CrewError> {
    return Effect.scoped(
      Effect.gen(function* () {
        if (
          !path.endsWith(".md") ||
          path.length > 1024 ||
          // oxlint-disable-next-line no-control-regex -- Reject control characters in provider paths.
          /[\\:\x00-\x1f]/u.test(path) ||
          path.split("/").some((s) => !s || s === "." || s === "..")
        )
          return yield* pathError();
        const fs = yield* FileSystem.FileSystem;
        const file = join(project.directory, path);
        const resolved = yield* fs.realPath(file).pipe(Effect.mapError(mapFsError));
        if (resolved !== file || !file.startsWith(project.directory + sep))
          return yield* pathError();
        const handle = yield* fs
          .open(file, { flag: "r", noFollow: true })
          .pipe(Effect.mapError(mapFsError));
        const info = yield* handle.stat.pipe(Effect.mapError(mapFsError));
        const size = Number(ByteSize.toBigInt(info.size));
        if (
          info.type !== "File" ||
          size > 4 * 1024 * 1024 ||
          Option.getOrUndefined(info.nlink) !== 1n
        )
          return yield* missing();
        const buffer = Buffer.alloc(size);
        let offset = 0;
        while (offset < size) {
          const bytesRead = yield* handle
            .read(buffer.subarray(offset), { position: BigInt(offset) })
            .pipe(Effect.mapError(mapFsError));
          if (!bytesRead) return yield* conflict();
          offset += bytesRead;
        }
        const disk = yield* fs.lstat(file).pipe(Effect.mapError(mapFsError));
        const afterPath = yield* fs.realPath(file).pipe(Effect.mapError(mapFsError));
        if (
          Option.getOrUndefined(disk.ino) !== Option.getOrUndefined(info.ino) ||
          disk.dev !== info.dev ||
          ByteSize.toBigInt(disk.size) !== ByteSize.toBigInt(info.size) ||
          Option.getOrUndefined(disk.mtime)?.getTime() !==
            Option.getOrUndefined(info.mtime)?.getTime() ||
          afterPath !== file
        )
          return yield* conflict();
        return { raw: buffer.toString("utf8"), revision: hash(buffer) };
      }),
    ).pipe(provideFileSystem);
  }

  private checkedEffect(project: Collection, path: string) {
    return Effect.gen({ self: this }, function* () {
      const file = yield* this.exactEffect(project, path);
      const rawMeta = yield* this.callProvider("bm_read", {
        project: project.id,
        identifier: path,
        include_content: false,
      });
      const meta = yield* decode(metadataSchema, rawMeta, "Memory note metadata");
      if (meta.file_path !== path || meta.checksum !== file.revision) return yield* conflict();
      return {
        ...file,
        reference: { scope: project.scope, path, revision: file.revision },
        title: meta.title.slice(0, 256),
      };
    });
  }

  readEffect(repo: RepositoryId | undefined, input: typeof MemoryRead.Type) {
    return Effect.gen({ self: this }, function* () {
      const ref = input.reference;
      if (ref.scope.kind === "repository" && ref.scope.repository_id !== repo)
        return yield* missing();
      const project = yield* this.projectEffect(ref.scope);
      const result = yield* this.checkedEffect(project, ref.path);
      if (result.revision !== ref.revision) return yield* conflict();
      const offset = input.offset ?? 0;
      if (offset > result.raw.length) return yield* conflict();
      const body = result.raw.slice(offset, offset + 8192),
        end = offset + body.length,
        complete = end === result.raw.length;
      return {
        reference: result.reference,
        body,
        complete,
        ...(complete ? {} : { next_offset: end }),
      };
    });
  }

  searchEffect(repo: RepositoryId | undefined, input: typeof MemorySearch.Type) {
    return Effect.gen({ self: this }, function* () {
      const scopes: MemoryScope[] = repo
        ? [{ kind: "repository", repository_id: repo }, { kind: "shared" }]
        : [{ kind: "shared" }];
      const pageAt = (scope: MemoryScope, index: number, page: number) =>
        Effect.gen({ self: this }, function* () {
          const project = yield* this.projectEffect(scope);
          const rawPage = yield* this.callProvider("bm_search", {
            project: project.id,
            query: input.query,
            search_type: this.mode,
            items: ["note"],
            page,
            page_size: 8,
          });
          const data = yield* decode(searchPageSchema, rawPage, "Memory search page");
          const entries = yield* Effect.forEach(
            data.results,
            (hit) =>
              Effect.gen({ self: this }, function* () {
                if (hit.project_external_id !== project.id) return yield* pathError();
                const note = yield* this.checkedEffect(project, hit.file_path);
                const fragment = hit.content?.slice(0, 320);
                return {
                  reference: note.reference,
                  title: note.title || basename(hit.file_path),
                  excerpt:
                    fragment && note.raw.includes(fragment)
                      ? fragment
                      : note.raw
                          .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, "")
                          .trimStart()
                          .slice(0, 320),
                };
              }),
            { concurrency: 4 },
          );
          const more = data.has_more;
          const fingerprint = sha256(
            JSON.stringify([repo, input.query, this.mode, index, page, entries, more]),
          );
          return { entries, more, fingerprint };
        });
      const combined = (page: number) =>
        Effect.forEach(scopes, (scope, index) => pageAt(scope, index, page), {
          concurrency: 4,
        }).pipe(
          Effect.map((pages) => ({
            entries: pages.flatMap((p) => p.entries),
            more: pages.some((p) => p.more),
            fingerprint: sha256(JSON.stringify(pages.map((p) => p.fingerprint))),
          })),
        );
      let page = 1;
      if (input.cursor) {
        const m = /^([1-9][0-9]{0,5})\.([a-f0-9]{64})$/u.exec(input.cursor);
        if (!m) return yield* conflict();
        const prior = yield* combined(Number(m[1]));
        if (prior.fingerprint !== m[2] || !prior.more) return yield* conflict();
        page = Number(m[1]) + 1;
      }
      const result = yield* combined(page);
      return {
        entries: result.entries,
        ...(result.more ? { next_cursor: page + "." + result.fingerprint } : {}),
      };
    });
  }

  createEffect(
    project: Collection,
    path: string,
    content: string,
    title: string,
  ): Effect.Effect<void, CrewError> {
    return this.callProvider("bm_write", {
      project: project.id,
      identifier: path,
      title,
      content,
      overwrite: false,
    }).pipe(Effect.asVoid);
  }
}
