import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Deferred, Effect, Fiber } from "effect";
import { WebAdmissions } from "../../src/web/gateway.ts";
import { CrewError } from "../../src/domain.ts";
import { SessionId, type MessageId } from "../../src/identities.ts";
import { MemoryStore, TestLocks } from "../fixtures.ts";

const session = SessionId.make("ses_web");
const input = { request_id: "stable-1", text: "Build this", delivery: "queue" as const };

test("native plugin receipt is durable before admission; concurrent tabs cannot rebind input", async () => {
  const store = new MemoryStore(),
    locks = new TestLocks();
  let prompts = 0;
  const runtime = {
    promptAdmission: () => Effect.succeed("absent" as const),
    prompt: (_session: SessionId, _text: string, id: MessageId) =>
      Effect.sync(() => {
        prompts++;
        const receipt = store.values.get(`web/receipt/${session}/${input.request_id}`) as {
          message_id: string;
          status: string;
        };
        assert.equal(receipt.message_id, id);
        assert.equal(receipt.status, "submitted");
      }),
  };
  const admissions = new WebAdmissions(store, runtime, locks);
  const [first, retry] = await Effect.runPromise(
    Effect.all([admissions.submit(session, input), admissions.submit(session, input)], {
      concurrency: "unbounded",
    }),
  );
  assert.equal(prompts, 1);
  assert.equal(first.message_id, retry.message_id);
  assert.equal(retry.status, "admitted");
  const rebound = await Effect.runPromise(
    admissions.submit(session, { ...input, text: "Different work" }).pipe(Effect.result),
  );
  assert.equal(rebound._tag, "Failure");
  assert.equal(prompts, 1);
});

test("lost admission response reconciles the same native message; absence remains uncertain", async () => {
  const store = new MemoryStore();
  let prompts = 0,
    observation: "consumed" | "absent" = "absent";
  const runtime = {
    promptAdmission: () => Effect.sync(() => observation),
    prompt: () =>
      Effect.gen(function* () {
        prompts++;
        return yield* new CrewError("RESPONSE_LOST", "Lost response after admission");
      }),
  };
  const admissions = new WebAdmissions(store, runtime, new TestLocks());
  const uncertain = await Effect.runPromise(admissions.submit(session, input));
  assert.equal(uncertain.status, "uncertain");
  assert.equal((await Effect.runPromise(admissions.submit(session, input))).status, "uncertain");
  observation = "consumed";
  const recovered = await Effect.runPromise(
    new WebAdmissions(store, runtime, new TestLocks()).submit(session, input),
  );
  assert.equal(recovered.status, "admitted");
  assert.equal(recovered.message_id, uncertain.message_id);
  assert.equal(prompts, 1);
});

test("disconnect cannot interrupt the short persisted admission critical section", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const store = new MemoryStore();
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const runtime = {
        promptAdmission: () => Effect.succeed("absent" as const),
        prompt: () =>
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
      };
      const admissions = new WebAdmissions(store, runtime, new TestLocks());
      const fiber = yield* admissions.submit(session, input).pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      const interrupted = yield* Fiber.interrupt(fiber).pipe(Effect.forkChild);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(interrupted);
      const receipt = store.values.get(`web/receipt/${session}/${input.request_id}`) as {
        status: string;
      };
      assert.equal(receipt.status, "admitted");
    }),
  );
});
