import { Coordination } from "../../src/workflow/coordination.ts";
import { readFile, writeFile, rename } from "node:fs/promises";
import { Effect } from "effect";
import { CrewError } from "../../src/domain.ts";
import { IssueId, StorageKey, AbsolutePath } from "@abracode/contracts/identities";
import { Records, type Store } from "../../src/storage/store.ts";
import { FileLocks } from "../../src/storage/lock.ts";

/** Child-process fixture for the actual repository and kernel coordination code. */
const [file, locks, barrier, issue, field, mode] = process.argv.slice(2);
if (
  !file ||
  !locks ||
  !barrier ||
  !issue ||
  !["retry_instructions", "error_or_recovery_reason"].includes(field ?? "")
)
  throw new Error("Expected an owned fixture file, locks, barrier, issue and supported field");
const key = StorageKey.make(`execution/${issue}`);
const observation = StorageKey.make("observation/records-revision");
const read = (path: string) =>
  Effect.tryPromise({
    try: async (): Promise<unknown> => JSON.parse(await readFile(path, "utf8")),
    catch: CrewError.from,
  });
const revisionFile = `${file}.revision`;
const store: Store = {
  get: (requested) =>
    requested === key
      ? read(file)
      : requested === observation
        ? read(revisionFile).pipe(
            Effect.catchIf(
              (error) => error.code === "ENOENT",
              () => Effect.undefined,
            ),
          )
        : Effect.undefined,
  set: (requested, value) =>
    Effect.tryPromise({
      try: async () => {
        const target =
          requested === key ? file : requested === observation ? revisionFile : undefined;
        if (!target) throw new Error("Unexpected fixture key");
        const temporary = `${target}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify(value));
        await rename(temporary, target);
      },
      catch: CrewError.from,
    }),
  entries: (prefix) =>
    read(file).pipe(Effect.map((value) => (key.startsWith(prefix) ? [{ key, value }] : []))),
};
const records = new Records(store, new Coordination(new FileLocks(AbsolutePath.make(locks))));
const result = await Effect.runPromise(
  Effect.gen(function* () {
    let e = yield* records.execution(IssueId.make(issue));
    if (!e) return yield* new CrewError("FIXTURE_RECORD", "Missing fixture execution");
    yield* Effect.tryPromise({
      try: () => writeFile(`${barrier}.${field}.ready`, "ready"),
      catch: CrewError.from,
    });
    while (
      !(yield* Effect.tryPromise({
        try: () => readFile(`${barrier}.go`, "utf8"),
        catch: CrewError.from,
      }).pipe(Effect.isSuccess))
    )
      yield* Effect.sleep("5 millis");
    if (field === "retry_instructions") e = { ...e, retry_instructions: field };
    else e = { ...e, error_or_recovery_reason: field };
    const saved = yield* (
      mode === "replace"
        ? records.save(e)
        : field === "retry_instructions"
          ? records.commitOwned(e, { retry_instructions: field })
          : records.saveOwned(e, ["error_or_recovery_reason"])
    ).pipe(Effect.result);
    return saved._tag === "Success"
      ? { status: "committed", revision: saved.success.revision }
      : { status: saved.failure.code };
  }),
);
process.stdout.write(JSON.stringify(result) + "\n");
