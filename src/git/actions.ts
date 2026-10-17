import { Effect, Schema } from "effect";
import { Commit, Count, NonEmpty, Positive } from "../contracts.ts";
import { ensure, type Project } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type Forge } from "./forge.ts";

export const ActionsRun = Schema.Struct({
  id: Positive,
  head_sha: Commit,
  run_attempt: Positive,
  path: NonEmpty,
  status: NonEmpty,
  conclusion: Schema.NullOr(Schema.String),
});
const Job = Schema.Struct({
  id: Positive,
  run_id: Positive,
  name: NonEmpty,
  status: NonEmpty,
  conclusion: Schema.NullOr(Schema.String),
  steps: Schema.Array(Schema.Struct({ name: NonEmpty, conclusion: Schema.NullOr(Schema.String) })),
});
const Jobs = Schema.Struct({ total_count: Count, jobs: Schema.Array(Job) });

/** Supplemental CI evidence can be unavailable without hiding authoritative check failure. */
export function actionsEvidence(
  forge: Forge,
  p: Project,
  slug: string,
  link: string,
  head: import("../identities.ts").Commit,
) {
  return domainEffect(
    Effect.gen(function* () {
      const path = new URL(link).pathname;
      const match = new RegExp(
        `^/${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/actions/runs/(\\d+)(?:/job/(\\d+))?/?$`,
      ).exec(path);
      ensure(match, "ACTIONS_IDENTITY", "Check has no supported GitHub Actions run identity");
      const run = yield* forge.json(p, ActionsRun, [
        "api",
        `repos/${slug}/actions/runs/${match[1]}`,
      ]);
      ensure(
        run.head_sha === head && String(run.id) === match[1],
        "ACTIONS_HEAD",
        "Workflow attempt differs from delivered head",
      );
      const identity = { run_id: run.id, run_attempt: run.run_attempt, workflow: run.path };
      const details = yield* Effect.result(
        domainEffect(
          Effect.gen(function* () {
            const pages = yield* forge.json(p, Schema.Array(Jobs), [
              "api",
              `repos/${slug}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
              "--paginate",
              "--slurp",
            ]);
            const jobs = pages.flatMap((x) => x.jobs);
            ensure(
              pages.length > 0 &&
                pages.every((x) => x.total_count === pages[0].total_count) &&
                new Set(jobs.map((x) => x.id)).size === pages[0].total_count &&
                jobs.every((x) => x.run_id === run.id),
              "ACTIONS_INCOMPLETE",
              "Workflow job pagination is incomplete",
            );
            const failed = jobs.filter(
              (x) =>
                x.status === "completed" &&
                ["failure", "cancelled", "timed_out"].includes(x.conclusion ?? "") &&
                (!match[2] || String(x.id) === match[2]),
            );
            let logs = "";
            const missing: string[] = [];
            for (const job of failed.slice(0, 4)) {
              const remaining = 32768 - Buffer.byteLength(logs);
              if (remaining < 1024) {
                missing.push("Failure-log byte budget reached");
                break;
              }
              const result = yield* Effect.result(
                forge.run(
                  p,
                  [
                    "run",
                    "view",
                    String(run.id),
                    "--attempt",
                    String(run.run_attempt),
                    "--job",
                    String(job.id),
                    "--log-failed",
                  ],
                  { deadline_ms: 15000, max_output_bytes: remaining, trim: false },
                ),
              );
              if (result._tag === "Failure")
                missing.push(`Job ${job.id} failure log unavailable: ${result.failure.code}`);
              else if (!result.success.trim())
                missing.push(`Job ${job.id} reports no failing-step log`);
              else logs += result.success;
            }
            if (!failed.length) missing.push("No completed failed job is available for this check");
            if (failed.length > 4)
              missing.push("Additional failing jobs exceed bounded detail admission");
            return {
              logs: logs || undefined,
              evidence_unavailable: missing.length ? missing.join("; ") : undefined,
            };
          }),
        ),
      );
      return {
        ...identity,
        ...(details._tag === "Success"
          ? details.success
          : { evidence_unavailable: details.failure.message.slice(0, 1024) }),
      };
    }),
  ).pipe(
    Effect.catch((error) => Effect.succeed({ evidence_unavailable: error.message.slice(0, 1024) })),
  );
}
