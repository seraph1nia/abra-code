import type { ComponentProps } from "react";
import { deferred } from "@abracode/presentation/deferred";

const Review = deferred<
  ComponentProps<typeof import("./interactive-reviews.tsx").InteractiveReview>
>(
  () =>
    import("./interactive-reviews.tsx").then((module) => ({ default: module.InteractiveReview })),
  "Document review",
);
export { Review as ReviewAttachment, Review as ReviewsForSource };
