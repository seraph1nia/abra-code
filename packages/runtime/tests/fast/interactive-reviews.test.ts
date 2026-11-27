import { searchPublications } from "../../src/presentation/associations.ts";
import { reviewDefinition } from "../helpers/interactive-reviews.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Deferred, Effect, Schema } from "effect";
import { Catalog, MessageProcessor } from "@a2ui/web_core/v1_0";
import {
  ReviewDefinitionSchema,
  ReviewPublishSchema,
  ReviewSubmitSchema,
  reviewAnswerErrors,
} from "@abracode/contracts/web/reviews";
import {
  reviewCatalog,
  implementedReviewCatalog,
  reviewCatalogDocument,
  reviewSurface,
} from "@abracode/contracts/web/review-catalog";
import { validateSurface } from "@abracode/contracts/web/surfaces";
import { Reviews } from "../../src/web/reviews.ts";
import { WebAdmissions } from "../../src/web/gateway.ts";
import { CrewError } from "../../src/domain.ts";
import { ContentHash, MessageId, SessionId, StorageKey } from "@abracode/contracts/identities";
import { MemoryStore, TestLocks } from "../fixtures.ts";

const session = SessionId.make("ses_review"),
  message = MessageId.make("msg_review");

function fixture() {
  const store = new MemoryStore(),
    locks = new TestLocks();
  let changed = false,
    prompts = 0,
    admitted = true;
  const source = () =>
    changed
      ? Effect.fail(new CrewError("REVIEW_REFUSED", "Source changed"))
      : Effect.succeed({ text: "Plan" });
  const reviews = new Reviews(store, locks, source);
  const admissions = new WebAdmissions(
    store,
    {
      prompt: () =>
        Effect.sync(() => {
          prompts++;
        }),
      promptAdmission: () => Effect.succeed(admitted ? ("consumed" as const) : ("absent" as const)),
    },
    locks,
  );
  return {
    store,
    locks,
    reviews,
    admissions,
    source,
    setChanged: () => {
      changed = true;
    },
    setAbsent: () => {
      admitted = false;
    },
    prompts: () => prompts,
  };
}

test("review catalog uses the official complete-surface processor without widening evidence catalogs", () => {
  assert.deepEqual([...Catalog.fromJson(reviewCatalogDocument).functions.keys()].sort(), [
    "length",
    "required",
  ]);
  const processor = new MessageProcessor(
    [implementedReviewCatalog([...reviewCatalog.components.values()])],
    undefined,
    { version: "1.0" },
  );
  try {
    processor.processMessages(reviewSurface(reviewDefinition()));
    assert.ok(processor.model.getSurface("plan-feedback"));
  } finally {
    processor.dispose();
  }
  assert.throws(() => validateSurface(reviewSurface(reviewDefinition())));
});

test("review definitions and answers reject unknown, executable, repeated and wrong-shaped values", () => {
  const review = reviewDefinition();
  for (const invalid of [
    { ...review, callback: "execute" },
    { ...review, fields: [review.fields[0], review.fields[0]] },
    {
      ...review,
      fields: [
        {
          ...review.fields[0],
          options: [
            { value: "same", label: "One" },
            { value: "same", label: "Two" },
          ],
        },
      ],
    },
  ])
    assert.throws(() =>
      Schema.decodeUnknownSync(ReviewDefinitionSchema, { onExcessProperty: "error" })(invalid),
    );
  assert.ok(reviewAnswerErrors(review, { direction: "invented" }).direction);
  assert.ok(reviewAnswerErrors(review, { direction: ["simple"] }).direction);
  assert.ok(
    reviewAnswerErrors(review, { direction: "simple", features: ["email", "email"] }).features,
  );
  assert.ok(reviewAnswerErrors(review, { direction: "simple", approve: "yes" }).approve);
  assert.deepEqual(
    reviewAnswerErrors(review, {
      direction: "simple",
      features: ["email"],
      comments: "Use A's navigation",
    }),
    {},
  );
  assert.throws(() =>
    Schema.decodeSync(ReviewPublishSchema)({
      review,
      previews: [{ id: "escape", path: "../secret.png" }],
    }),
  );
});

test("immutable publication recovers interrupted associations, supersedes and never rolls heads back", async () => {
  const f = fixture(),
    review = reviewDefinition();
  const original = f.store.set.bind(f.store);
  let interrupted = true;
  f.store.set = (key, value) =>
    key.startsWith("web/presentation/") && interrupted
      ? ((interrupted = false), Effect.fail(new CrewError("INTERRUPTED", "Lost publication")))
      : original(key, value);
  await assert.rejects(Effect.runPromise(f.reviews.publish(session, message, "first", { review })));
  assert.deepEqual((await Effect.runPromise(f.reviews.list(session))).reviews, []);
  await assert.rejects(
    Effect.runPromise(f.reviews.read(session, { review_id: review.review_id, revision: 1 })),
    (error: unknown) => error instanceof CrewError && error.code === "REVIEW_PENDING",
  );
  const restarted = new Reviews(f.store, f.locks, f.source);
  await Effect.runPromise(restarted.recover(session));
  const first = await Effect.runPromise(restarted.publish(session, message, "first", { review }));
  assert.equal(first.revision, 1);
  const second = await Effect.runPromise(
    restarted.publish(session, MessageId.make("msg_later"), "second", {
      review: { ...review, title: "Updated choices" },
    }),
  );
  assert.equal(second.revision, 2);
  await Effect.runPromise(restarted.publish(session, message, "first", { review }));
  const old = await Effect.runPromise(restarted.read(session, first));
  assert.equal(old.current_revision, 2);
  assert.match(old.unavailable!, /superseded/);
  await assert.rejects(
    Effect.runPromise(
      restarted.publish(session, message, "first", {
        review: { ...review, title: "Conflicting retry" },
      }),
    ),
  );
  await assert.rejects(Effect.runPromise(restarted.read(SessionId.make("ses_foreign"), first)));
  assert.equal((await Effect.runPromise(restarted.list(session))).reviews[0]?.revision, 2);
});

for (const point of ["reservation", "record", "association", "head"] as const) {
  test(`review readers preserve only committed evidence across interruption after ${point}`, async () => {
    const f = fixture();
    const review = reviewDefinition();
    const first = await Effect.runPromise(f.reviews.publish(session, message, "first", { review }));
    const nextMessage = MessageId.make("msg_next_review");
    const revised = { review: { ...review, title: "Revised direction" } };
    const selection = { review_id: first.review_id, revision: 2 };
    const entered = Deferred.makeUnsafe();
    const release = Deferred.makeUnsafe();
    const save = f.store.set.bind(f.store);
    let once = true;
    f.store.set = (key, value) => {
      const head = key.includes("/head/");
      const pending = typeof value === "object" && value !== null && "pending" in value;
      const interrupt =
        once &&
        (point === "reservation"
          ? head && pending
          : point === "record"
            ? key.includes("/record/")
            : point === "association"
              ? key.startsWith("web/presentation/")
              : head && !pending);
      if (!interrupt) return save(key, value);
      once = false;
      return save(key, value).pipe(
        Effect.andThen(Deferred.succeed(entered, undefined)),
        Effect.andThen(Deferred.await(release)),
        Effect.andThen(Effect.fail(new CrewError("INTERRUPTED", "Lost publication response"))),
      );
    };
    const publish = Effect.runPromise(
      f.reviews.publish(session, nextMessage, "second", revised).pipe(Effect.result),
    );
    const search = () =>
      Effect.runPromise(
        searchPublications(f.store, session, { search: "second" }, (target) =>
          target.kind === "review"
            ? f.reviews.searchCommitted(session, target)
            : Effect.succeed(false),
        ),
      );
    try {
      await Effect.runPromise(Deferred.await(entered));
      assert.equal((await search()).entries.length, point === "head" ? 1 : 0);
      const before = await Effect.runPromise(f.reviews.list(session));
      assert.deepEqual(
        before.reviews.map((r) => r.revision),
        [point === "head" ? 2 : 1],
      );
      const attachments = await Effect.runPromise(
        f.reviews.presentations(session, [message, nextMessage]),
      );
      assert.deepEqual(
        attachments.entries.map((entry) => entry.message_id),
        point === "head" ? [message, nextMessage] : [message],
      );
      if (point !== "head") {
        const pending = (error: unknown) =>
          error instanceof CrewError && error.code === "REVIEW_PENDING";
        await assert.rejects(Effect.runPromise(f.reviews.read(session, selection)), pending);
        await assert.rejects(
          Effect.runPromise(
            f.reviews.asset(session, {
              ...selection,
              hash: ContentHash.make("0".repeat(64)),
            }),
          ),
          pending,
        );
        assert.equal((await Effect.runPromise(f.reviews.read(session, first))).current_revision, 1);
      }
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await publish;
    }
    assert.equal((await publish)._tag, "Failure");
    const restarted = new Reviews(f.store, f.locks, f.source);
    await Effect.runPromise(restarted.recover(session));
    const returned = await Effect.runPromise(
      restarted.publish(session, nextMessage, "second", revised),
    );
    assert.equal(returned.revision, 2);
    assert.equal((await search()).entries.length, 1);
    assert.equal(
      (await Effect.runPromise(restarted.read(session, selection))).record.hash,
      returned.hash,
    );
    assert.equal(
      (await Effect.runPromise(restarted.presentations(session, [nextMessage]))).entries.length,
      1,
    );
  });
}

test("legacy review heads remain isolated during reads and recovery", async () => {
  const f = fixture();
  const review = reviewDefinition();
  const first = await Effect.runPromise(f.reviews.publish(session, message, "first", { review }));
  const headKey = StorageKey.make(`web/review/${session}/head/${first.review_id}`);
  const save = f.store.set.bind(f.store);
  const nextMessage = MessageId.make("msg_legacy_pending");
  f.store.set = (key, value) =>
    key === headKey && typeof value === "object" && value !== null && "pending" in value
      ? save(key, {
          current: { review_id: first.review_id, revision: 2 },
          pending: value.pending,
        }).pipe(
          Effect.andThen(Effect.fail(new CrewError("INTERRUPTED", "Legacy head was left pending"))),
        )
      : save(key, value);
  await assert.rejects(
    Effect.runPromise(f.reviews.publish(session, nextMessage, "second", { review })),
    /Legacy head/,
  );
  const original = await Effect.runPromise(f.store.get(headKey));
  await Effect.runPromise(f.reviews.recover(session));
  const result = await Effect.runPromise(f.reviews.list(session));
  assert.deepEqual(result.reviews, []);
  assert.ok(result.diagnostics.length);
  await assert.rejects(Effect.runPromise(f.reviews.read(session, first)));
  assert.deepEqual(await Effect.runPromise(f.store.get(headKey)), original);
});

test("feedback validates source and answers and reuses original admission after source change and restart", async () => {
  const f = fixture(),
    ref = await Effect.runPromise(
      f.reviews.publish(session, message, "publish", { review: reviewDefinition() }),
    );
  const input = Schema.decodeSync(ReviewSubmitSchema)({
    review_id: ref.review_id,
    revision: ref.revision,
    hash: ref.hash,
    request_id: "feedback-one",
    answers: { direction: "simple", features: ["email"], comments: "Keep this focused" },
  });
  await assert.rejects(
    Effect.runPromise(
      f.reviews.submit(session, { ...input, answers: { direction: "bad" } }, f.admissions),
    ),
  );
  assert.equal(f.prompts(), 0);
  const entries = f.store.entries.bind(f.store);
  f.store.entries = (prefix) => {
    assert.ok(!prefix.startsWith("web/review/"), "submission must only read the selected review");
    return entries(prefix);
  };
  const receipt = await Effect.runPromise(f.reviews.submit(session, input, f.admissions));
  f.store.entries = entries;
  assert.equal(receipt.status, "admitted");
  assert.equal(f.prompts(), 1);
  assert.match(receipt.text, /abra_review_ui action response/);
  assert.ok(!receipt.text.includes("Keep this focused"));
  assert.deepEqual(await Effect.runPromise(f.reviews.response(session, input.request_id)), input);
  await assert.rejects(
    Effect.runPromise(f.reviews.response(SessionId.make("ses_other"), input.request_id)),
  );
  const evidence = await Effect.runPromise(f.reviews.receipt(session, input, f.admissions));
  assert.ok(evidence?.feedback?.choices.some((c) => c.answer === "Email login"));
  const legacy = { ...input, request_id: "feedback-original-transport" };
  const legacyText = "Original queued feedback payload";
  await Effect.runPromise(
    f.store.set(StorageKey.make(`web/review/${session}/response/${legacy.request_id}`), {
      input: legacy,
      text: legacyText,
    }),
  );
  const replay = await Effect.runPromise(f.reviews.submit(session, legacy, f.admissions));
  assert.equal(replay.text, legacyText);
  f.setChanged();
  const restarted = new Reviews(f.store, f.locks, f.source);
  assert.deepEqual(
    await Effect.runPromise(restarted.submit(session, input, f.admissions)),
    receipt,
  );
  assert.equal(f.prompts(), 2);
  await assert.rejects(
    Effect.runPromise(
      restarted.submit(session, { ...input, request_id: "new-after-change" }, f.admissions),
    ),
  );
  await assert.rejects(
    Effect.runPromise(
      restarted.submit(session, { ...input, answers: { direction: "complete" } }, f.admissions),
    ),
  );
});

test("unconfirmed native admissions remain uncertain without replaying a prompt", async () => {
  const f = fixture();
  let prompts = 0;
  const admissions = new WebAdmissions(
    f.store,
    {
      prompt: () => {
        prompts++;
        return Effect.fail(new CrewError("LOST", "Lost native response"));
      },
      promptAdmission: () => Effect.succeed("absent" as const),
    },
    f.locks,
  );
  const ref = await Effect.runPromise(
    f.reviews.publish(session, message, "publish", { review: reviewDefinition() }),
  );
  const input = Schema.decodeSync(ReviewSubmitSchema)({
    review_id: ref.review_id,
    revision: ref.revision,
    hash: ref.hash,
    request_id: "uncertain",
    answers: { direction: "simple" },
  });
  assert.equal(
    (await Effect.runPromise(f.reviews.submit(session, input, admissions))).status,
    "uncertain",
  );
  assert.equal(
    (await Effect.runPromise(f.reviews.submit(session, input, admissions))).status,
    "uncertain",
  );
  assert.equal(prompts, 1);
});
