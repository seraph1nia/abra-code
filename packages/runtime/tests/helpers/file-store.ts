import { StorageKey } from "../../src/identities.ts";
import { Effect } from "effect";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { CrewError } from "../../src/domain.ts";
import { type Store } from "../../src/storage/store.ts";
/** Test-only shared storage: atomic JSON publication under real controller locks. */
export class FileStore implements Store {
  constructor(private root: string) {}
  get(key: StorageKey) {
    return Effect.tryPromise({
      try: async (): Promise<unknown> =>
        JSON.parse(await readFile(join(this.root, `${key}.json`), "utf8")),
      catch: CrewError.from,
    }).pipe(
      Effect.catchIf(
        (error) => error.code === "ENOENT",
        () => Effect.void,
      ),
    );
  }
  set<T>(key: StorageKey, value: T) {
    return Effect.tryPromise({
      try: async () => {
        const path = join(this.root, `${key}.json`),
          temp = `${path}.${randomUUID()}.tmp`;
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temp, JSON.stringify(value));
        await rename(temp, path);
      },
      catch: CrewError.from,
    });
  }
  entries(prefix: string) {
    return Effect.tryPromise({
      try: async () => {
        const files = await readdir(this.root, { recursive: true });
        return await Promise.all(
          files
            .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
            .map(async (name) => ({
              key: StorageKey.make(name.slice(0, -5)),
              value: JSON.parse(await readFile(join(this.root, name), "utf8")) as unknown,
            })),
        );
      },
      catch: CrewError.from,
    });
  }
}
