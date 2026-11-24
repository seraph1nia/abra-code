import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { Effect, Schedule } from "effect";
import type {
  MemoryPublication,
  MemoryRead,
  MemorySearch,
} from "@abracode/contracts/visibility/memory";
import { type Config, CrewError } from "../domain.ts";
import { AbsolutePath, type RepositoryId } from "@abracode/contracts/identities";
import { FileLocks } from "../storage/lock.ts";
import type { Records } from "../storage/store.ts";
import type { PersonalThoughts } from "../work/thoughts.ts";
import { canonicalJSON } from "../presentation/identity.ts";
import { MemoryProvider, memoryDirectoryEffect, memoryError } from "./provider.ts";
import { MemoryCollections, type Collection, hash, sameScope, conflict } from "./collections.ts";

const withMemoryTimeout = <A>(effect: Effect.Effect<A, CrewError>) =>
  effect.pipe(Effect.timeout("45 seconds"), Effect.mapError(memoryError));

const unresolved = () =>
  new CrewError(
    "MEMORY_UNRESOLVED",
    "Could not confirm the reserved note. Retry with the same request ID and wording.",
  );

function openReceiptDb(root: string): DatabaseSync {
  const db = new DatabaseSync(join(root, "receipts", "publications.sqlite"));
  db.exec(
    "PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS publications (request TEXT PRIMARY KEY, payload TEXT NOT NULL, target TEXT NOT NULL UNIQUE, title TEXT NOT NULL, markdown TEXT NOT NULL)",
  );
  return db;
}

function receipt(db: DatabaseSync, input: MemoryPublication, projectName?: string) {
  const payload = canonicalJSON(input);
  const target = "lesson-" + hash(input.request_id) + ".md";
  let fresh = false;
  if (projectName) {
    const kind = input.source.kind === "verified-procedure" ? "Verified procedure" : "Observation";
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
}

export class AgentMemory {
  private provider?: MemoryProvider;
  private receiptDb?: { root: string; db: DatabaseSync };
  private locks?: { root: string; locks: FileLocks };
  constructor(
    private config: Config,
    private records: Pick<Records, "projects">,
    private thoughts: Pick<PersonalThoughts, "get">,
  ) {}
  get enabled() {
    return this.config.memory?.enabled === true;
  }
  private getReceiptDb(root: string): DatabaseSync {
    if (this.receiptDb?.root === root) return this.receiptDb.db;
    if (this.receiptDb) {
      try {
        this.receiptDb.db.close();
      } catch {
        // Ignore already-closed handle when switching roots.
      }
      this.receiptDb = undefined;
    }
    const db = openReceiptDb(root);
    this.receiptDb = { root, db };
    return db;
  }
  private getLocks(root: string): FileLocks {
    if (this.locks?.root === root) return this.locks.locks;
    const locks = new FileLocks(AbsolutePath.make(join(root, "receipts", "locks")));
    this.locks = { root, locks };
    return locks;
  }
  close = () =>
    Effect.gen({ self: this }, function* () {
      if (this.provider) yield* this.provider.closeEffect();
      if (this.receiptDb) {
        const db = this.receiptDb.db;
        this.receiptDb = undefined;
        yield* Effect.sync(() => {
          try {
            db.close();
          } catch {
            // Ignore already-closed handle.
          }
        });
      }
    });
  private location = (repo?: RepositoryId) =>
    Effect.gen({ self: this }, function* () {
      const settings = this.config.memory;
      if (!settings?.enabled)
        return yield* new CrewError("MEMORY_DISABLED", "Enable memory in personal settings.");
      const projects = yield* this.records.projects();
      if (repo && !projects.some((p) => p.id === repo))
        return yield* new CrewError("MEMORY_SCOPE", "Select a registered repository.");
      const root = yield* withMemoryTimeout(
        memoryDirectoryEffect(
          this.config,
          projects.map((p) => p.path),
        ),
      );
      this.provider ??= new MemoryProvider(settings.executable);
      const notes = new MemoryCollections(
        root,
        this.provider,
        settings.retrieval ?? "text",
        undefined,
        this.getLocks(root),
      );
      return { root, notes };
    });
  search = (repo: RepositoryId | undefined, input: typeof MemorySearch.Type) =>
    this.location(repo).pipe(
      Effect.flatMap(({ notes }) => withMemoryTimeout(notes.searchEffect(repo, input))),
    );
  read = (repo: RepositoryId | undefined, input: typeof MemoryRead.Type) => {
    if (input.reference.scope.kind === "repository" && input.reference.scope.repository_id !== repo)
      return Effect.fail(new CrewError("MEMORY_SCOPE", "Note outside the selected scope."));
    return this.location(repo).pipe(
      Effect.flatMap(({ notes }) => withMemoryTimeout(notes.readEffect(repo, input))),
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
      const { root, notes } = yield* this.location(repo);
      const db = yield* Effect.try({ try: () => this.getReceiptDb(root), catch: memoryError });
      let saved = yield* Effect.try({ try: () => receipt(db, input), catch: memoryError });
      let project: Collection | undefined;
      if (!saved) {
        if (input.source.kind === "thought") {
          const memo = yield* this.thoughts.get(input.source.reference, "http");
          if (!memo.content.includes(input.content))
            return yield* new CrewError("MEMOS_EXCERPT", "Reselect the exact wording in Thoughts.");
        }
        if (input.corrects) yield* this.read(repo, { reference: input.corrects });
        project = yield* withMemoryTimeout(notes.projectEffect(input.destination));
        saved = yield* Effect.try({
          try: () => receipt(db, input, project!.name),
          catch: memoryError,
        });
      }
      if (!saved) return yield* unresolved();
      const { fresh, target, title, body } = saved;
      const resolvedProject = project;
      return yield* Effect.gen(function* () {
        const destination = resolvedProject ?? (yield* notes.projectEffect(input.destination));
        if (fresh) {
          // Only tolerate a transient transport drop during create so we can still
          // verify whether the reserved note actually landed on disk; propagate
          // conflicts, location, auth, and other real failures immediately.
          yield* notes.createEffect(destination, target, body, title).pipe(
            Effect.catchIf(
              (error) => error.code === "MEMORY_UNAVAILABLE",
              () => Effect.void,
            ),
          );
        }
        // An uncertain or repeated request only observes its reserved target. Reissuing
        // a create here could resurrect a file that an operator deliberately deleted.
        const file = yield* notes.exactEffect(destination, target).pipe(
          Effect.retry({
            schedule: Schedule.spaced("100 millis"),
            times: 9,
            while: (error) => error.code === "MEMORY_MISSING",
          }),
          Effect.mapError((error) => (error.code === "MEMORY_MISSING" ? unresolved() : error)),
        );
        if (file.raw !== body) return yield* conflict();
        return { scope: input.destination, path: target, revision: file.revision };
      }).pipe(
        Effect.timeout("45 seconds"),
        Effect.mapError((error) => (error instanceof CrewError ? error : unresolved())),
      );
    });
}
