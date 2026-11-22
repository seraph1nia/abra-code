import { Effect } from "effect";
import { FileLocks } from "../storage/lock.ts";
import { AbsolutePath, LockKey } from "../identities.ts";
import { memoryError } from "./provider.ts";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, realpath, stat } from "node:fs/promises";
import { basename, join, sep } from "node:path";
import { z } from "zod";
import type { MemoryScope, MemorySearch, MemoryRead } from "@abracode/contracts/visibility/memory";
import { type RepositoryId } from "../identities.ts";
import { CrewError } from "../domain.ts";
import type { MemoryProvider } from "./provider.ts";

export const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
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
const providerProjects = z.object({
  projects: z.array(
    z.object({
      name: z.string(),
      source: z.string(),
      local_path: z.string().nullable(),
      external_id: z.string().uuid(),
    }),
  ),
});
const metadata = z.object({
  file_path: z.string(),
  title: z.string(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
});
const searchPage = z.object({
  has_more: z.boolean(),
  results: z
    .array(
      z.object({
        file_path: z.string(),
        project_external_id: z.string(),
        content: z.string().nullable().optional(),
      }),
    )
    .max(8),
});
type Collection = { scope: MemoryScope; name: string; directory: string; id: string };
export class MemoryCollections {
  constructor(
    readonly root: string,
    private provider: Pick<MemoryProvider, "call">,
    private mode: "text" | "hybrid",
    readonly signal: AbortSignal,
  ) {}
  async project(scope: MemoryScope): Promise<Collection> {
    const name = projectName(scope),
      directory = join(this.root, "vault", name);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await realpath(directory)) !== directory) throw pathError();
    const list = async () =>
      providerProjects.parse(
        await this.provider.call(this.root, "bm_project", { command: "list" }, this.signal),
      ).projects;
    let projects = await list();
    if (!projects.some((p) => p.name === name)) {
      // The provider persists a single project registry for the installation.
      // Serialize creation across stdio clients as well as concurrent first reads.
      const locks = new FileLocks(AbsolutePath.make(join(this.root, "receipts", "locks")));
      projects = await Effect.runPromise(
        locks.with(LockKey.make("memory-projects"), () =>
          Effect.tryPromise({
            try: async () => {
              const current = await list();
              if (current.some((p) => p.name === name)) return current;
              if (current.some((p) => p.local_path === directory)) throw pathError();
              await this.provider.call(
                this.root,
                "bm_project",
                { command: "create", name, path: directory },
                this.signal,
              );
              return list();
            },
            catch: memoryError,
          }),
        ),
        { signal: this.signal },
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
      throw pathError();
    return { scope, name, directory, id: p.external_id };
  }
  async exact(project: Collection, path: string) {
    if (
      !path.endsWith(".md") ||
      path.length > 1024 ||
      // oxlint-disable-next-line no-control-regex -- Reject control characters in provider paths.
      /[\\:\x00-\x1f]/u.test(path) ||
      path.split("/").some((s) => !s || s === "." || s === "..")
    )
      throw pathError();
    const file = join(project.directory, path);
    try {
      if ((await realpath(file)) !== file || !file.startsWith(project.directory + sep))
        throw pathError();
      const handle = await open(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > 4 * 1024 * 1024 || info.nlink !== 1) throw missing();
        const buffer = Buffer.alloc(info.size);
        let offset = 0;
        while (offset < info.size) {
          const { bytesRead } = await handle.read(buffer, offset, info.size - offset, offset);
          if (!bytesRead) throw conflict();
          offset += bytesRead;
        }
        const disk = await stat(file);
        if (
          disk.ino !== info.ino ||
          disk.dev !== info.dev ||
          disk.size !== info.size ||
          disk.mtimeMs !== info.mtimeMs ||
          (await realpath(file)) !== file
        )
          throw conflict();
        return { raw: buffer.toString("utf8"), revision: hash(buffer) };
      } finally {
        await handle.close();
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") throw missing();
      throw cause;
    }
  }
  private async checked(project: Collection, path: string) {
    const file = await this.exact(project, path);
    const meta = metadata.parse(
      await this.provider.call(
        this.root,
        "bm_read",
        { project: project.id, identifier: path, include_content: false },
        this.signal,
      ),
    );
    if (meta.file_path !== path || meta.checksum !== file.revision) throw conflict();
    return {
      ...file,
      reference: { scope: project.scope, path, revision: file.revision },
      title: meta.title.slice(0, 256),
    };
  }
  async read(repo: RepositoryId | undefined, input: typeof MemoryRead.Type) {
    const ref = input.reference;
    if (ref.scope.kind === "repository" && ref.scope.repository_id !== repo) throw missing();
    const result = await this.checked(await this.project(ref.scope), ref.path);
    if (result.revision !== ref.revision) throw conflict();
    const offset = input.offset ?? 0;
    if (offset > result.raw.length) throw conflict();
    const body = result.raw.slice(offset, offset + 8192),
      end = offset + body.length,
      complete = end === result.raw.length;
    return {
      reference: result.reference,
      body,
      complete,
      ...(complete ? {} : { next_offset: end }),
    };
  }
  async search(repo: RepositoryId | undefined, input: typeof MemorySearch.Type) {
    const scopes: MemoryScope[] = repo
      ? [{ kind: "repository", repository_id: repo }, { kind: "shared" }]
      : [{ kind: "shared" }];
    const pageAt = async (index: number, page: number) => {
      const project = await this.project(scopes[index]);
      const data = searchPage.parse(
        await this.provider.call(
          this.root,
          "bm_search",
          {
            project: project.id,
            query: input.query,
            search_type: this.mode,
            items: ["note"],
            page,
            page_size: 8,
          },
          this.signal,
        ),
      );
      const entries = [];
      for (const hit of data.results) {
        if (hit.project_external_id !== project.id) throw pathError();
        const note = await this.checked(project, hit.file_path);
        const fragment = hit.content?.slice(0, 320);
        entries.push({
          reference: note.reference,
          title: note.title || basename(hit.file_path),
          excerpt:
            fragment && note.raw.includes(fragment)
              ? fragment
              : note.raw
                  .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, "")
                  .trimStart()
                  .slice(0, 320),
        });
      }
      const more = data.has_more;
      const fingerprint = hash(
        JSON.stringify([repo, input.query, this.mode, index, page, entries, more]),
      );
      return { entries, more, fingerprint };
    };
    const combined = async (page: number) => {
      const pages = [];
      for (let index = 0; index < scopes.length; index++) pages.push(await pageAt(index, page));
      return {
        entries: pages.flatMap((p) => p.entries),
        more: pages.some((p) => p.more),
        fingerprint: hash(JSON.stringify(pages.map((p) => p.fingerprint))),
      };
    };
    let page = 1;
    if (input.cursor) {
      const m = /^([1-9][0-9]{0,5})\.([a-f0-9]{64})$/u.exec(input.cursor);
      if (!m) throw conflict();
      const prior = await combined(Number(m[1]));
      if (prior.fingerprint !== m[2] || !prior.more) throw conflict();
      page = Number(m[1]) + 1;
    }
    const result = await combined(page);
    return {
      entries: result.entries,
      ...(result.more ? { next_cursor: page + "." + result.fingerprint } : {}),
    };
  }
  async create(project: Collection, path: string, content: string, title: string) {
    await this.provider.call(
      this.root,
      "bm_write",
      { project: project.id, identifier: path, title, content, overwrite: false },
      this.signal,
    );
  }
}
