import { Effect } from "effect";
import { AbsolutePath, LockKey } from "../../src/identities.ts";
import { FileLocks } from "../../src/storage/lock.ts";

await Effect.runPromise(
  new FileLocks(AbsolutePath.make(process.argv[2]!)).with(LockKey.make("independent-owner"), () =>
    Effect.sync(() => process.stdout.write("owned\n")).pipe(Effect.andThen(Effect.never)),
  ),
);
