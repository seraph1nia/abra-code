import { Effect, Schema } from "effect";
import { type Commit, type RepositorySlug } from "../identities.ts";
import { type Check } from "./check-contracts.ts";
import { ensure, type Project } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { CheckPageSchema, StatusSchema, type Forge } from "./forge.ts";

function latest<A extends { id: number }>(values: readonly A[], key: (value: A) => string) {
  const result = new Map<string, A>();
  for (const value of values)
    if ((result.get(key(value))?.id ?? -1) < value.id) result.set(key(value), value);
  return [...result.values()];
}

/** One authoritative source model for readiness, feedback and retry admission. */
export const observeChecks = Effect.fn("observeChecks")(function* (
  forge: Forge,
  p: Project,
  repo: RepositorySlug,
  head: Commit,
) {
  const [pages, statuses] = yield* Effect.all(
    [
      forge.json(p, Schema.Array(CheckPageSchema), [
        "api",
        `repos/${repo}/commits/${head}/check-runs?filter=latest&per_page=100`,
        "--paginate",
        "--slurp",
      ]),
      forge.json(p, Schema.Array(Schema.Array(StatusSchema)), [
        "api",
        `repos/${repo}/commits/${head}/statuses?per_page=100`,
        "--paginate",
        "--slurp",
      ]),
    ],
    { concurrency: "unbounded" },
  );
  ensure(
    pages.length > 0 && statuses.length > 0,
    "CHECKS_UNCONFIRMED",
    "Missing check pagination evidence",
  );
  const runs = pages.flatMap((page) => page.check_runs);
  ensure(
    runs.every((run) => run.head_sha === head),
    "CHECK_HEAD",
    "Check attempt belongs to another commit",
  );
  ensure(
    pages.every((page) => page.total_count === pages[0].total_count) &&
      runs.length === pages[0].total_count &&
      new Set(runs.map((run) => run.id)).size === pages[0].total_count,
    "CHECKS_UNCONFIRMED",
    "Check attempts changed during pagination; observe again",
  );
  const statusValues = statuses.flat();
  ensure(
    new Set(statusValues.map((s) => s.id)).size === statusValues.length,
    "CHECKS_UNCONFIRMED",
    "Commit status pagination contains repeated source identities",
  );
  const checks: Check[] = latest(runs, (run) => `${run.name}\0${run.app.id}`).map((run) => ({
    name: run.name,
    app_id: run.app.id,
    source: {
      kind: "check-run",
      id: run.id,
      head,
      revision: `${run.id}:${run.status}:${run.conclusion}`,
      link: run.details_url ?? undefined,
    },
    bucket:
      run.status !== "completed" || run.conclusion === null
        ? "pending"
        : ["success", "neutral"].includes(run.conclusion)
          ? "pass"
          : run.conclusion === "skipped"
            ? "skipping"
            : run.conclusion === "cancelled"
              ? "cancel"
              : "fail",
  }));
  checks.push(
    ...latest(statusValues, (status) => status.context).map((status): Check => ({
      name: status.context,
      source: {
        kind: "status",
        id: status.id,
        head,
        revision: `${status.id}:${status.state}`,
        link: status.target_url ?? undefined,
      },
      bucket: status.state === "success" ? "pass" : status.state === "pending" ? "pending" : "fail",
    })),
  );
  return checks;
}, domainEffect);
