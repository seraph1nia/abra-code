import { useWorkspaceCall } from "../data.ts";
import { useEffect, useState, type ComponentProps } from "react";
import { useAtomSet } from "@effect/atom-react";
import { Cause, Exit, Option } from "effect";
import {
  reviewAnswerErrors,
  type ReviewSelection,
  type ReviewSource,
  type ReviewView,
  type ReviewRecord,
} from "@abracode/contracts/web/reviews";
import { ReviewSubmitSchema } from "@abracode/contracts/web/reviews";
import { Schema } from "effect";
import { Button } from "@abracode/presentation/ui/button";
import {
  reviewListQuery,
  reviewQuery,
  reviewAssetQuery,
  submitReview,
  readReviewReceipt,
} from "../review-data.ts";
import { RequestState } from "../request-state.tsx";
import { requestError } from "../request-error.ts";
import { useReviewDraft } from "../review-state.ts";
import { deferred } from "@abracode/presentation/deferred";

const ReviewControls = deferred<
  ComponentProps<typeof import("@abracode/presentation/reviews").ReviewControls>
>(
  () => import("@abracode/presentation/reviews").then((m) => ({ default: m.ReviewControls })),
  "Interactive review",
);
function matchesReceipt(
  input: typeof ReviewSubmitSchema.Type,
  receipt: { request_id: string; review_id: string; revision: number; hash: string },
) {
  return (
    receipt.request_id === input.request_id &&
    receipt.review_id === input.review_id &&
    receipt.revision === input.revision &&
    receipt.hash === input.hash
  );
}
export function ReviewAttachment({ target }: { target: ReviewSelection }) {
  return <RevisionSelection key={`${target.review_id}/${target.revision}`} target={target} />;
}
function RevisionSelection({ target }: { target: ReviewSelection }) {
  const [selection, setSelection] = useState(target);
  return (
    <div data-review-reference={`${selection.review_id}/${selection.revision}`}>
      <RequestState query={reviewQuery(selection)}>
        {(view) => <ReviewPanel key={view.record.hash} view={view} open={setSelection} />}
      </RequestState>
    </div>
  );
}
function ReviewImage({ record, id, label }: { record: ReviewRecord; id: string; label: string }) {
  const [failed, setFailed] = useState(false);
  const asset = record.assets.find((a) => a.id === id);
  if (!asset) return <output>Preview unavailable.</output>;
  return (
    <RequestState
      query={reviewAssetQuery(
        { review_id: record.review.review_id, revision: record.revision },
        asset.hash,
      )}
      showRefresh={false}
    >
      {(image) =>
        failed ? (
          <output>This image could not be displayed.</output>
        ) : (
          <img
            alt={label}
            src={`data:${image.mime};base64,${image.data}`}
            loading="lazy"
            onError={() => setFailed(true)}
          />
        )
      }
    </RequestState>
  );
}
function ReviewPanel({
  view,
  open,
}: {
  view: ReviewView;
  open: (selection: ReviewSelection) => void;
}) {
  const { record } = view;
  const { state, update, change, current } = useReviewDraft(record);
  const send = useAtomSet(submitReview(record.hash), { mode: "promiseExit" });
  const receiptLookup = useWorkspaceCall(readReviewReceipt);
  const pending = state.pending;
  const pendingId = pending?.request_id;
  useEffect(() => {
    const pending = current().pending;
    if (!pendingId || pending?.request_id !== pendingId) return;
    let mounted = true;
    void receiptLookup({
      request_id: pending.request_id,
      review_id: pending.review_id,
      revision: pending.revision,
      hash: pending.hash,
    }).then((result) => {
      if (!mounted || !Exit.isSuccess(result) || !result.value) return;
      const receipt = result.value;
      if (receipt.status === "admitted" && matchesReceipt(pending, receipt))
        update({
          pending: undefined,
          receipt: {
            ...receipt,
            review_id: pending.review_id,
            revision: pending.revision,
            hash: pending.hash,
          },
          working: false,
          error: undefined,
        });
    });
    return () => {
      mounted = false;
    };
  }, [pendingId, current, receiptLookup, update]);
  async function submit() {
    const saved = current();
    if (saved.working || saved.receipt?.status === "admitted") return;
    const errors = reviewAnswerErrors(record.review, saved.answers);
    if (Object.keys(errors).length) {
      update({ errors });
      return;
    }
    let input = saved.pending;
    if (!input) {
      if (view.unavailable) return;
      const decoded = Schema.decodeResult(ReviewSubmitSchema)({
        review_id: record.review.review_id,
        revision: record.revision,
        hash: record.hash,
        request_id: crypto.randomUUID(),
        answers: saved.answers,
      });
      if (decoded._tag === "Failure") {
        update({ error: "Review answers exceed the supported submission limits." });
        return;
      }
      input = decoded.success;
    }
    if (!update({ pending: input, working: true, error: undefined }, true)) {
      update({ working: false });
      return;
    }
    const result = await send(input);
    if (Exit.isSuccess(result) && !matchesReceipt(input, result.value)) {
      update({
        working: false,
        error:
          "Submission identity conflicts with the receipt. Your pending response was preserved.",
      });
      return;
    }
    if (Exit.isSuccess(result))
      update({
        working: false,
        receipt: result.value,
        pending: result.value.status === "admitted" ? undefined : input,
        error:
          result.value.status === "uncertain"
            ? "Submission is uncertain. Reconcile the original response before sending anything else."
            : undefined,
      });
    else {
      const failure = Cause.findErrorOption(result.cause);
      const stale =
        Option.isSome(failure) &&
        failure.value &&
        typeof failure.value === "object" &&
        "code" in failure.value &&
        failure.value.code === "REVIEW_STALE";
      update({
        working: false,
        ...(stale ? { pending: undefined } : {}),
        error: requestError(result.cause),
      });
    }
  }
  const received = state.receipt?.status === "admitted";
  const revised = view.revisions.filter((r) => r.responds_to === state.receipt?.request_id);
  return (
    <section className="interactive-review" aria-label={`Review: ${record.review.title}`}>
      <p className="muted">
        Review revision {record.revision} · Feedback requests a revision from Abra.
      </p>
      {view.unavailable && <output>{view.unavailable}</output>}
      {view.current_revision !== record.revision && (
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            open({ review_id: record.review.review_id, revision: view.current_revision })
          }
        >
          Open current review
        </Button>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
      >
        <ReviewControls
          review={record.review}
          answers={state.answers}
          errors={state.errors ?? {}}
          disabled={!!(view.unavailable || pending || received || state.working)}
          change={change}
          image={(id, label) => <ReviewImage record={record} id={id} label={label} />}
        />
        {state.error && <p role="alert">{state.error}</p>}
        {received ? (
          <div>
            <p>Received by Abra. A revision will appear when published.</p>
            {revised.map((r) => (
              <Button type="button" key={`${r.review_id}/${r.revision}`} onClick={() => open(r)}>
                Open revision: {r.title}
              </Button>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={!!view.unavailable}
              onClick={() => update({ receipt: undefined, pending: undefined, error: undefined })}
            >
              Write another response
            </Button>
          </div>
        ) : (
          <Button type="submit" disabled={!!state.working || (!!view.unavailable && !pending)}>
            {state.working
              ? "Sending feedback…"
              : pending
                ? "Reconcile response"
                : "Send feedback to Abra"}
          </Button>
        )}
      </form>
    </section>
  );
}

export function ReviewsForSource({
  issue,
  source,
}: {
  issue?: string;
  source: Partial<ReviewSource>;
}) {
  return (
    <RequestState query={reviewListQuery(issue)} showRefresh={false}>
      {(list) => (
        <>
          {list.diagnostics.map((message, index) => (
            <output key={index}>{message}</output>
          ))}
          {list.reviews
            .filter((ref) =>
              Object.entries(source).every(
                ([key, value]) => Reflect.get(ref.source, key) === value,
              ),
            )
            .map((ref) => (
              <ReviewDisclosure key={`${ref.review_id}/${ref.revision}`} reference={ref} />
            ))}
        </>
      )}
    </RequestState>
  );
}
function ReviewDisclosure({ reference }: { reference: ReviewSelection & { title: string } }) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="review-disclosure"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary>Give feedback: {reference.title}</summary>
      {opened && <ReviewAttachment target={reference} />}
    </details>
  );
}

export function InteractiveReview(
  props:
    | { target: ReviewSelection; source?: never; issue?: never }
    | { source: Partial<ReviewSource>; issue?: string; target?: never },
) {
  return props.target ? (
    <ReviewAttachment target={props.target} />
  ) : (
    <ReviewsForSource source={props.source} issue={props.issue} />
  );
}
