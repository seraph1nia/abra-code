import { Effect } from "effect";
import { AbsolutePath, LockKey } from "@abracode/contracts/identities";
import { FileLocks } from "../../src/storage/lock.ts";

// Keep this fixture alive while it owns the lock; the binding starts no child.
process.stdin.resume();

await Effect.runPromise(
  new FileLocks(AbsolutePath.make(process.argv[2]!), process.argv[4] || undefined).with(
    LockKey.make("independent-owner"),
    () => Effect.sync(() => process.stdout.write("owned\n")).pipe(Effect.andThen(Effect.never)),
    { shared: process.argv[3] === "shared" },
  ),
);
