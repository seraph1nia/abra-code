import { createHash } from "node:crypto";
import type { IssueId, FindingId, FindingRevisionId } from "@abracode/contracts/identities";
import {
  retainedFinding,
  type FeedbackPage,
} from "@abracode/contracts/workflow/feedback-contracts";
import { Effect } from "effect";
import { ensure, type CrewError } from "../../domain.ts";
import { domainEffect } from "../../effect.ts";
import type { Records } from "../../storage/store.ts";
export const feedbackPage = (
  records: Records,
  id: IssueId,
  page = 0,
  finding_id?: FindingId,
  revision?: FindingRevisionId,
): Effect.Effect<FeedbackPage, CrewError> =>
  domainEffect(
    Effect.gen(function* () {
      ensure(
        Number.isSafeInteger(page) && page >= 0,
        "FEEDBACK_PAGE",
        "Feedback page must be a nonnegative integer",
      );
      const e = yield* records.execution(id);
      ensure(e, "EXECUTION_MISSING", "No retained execution for feedback history");
      const f = e.feedback,
        offset = page * 20;
      const exact =
        finding_id && revision ? retainedFinding(f, { id: finding_id, revision }) : undefined;
      if (finding_id !== undefined || revision !== undefined)
        ensure(
          exact,
          "INVALID_SELECTION",
          "The requested finding revision is unavailable for this task",
        );
      return {
        issue_id: id,
        generation: e.control_generation,
        head: e.delivered_commit,
        page,
        page_size: 20 as const,
        external_validation: e.external_validation,
        external_gate_digest: e.external_validation?.observation?.gate
          ? createHash("sha256")
              .update(JSON.stringify(e.external_validation.observation.gate))
              .digest("hex")
          : undefined,
        external_history: e.external_history?.slice(page, page + 1) ?? [],
        external_history_total: e.external_history?.length ?? 0,
        observation: f
          ? {
              head: f.head,
              pr: f.pr,
              target: f.target,
              observed_at: f.observed_at,
              next_check_at: f.next_check_at,
              complete: f.complete,
              error: f.error,
            }
          : undefined,
        findings: exact
          ? f?.findings.includes(exact)
            ? [exact]
            : []
          : (f?.findings.slice(offset, offset + 20) ?? []),
        history: exact
          ? f?.history.includes(exact)
            ? [exact]
            : []
          : (f?.history.slice(offset, offset + 20) ?? []),
        actions: f?.actions.slice(offset, offset + 20) ?? [],
        finding_total: f?.findings.length ?? 0,
        history_total: f?.history.length ?? 0,
        action_total: f?.actions.length ?? 0,
      };
    }),
  );
