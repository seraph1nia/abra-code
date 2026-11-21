import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { WebAdmissions } from "../../src/web/gateway.ts";
import { CrewError } from "../../src/domain.ts";
import { SessionId, StorageKey, type MessageId } from "../../src/identities.ts";
import { MemoryStore, TestLocks } from "../fixtures.ts";

const session = SessionId.make("ses_web");
const input = { request_id: "stable-1", text: "Build this", delivery: "queue" as const };

test("exact receipt observation survives history growth and restart without another prompt or scan", async () => {
  const store = new MemoryStore();
  let prompts = 0;
  const runtime = {
    promptAdmission: () => Effect.succeed("absent" as const),
    prompt: () =>
      Effect.sync(() => {
        prompts++;
      }),
  };
  const admissions = new WebAdmissions(store, runtime, new TestLocks());
  const original = await Effect.runPromise(admissions.submit(session, input));
  for (let index = 0; index < 101; index++)
    await Effect.runPromise(
      store.set(StorageKey.make(`web/receipt/${session}/later-${index}`), {
        ...original,
        request_id: `later-${index}`,
        text: `Another tab's input ${index}`,
      }),
    );
  store.entries = () =>
    Effect.fail(new CrewError("SCAN_FORBIDDEN", "Exact reads must not scan history"));
  const restarted = new WebAdmissions(store, runtime, new TestLocks());
  assert.deepEqual(await Effect.runPromise(restarted.receipt(session, input.request_id)), original);
  assert.equal(await Effect.runPromise(restarted.receipt(session, "missing")), null);
  assert.equal(
    await Effect.runPromise(restarted.receipt(SessionId.make("ses_foreign"), input.request_id)),
    null,
  );
  assert.equal(prompts, 1);
});

test("receipt observation preserves uncertain admission without native reconciliation or replay", async () => {
  const store = new MemoryStore();
  let observations = 0;
  const admissions = new WebAdmissions(
    store,
    {
      promptAdmission: () =>
        Effect.sync(() => {
          observations++;
          return "consumed" as const;
        }),
      prompt: () => Effect.fail(new CrewError("RESPONSE_LOST", "Lost admission response")),
    },
    new TestLocks(),
  );
  const receipt = await Effect.runPromise(admissions.submit(session, input));
  assert.equal(receipt.status, "uncertain");
  assert.deepEqual(await Effect.runPromise(admissions.receipt(session, input.request_id)), receipt);
  assert.equal(observations, 0);
});

test("exact receipt reads reject unsafe keys and mismatched retained identity without mutation", async () => {
  const store = new MemoryStore();
  const admissions = new WebAdmissions(
    store,
    {
      promptAdmission: () => Effect.succeed("absent" as const),
      prompt: () => Effect.void,
    },
    new TestLocks(),
  );
  const receipt = await Effect.runPromise(admissions.submit(session, input));
  const key = StorageKey.make(`web/receipt/${session}/${input.request_id}`);
  const conflict = { ...receipt, request_id: "another-request" };
  await Effect.runPromise(store.set(key, conflict));
  await assert.rejects(
    Effect.runPromise(admissions.receipt(session, input.request_id)),
    /identity does not match/,
  );
  for (const unsafe of ["../foreign", "", "a".repeat(101), "request/child"])
    await assert.rejects(Effect.runPromise(admissions.receipt(session, unsafe)));
  assert.deepEqual(await Effect.runPromise(store.get(key)), conflict);
});

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

test("adapter receipt time uses the supplied clock and retained time survives clock regression", async () => {
  const store = new MemoryStore();
  const admissions = new WebAdmissions(
    store,
    {
      promptAdmission: () => Effect.succeed("consumed" as const),
      prompt: () => Effect.void,
    },
    new TestLocks(),
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2030-01-02T03:04:05Z"));
      const first = yield* admissions.submit(session, input);
      assert.equal(first.at, "2030-01-02T03:04:05.000Z");
      yield* TestClock.setTime(0);
      assert.deepEqual(yield* admissions.submit(session, input), first);
      assert.deepEqual(yield* admissions.receipt(session, input.request_id), first);
    }).pipe(Effect.provide(TestClock.layer())),
  );
});

test("selected submissions reconcile captured input across concurrent retries, edits and restart", async () => {
  const store = new MemoryStore(),
    locks = new TestLocks();
  const { IssueId, RelativePath, ContentHash } = await import("../../src/identities.ts");
  const selection = {
    kind: "diff" as const,
    issue_id: IssueId.make("abra-web"),
    file: RelativePath.make("source.ts"),
    scope: "all" as const,
    patch_id: ContentHash.make("a".repeat(64)),
    side: "additions" as const,
    start: 1,
    end: 1,
  };
  let current = true,
    prompts = 0,
    reads = 0;
  const capture = () => {
    reads++;
    return current
      ? Effect.succeed("original excerpt")
      : Effect.fail(new CrewError("SELECTION_STALE", "Selection changed"));
  };
  let observed = "";
  const runtime = {
    promptAdmission: (_s: SessionId, _id: MessageId, text: string) =>
      Effect.sync(() => (text === observed ? ("consumed" as const) : ("absent" as const))),
    prompt: (_s: SessionId, text: string) =>
      Effect.gen(function* () {
        prompts++;
        observed = text;
        return yield* new CrewError("RESPONSE_LOST", "After admission");
      }),
  };
  const admissions = new WebAdmissions(store, runtime, locks, capture);
  const chosen = { ...input, selection };
  const [original, retry] = await Effect.runPromise(
    Effect.all([admissions.submit(session, chosen), admissions.submit(session, chosen)], {
      concurrency: "unbounded",
    }),
  );
  assert.equal(original.message_id, retry.message_id);
  assert.equal(prompts, 1);
  assert.equal(reads, 1);
  assert.match(observed, /original excerpt/);
  assert.equal(original.capture?.excerpt, "original excerpt");
  current = false;
  const restarted = new WebAdmissions(store, runtime, locks, capture);
  assert.equal((await Effect.runPromise(restarted.submit(session, chosen))).status, "admitted");
  assert.equal(reads, 1);
  await assert.rejects(
    Effect.runPromise(
      restarted.submit(session, { ...chosen, selection: { ...selection, start: 2, end: 2 } }),
    ),
    /different input/,
  );
  await assert.rejects(
    Effect.runPromise(restarted.submit(session, { ...chosen, request_id: "new-id" })),
    /Selection changed/,
  );
  assert.equal(await Effect.runPromise(restarted.receipt(session, "new-id")), null);
  assert.equal(prompts, 1);
});

test("lost steer delivery remains on the original Abra session and identity", async () => {
  const store = new MemoryStore();
  const seen: unknown[][] = [];
  const runtime = {
    promptAdmission: () => Effect.succeed("consumed" as const),
    prompt: (...args: unknown[]) => {
      seen.push(args);
      return Effect.fail(new CrewError("LOST", "Lost response"));
    },
  };
  const request = { ...input, delivery: "steer" as const };
  const first = await Effect.runPromise(
    new WebAdmissions(store, runtime, new TestLocks()).submit(session, request),
  );
  const recovered = await Effect.runPromise(
    new WebAdmissions(store, runtime, new TestLocks()).submit(session, request),
  );
  assert.equal(first.status, "uncertain");
  assert.equal(recovered.status, "admitted");
  assert.deepEqual(seen, [[session, input.text, first.message_id, true]]);
});

test("memo handoff checks selected wording before admission and retains only the scoped reference", async () => {
  const ref = {
    instance: "https://notes.test",
    account: "users/me",
    name: "memos/second",
    wording_hash: "b".repeat(64),
  };
  const store = new MemoryStore();
  let available = false;
  const prompts: string[] = [];
  const admissions = new WebAdmissions(
    store,
    {
      promptAdmission: () => Effect.succeed("consumed" as const),
      prompt: (_session, text) =>
        Effect.sync(() => {
          prompts.push(text);
        }),
    },
    new TestLocks(),
    undefined,
    (selected) => {
      assert.deepEqual(selected, ref);
      return available
        ? Effect.void
        : Effect.fail(new CrewError("MEMOS_CHANGED", "Reselect the changed memo."));
    },
  );
  const question = { ...input, thought: ref };
  await assert.rejects(Effect.runPromise(admissions.submit(session, question)), /Reselect/);
  assert.equal(await Effect.runPromise(admissions.receipt(session, input.request_id)), null);
  assert.equal(prompts.length, 0);
  available = true;
  const accepted = await Effect.runPromise(admissions.submit(session, question));
  assert.deepEqual(accepted.thought, ref);
  assert.ok(prompts[0]!.includes(JSON.stringify(ref)));
  available = false;
  assert.deepEqual(await Effect.runPromise(admissions.submit(session, question)), accepted);
  await assert.rejects(
    Effect.runPromise(
      admissions.submit(session, { ...question, thought: { ...ref, name: "memos/first" } }),
    ),
    /different input/,
  );
  assert.equal(prompts.length, 1);
});
