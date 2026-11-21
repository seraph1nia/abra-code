import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { TestClock } from "effect/testing";
import { Effect, Scope, Exit, Fiber, Layer } from "effect";
import { ExecutionId, IssueId, MessageId, ObligationKey } from "../../src/identities.ts";
import {
  mergeChanges,
  workInvalidationKeys,
  type Observation,
} from "@abracode/contracts/web/changes";
import { observationDecision, semanticWorkspace } from "@abracode/contracts/web/observation";
import { nativeChangeScope } from "../../src/web/change-scopes.ts";
import {
  Invalidations,
  invalidationsLayer,
  publishInvalidations,
  committed,
  committedScope,
} from "../../src/visibility/invalidations.ts";
import { WorkspaceFixture } from "../helpers/web.ts";

const issue = IssueId.make("abra-observed");
const order = (epoch: string, sequence: number, baseline = false): Observation => ({
  epoch,
  sequence,
  baseline,
  changes: {},
});
test("observation order refuses duplicate/reordered/gapped and foreign-epoch deltas without wall time", () => {
  const current = order("epoch-a", 10);
  assert.equal(observationDecision(current, order("epoch-a", 10)), "duplicate");
  assert.equal(observationDecision(current, order("epoch-a", 9)), "duplicate");
  assert.equal(observationDecision(current, order("epoch-a", 11)), "accept");
  assert.equal(observationDecision(current, order("epoch-a", 12)), "baseline_required");
  assert.equal(observationDecision(current, order("epoch-a", 12, true)), "accept");
  assert.equal(observationDecision(current, order("epoch-b", 1)), "baseline_required");
  assert.equal(observationDecision(current, order("epoch-b", 1, true)), "accept");
  assert.equal(observationDecision(current, undefined), "baseline_required");
  assert.equal(observationDecision(undefined, order("epoch-a", 1)), "baseline_required");
});
test("semantic deduplication ignores observation freshness and preserves retained evidence times", () => {
  const value = new WorkspaceFixture().value;
  const later = {
    ...value,
    at: "2031-01-01T00:00:00Z",
    work: { ...value.work, at: value.work.at },
  };
  assert.deepEqual(semanticWorkspace(value), semanticWorkspace(later));
  const receipt = {
    request_id: "a",
    message_id: MessageId.make("msg_a"),
    text: "A",
    status: "admitted",
    delivery: "queue",
    at: "2031-01-01T00:00:00Z",
  } as const;
  assert.notDeepEqual(
    semanticWorkspace({ ...value, receipts: [receipt] }),
    semanticWorkspace({ ...value, receipts: [{ ...receipt, at: "2032-01-01T00:00:00Z" }] }),
  );
});
test("finishing ages advance without invalidating work and changed routing remains visible", () => {
  const value = new WorkspaceFixture().value;
  const snapshot = (at: number, routing: "pending" | "answered") =>
    semanticWorkspace({
      ...value,
      work: {
        ...value.work,
        work: value.work.work.map((item) => ({
          ...item,
          outcome: {
            execution_id: ExecutionId.make("finishing"),
            generation: 1,
            observed_at: at,
            finishing: {
              consumed: 0,
              automatic_remaining: 2,
              preflight_age_ms: at - 10,
              questions: [
                {
                  key: ObligationKey.make("finish"),
                  owner: "user",
                  question: "Preserve files?",
                  choices: ["preserve"],
                  age_ms: at - 20,
                  routing,
                },
              ],
            },
            approval: { kind: "merge", state: "recorded" },
            delivery: { kind: "branch", state: "verified" },
            cleanup: { state: "blocked", generated_paths: [] },
            closure: "open",
            next_action: "Inspect the remaining files",
          },
        })),
      },
    });
  assert.deepEqual(snapshot(100, "pending"), snapshot(200, "pending"));
  assert.notDeepEqual(snapshot(100, "pending"), snapshot(200, "answered"));
});
test("native event scopes respect controller home and session ownership across native locations", () => {
  const read = (type: string, data: unknown, directory = "/home/central") =>
    nativeChangeScope({ type, data, location: { directory } }, "/home/central", "ses_abra", (id) =>
      id === "ses_worker" ? issue : undefined,
    );
  assert.deepEqual(
    read(
      "rpc.abracode-visibility.changed",
      { home: "/home/central", scope: { issues: [issue], finder: true } },
      "/managed/repo",
    ),
    { issues: [issue], finder: true },
  );
  assert.equal(read("rpc.abracode-visibility.changed", { home: "/foreign" }), undefined);
  assert.deepEqual(read("rpc.abracode-visibility.changed", { home: "/home/central" }), {
    all: true,
  });
  assert.deepEqual(
    read("rpc.abracode-visibility.changed", {
      home: "/home/central",
      scope: { issues: "malformed" },
    }),
    { all: true },
  );
  assert.deepEqual(read("session.text.delta", { sessionID: "ses_abra" }), { transcript: true });
  assert.deepEqual(read("form.replied", { sessionID: "ses_abra" }), { attention: true });
  assert.deepEqual(read("form.created", { form: { sessionID: "ses_abra" } }), { attention: true });
  assert.deepEqual(read("session.inbox.enqueued", { sessionID: "ses_abra" }), {
    admissions: true,
    transcript: true,
  });
  assert.deepEqual(read("session.text.delta", { sessionID: "ses_worker" }, "/managed/repo"), {
    issues: [issue],
    finder: true,
  });
  for (const type of ["session.reasoning.delta", "session.viewed", "session.usage.updated"])
    assert.equal(read(type, { sessionID: "ses_abra" }), undefined);
  assert.equal(read("session.text.delta", { sessionID: "ses_foreign" }), undefined);
  assert.equal(read("session.text.delta", { sessionID: "ses_abra" }, "/foreign"), undefined);
});
test("committed scope bursts merge without losing affected IDs and broad legacy remains supported", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const queue = yield* Invalidations;
      yield* committedScope({ issues: [issue], finder: true });
      yield* committedScope({ attention: true });
      const scope = yield* queue.take;
      assert.deepEqual(scope.issues, [issue]);
      assert.equal(scope.attention, true);
      assert.equal(scope.finder, true);
      assert.deepEqual(mergeChanges({}, { all: true, work_all: true }), {
        all: true,
        work_all: true,
      });
      assert.deepEqual(mergeChanges({ all: true }, { issues: [issue] }), {
        all: true,
        work_all: true,
      });
      yield* committed;
      assert.deepEqual(yield* queue.take, { all: true });
      const many = Array.from({ length: 257 }, (_, i) => IssueId.make(`abra-${i}`));
      const bounded = mergeChanges({ issues: many.slice(0, 200) }, { issues: many.slice(200) });
      assert.equal(bounded.work_all, true);
      assert.equal(bounded.issues, undefined);
    }).pipe(Effect.provide(invalidationsLayer), Effect.scoped),
  );
});

test("selective work reactivity includes off-page identities and ignores transcript/attention freshness", () => {
  assert.deepEqual(
    workInvalidationKeys({ transcript: true, attention: true, admissions: true }),
    [],
  );
  assert.deepEqual(workInvalidationKeys({ issues: [issue], finder: true }), [
    "work-finder",
    `work:${issue}`,
  ]);
  assert.deepEqual(workInvalidationKeys({ all: true }), ["work-observed", "work-finder"]);
});

test("post-commit barrier retries merged scopes and releases a sleeping publisher", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Invalidations;
      const lifetime = yield* Scope.make();
      let passes = 0;
      const published: import("@abracode/contracts/web/changes").ChangeScope[] = [];
      const fiber = yield* publishInvalidations(
        events,
        Effect.suspend(() => (++passes === 2 ? Effect.void : Effect.fail("busy"))),
        (scope) =>
          Effect.sync(() => {
            published.push(scope);
          }),
      ).pipe(Effect.forkIn(lifetime));
      yield* events.publish({ issues: [issue] });
      yield* TestClock.adjust("0 millis");
      assert.equal(passes, 1);
      yield* events.publish({ finder: true });
      assert.equal(published.length, 0);
      yield* TestClock.adjust("250 millis");
      assert.equal(published.length, 1);
      assert.deepEqual(published[0]?.issues, [issue]);
      assert.equal(published[0]?.finder, true);
      yield* events.publish({ attention: true });
      yield* TestClock.adjust("0 millis");
      assert.equal(passes, 3);
      yield* Scope.close(lifetime, Exit.void);
      assert.ok(Exit.isFailure(yield* Fiber.await(fiber)));
      yield* TestClock.adjust("1 second");
      assert.equal(passes, 3);
    }).pipe(Effect.provide(Layer.merge(invalidationsLayer, TestClock.layer())), Effect.scoped),
  );
});
