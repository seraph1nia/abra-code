import { Link } from "@tanstack/react-router";
import type { TranscriptMessage } from "@abracode/contracts/web/contracts";
import { feedbackReference } from "@abracode/contracts/web/reviews";
import { WorkspaceApi } from "../data.ts";
import { RequestState } from "../request-state.tsx";
import { reviewQuery } from "../review-data.ts";

export function FeedbackReceipt({ message }: { message: TranscriptMessage }) {
  const raw = <div className="message-text">{message.text}</div>;
  const reference = feedbackReference(message.text);
  if (!reference) return raw;
  return (
    <RequestState
      showRefresh={false}
      unavailable={raw}
      query={WorkspaceApi.query("reviews", "reviewReceipt", {
        query: reference,
        reactivityKeys: ["reviews-observed"],
        timeToLive: "30 seconds",
      })}
    >
      {(receipt) => {
        if (
          receipt?.status !== "admitted" ||
          receipt.request_id !== reference.request_id ||
          receipt.hash !== reference.hash ||
          receipt.review_id !== reference.review_id ||
          receipt.revision !== reference.revision ||
          receipt.message_id !== message.id ||
          (receipt.native_text ?? receipt.text) !== message.text
        )
          return raw;
        const review = { review_id: reference.review_id, revision: reference.revision };
        return (
          <section aria-label="Submitted review feedback">
            <strong>{receipt.feedback?.title ?? "Review feedback"}</strong>
            {receipt.feedback ? (
              <dl>
                {receipt.feedback.choices.map((row, i) => (
                  <div key={i}>
                    <dt>{row.question}</dt>
                    <dd>{row.answer}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p>Choice details unavailable.</p>
            )}
            <p>
              Submitted ·{" "}
              <Link to="/" search={{ review }}>
                Review revision {review.revision}
              </Link>
            </p>
            <RequestState showRefresh={false} query={reviewQuery(review)}>
              {(view) =>
                view.revisions
                  .filter((r) => r.responds_to === receipt.request_id)
                  .map((r) => (
                    <Link
                      key={r.review_id + "/" + r.revision}
                      to="/"
                      search={{ review: { review_id: r.review_id, revision: r.revision } }}
                    >
                      Open follow-up · revision {r.revision}
                    </Link>
                  ))
              }
            </RequestState>
          </section>
        );
      }}
    </RequestState>
  );
}
