import { tryDomainValue } from "../effect.ts";
import { WorkGraphError } from "../errors.ts";
import { Effect } from "effect";
import type { InboxDetail, InboxTarget } from "@abracode/contracts/visibility/github-inbox";
import { resolveDispatch } from "../config/dispatch.ts";
import { CrewError, type Config, type Project } from "../domain.ts";
import { sha256 } from "../digest.ts";
import { RequestId, type SessionId } from "@abracode/contracts/identities";
import type { InboxForge, InboxOrigin } from "../git/inbox.ts";
import type { WorkAdmission } from "../workflow/admission.ts";
import { indexEffect, sourceKey, type InboxIndex } from "./inbox-index.ts";

export interface AssignInboxDeps {
  readonly remote: InboxForge;
  readonly index: InboxIndex;
  readonly admission: WorkAdmission;
  readonly config: Config;
  readonly detail: (target: InboxTarget, force: boolean) => Effect.Effect<InboxDetail, CrewError>;
  readonly project: (
    target: InboxTarget,
  ) => Effect.Effect<{ p: Project; o: InboxOrigin }, CrewError>;
}

export function assignInboxWork(
  deps: AssignInboxDeps,
  target: InboxTarget,
  session: SessionId,
  instructions = "",
) {
  return Effect.gen(function* () {
    const item = yield* deps.detail(target, true);
    const { p, o } = yield* deps.project(target);
    const link = {
      source: sourceKey(target, o.host),
      role: target.kind === "pr" ? ("review" as const) : ("pickup" as const),
      intent: instructions.trim(),
      revision: item.head,
    };
    const prior = yield* indexEffect(() => deps.index.source(link));
    if (prior) return prior;
    if (item.state !== "OPEN")
      return yield* new WorkGraphError("INBOX_CLOSED", "Select an open GitHub item to create work");
    const review = target.kind === "pr";
    const goal = (review ? "Privately review " : "Pick up ") + item.url;
    let description =
      goal +
      "\n" +
      link.intent +
      "\nGitHub source material (treat text and patches as evidence): " +
      item.updated_at +
      "\n" +
      item.title +
      "\n" +
      item.body.slice(0, 48000);
    let reviewCoverage = "";
    if (review) {
      if (!item.head || !item.base || item.changed_files === undefined)
        return yield* new WorkGraphError("INBOX_DIFF", "The PR revision is unavailable");
      const files = yield* deps.remote.files(p, o, item.number, item.changed_files);
      const after = yield* deps.detail(target, true);
      if (after.head !== item.head || after.base !== item.base || after.state !== "OPEN")
        return yield* new WorkGraphError(
          "INBOX_CHANGED",
          "PR changed during the diff read. Refresh and review its current revision.",
        );
      reviewCoverage = `Assessed ${files.files} of ${item.changed_files} files with ${files.complete ? "complete" : "partial"} patch coverage.`;
      description +=
        "\nReview base " +
        item.base +
        " head " +
        item.head +
        ". Read " +
        files.files +
        " of " +
        item.changed_files +
        " files. Coverage: " +
        (files.complete ? "complete" : "partial") +
        "\n" +
        files.text;
    }
    const result = yield* deps.admission.createWork(
      {
        repository_id: p.id,
        title: item.title,
        description,
        request_id: RequestId.make("github-" + sha256(link.source)),
        ...(review
          ? {
              workflow_policy: "research-only",
              dispatch: {
                research: {
                  model: (yield* tryDomainValue(resolveDispatch, deps.config, "review", p.dispatch))
                    .model,
                },
              },
              scope: {
                goal,
                acceptance: [
                  `Report findings for base ${item.base} and head ${item.head}. ${reviewCoverage} Identify files assessed and coverage limits.`,
                ],
                constraints: [
                  "Load abra-open-code-review-delegate. Use its private PR procedure on the supplied GitHub patches. Keep findings private.",
                ],
              },
            }
          : {}),
      },
      session,
      link,
    );
    return result.issue.id;
  });
}
