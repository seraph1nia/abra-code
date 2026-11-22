import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { Effect } from "effect";
import { setTimeout as delay } from "node:timers/promises";
import type {
  MemoryPublication,
  MemoryRead,
  MemorySearch,
} from "@abracode/contracts/visibility/memory";
import { type Config, CrewError } from "../domain.ts";
import { type RepositoryId } from "../identities.ts";
import type { Records } from "../storage/store.ts";
import type { PersonalThoughts } from "../work/thoughts.ts";
import { canonicalJSON } from "../presentation/identity.ts";
import { MemoryProvider, memoryDirectory, memoryError } from "./provider.ts";
import { MemoryCollections, hash, sameScope, conflict } from "./collections.ts";

const perform = <A>(fn: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: (signal) => fn(AbortSignal.any([signal, AbortSignal.timeout(45_000)])),
    catch: memoryError,
  });
const unresolved = () =>
  new CrewError(
    "MEMORY_UNRESOLVED",
    "Could not confirm the reserved note. Retry with the same request ID and wording.",
  );
function receipt(root: string, input: MemoryPublication, projectName?: string) {
  const db = new DatabaseSync(join(root, "receipts", "publications.sqlite"));
  try {
    db.exec(
      "PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS publications (request TEXT PRIMARY KEY, payload TEXT NOT NULL, target TEXT NOT NULL UNIQUE, title TEXT NOT NULL, markdown TEXT NOT NULL)",
    );
    const payload = canonicalJSON(input);
    const target = "lesson-" + hash(input.request_id) + ".md";
    let fresh = false;
    if (projectName) {
      const kind =
        input.source.kind === "verified-procedure" ? "Verified procedure" : "Observation";
      const summary = input.content
        .split("\n")[0]
        .replace(/[^\p{L}\p{N} ]/gu, " ")
        .trim()
        .replace(/ +/g, " ")
        .slice(0, 48)
        .trim();
      const title = kind + " " + (summary || target.slice(7, 19));
      const correction = input.corrects
        ? "\n\nCorrects " +
          JSON.stringify(input.corrects.path) +
          " at revision " +
          input.corrects.revision +
          "."
        : "";
      // Basic Memory trims the end of its Markdown input. A trailing comment keeps
      // whitespace in a selected excerpt intact while staying invisible in the note.
      const suffix = correction || (/\s$/u.test(input.content) ? "\n\n<!-- End excerpt -->" : "");
      const markdown = `---\ntitle: ${title}\ntype: note\npermalink: ${projectName}/${target.slice(0, -3)}\n---\n\n## ${kind}\n\n${input.content}${suffix}`;
      fresh =
        db
          .prepare(
            "INSERT OR IGNORE INTO publications(request,payload,target,title,markdown) VALUES(?,?,?,?,?)",
          )
          .run(input.request_id, payload, target, title, markdown).changes === 1;
    }
    const row = db
      .prepare("SELECT payload,target,title,markdown FROM publications WHERE request=?")
      .get(input.request_id);
    if (!row) return;
    if (row.payload !== payload || row.target !== target)
      throw new CrewError("MEMORY_CONFLICT", "This request ID belongs to another publication.");
    if (typeof row.title !== "string" || typeof row.markdown !== "string") throw unresolved();
    return { fresh, target, title: row.title, body: row.markdown };
  } finally {
    db.close();
  }
}
export class AgentMemory {
  private provider?: MemoryProvider;
  constructor(
    private config: Config,
    private records: Pick<Records, "projects">,
    private thoughts: Pick<PersonalThoughts, "get">,
  ) {}
  get enabled() {
    return this.config.memory?.enabled === true;
  }
  close = () =>
    Effect.promise(async () => {
      await this.provider?.close();
    });
  private location = (repo?: RepositoryId) =>
    Effect.gen({ self: this }, function* () {
      const settings = this.config.memory;
      if (!settings?.enabled)
        return yield* new CrewError("MEMORY_DISABLED", "Enable memory in personal settings.");
      const projects = yield* this.records.projects();
      if (repo && !projects.some((p) => p.id === repo))
        return yield* new CrewError("MEMORY_SCOPE", "Select a registered repository.");
      const root = yield* perform(() =>
        memoryDirectory(
          this.config,
          projects.map((p) => p.path),
        ),
      );
      this.provider ??= new MemoryProvider(settings.executable);
      const provider = this.provider;
      return {
        root,
        collections: (signal: AbortSignal) =>
          new MemoryCollections(root, provider, settings.retrieval ?? "text", signal),
      };
    });
  search = (repo: RepositoryId | undefined, input: typeof MemorySearch.Type) =>
    this.location(repo).pipe(
      Effect.flatMap((loc) => perform((s) => loc.collections(s).search(repo, input))),
    );
  read = (repo: RepositoryId | undefined, input: typeof MemoryRead.Type) => {
    if (input.reference.scope.kind === "repository" && input.reference.scope.repository_id !== repo)
      return Effect.fail(new CrewError("MEMORY_SCOPE", "Note outside the selected scope."));
    return this.location(repo).pipe(
      Effect.flatMap((loc) => perform((s) => loc.collections(s).read(repo, input))),
    );
  };
  publish = (input: MemoryPublication) =>
    Effect.gen({ self: this }, function* () {
      const repo =
        input.destination.kind === "repository" ? input.destination.repository_id : undefined;
      if (input.corrects && !sameScope(input.corrects.scope, input.destination))
        return yield* new CrewError(
          "MEMORY_SCOPE",
          "Select a note in the correction's destination.",
        );
      const { root, collections } = yield* this.location(repo);
      let saved = yield* Effect.try({ try: () => receipt(root, input), catch: memoryError });
      if (!saved) {
        if (input.source.kind === "thought") {
          const memo = yield* this.thoughts.get(input.source.reference, "http");
          if (!memo.content.includes(input.content))
            return yield* new CrewError("MEMOS_EXCERPT", "Reselect the exact wording in Thoughts.");
        }
        if (input.corrects) yield* this.read(repo, { reference: input.corrects });
        const project = yield* perform((signal) => collections(signal).project(input.destination));
        saved = yield* Effect.try({
          try: () => receipt(root, input, project.name),
          catch: memoryError,
        });
      }
      if (!saved) return yield* unresolved();
      const { fresh, target, title, body } = saved;
      return yield* perform(async (signal) => {
        const notes = collections(signal);
        const project = await notes.project(input.destination);
        if (fresh) {
          try {
            await notes.create(project, target, body, title);
          } catch (cause) {
            if (cause instanceof CrewError && cause.code === "MEMORY_CONFLICT") throw cause;
          }
        }
        // An uncertain or repeated request only observes its reserved target. Reissuing
        // a create here could resurrect a file that an operator deliberately deleted.
        for (let attempt = 0; attempt < 10; attempt++) {
          try {
            const file = await notes.exact(project, target);
            if (file.raw !== body) throw conflict();
            return { scope: input.destination, path: target, revision: file.revision };
          } catch (cause) {
            if (!(cause instanceof CrewError) || cause.code !== "MEMORY_MISSING") throw cause;
            await delay(100, undefined, { signal });
          }
        }
        throw unresolved();
      }).pipe(
        Effect.mapError((error) =>
          error.code === "MEMORY_CONFLICT" || error.code === "MEMORY_LOCATION"
            ? error
            : unresolved(),
        ),
      );
    });
}
