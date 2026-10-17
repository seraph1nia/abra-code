import { Effect } from "effect";
import { type Project } from "../src/domain.ts";
import { type PR, type CheckRunSchema, type StatusSchema } from "../src/git/forge.ts";
import { type Runner } from "../src/process.ts";

export function forgeFixture(project: Project, pr: () => PR | undefined) {
  const calls: string[][] = [];
  const config = {
    reviews: [] as unknown[],
    comments: [] as unknown[],
    threads: [] as unknown[],
    rules: [] as unknown[],
    protection: null as unknown,
    runs: undefined as (typeof CheckRunSchema.Type)[] | undefined,
    statuses: [] as (typeof StatusSchema.Type)[],
    methods: { merge: true, squash: true, rebase: true },
    onMerge: () => {},
  };
  const runner: Runner = {
    run: (_file, args) =>
      Effect.sync(() => {
        calls.push(args);
        const current = pr();
        if (args[0] === "pr") {
          if (args[1] === "merge") {
            config.onMerge();
            return "";
          }
          if (args[1] === "checks")
            return JSON.stringify(
              (current?.statusCheckRollup ?? []).map((c, index) => ({
                name: `ci-${index + 1}`,
                bucket:
                  c.status && c.status !== "COMPLETED"
                    ? "pending"
                    : c.state === "SUCCESS" || ["SUCCESS", "NEUTRAL"].includes(c.conclusion ?? "")
                      ? "pass"
                      : c.conclusion === "SKIPPED"
                        ? "skipping"
                        : c.conclusion === "CANCELLED"
                          ? "cancel"
                          : ["FAILURE", "ERROR"].includes(c.state ?? "") ||
                              (c.status === "COMPLETED" && c.conclusion !== null)
                            ? "fail"
                            : "pending",
                state: c.conclusion ?? c.state ?? c.status ?? "UNKNOWN",
                link: "",
                workflow: "CI",
                startedAt: "2026-10-15T00:00:00Z",
                completedAt: "",
              })),
            );
          return JSON.stringify(current ? [current] : []);
        }
        if (args[1] === "repos/{owner}/{repo}")
          return JSON.stringify({
            full_name: "fixture/api",
            html_url: project.remote,
            allow_merge_commit: config.methods.merge,
            allow_squash_merge: config.methods.squash,
            allow_rebase_merge: config.methods.rebase,
          });
        if (args[1] === "graphql" && args.some((x) => x.includes("reviewThreads")))
          return JSON.stringify({
            data: {
              repository: {
                pullRequest: {
                  reviewThreads: {
                    nodes: config.threads,
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              },
            },
          });
        if (args[1].includes("/comments?")) return JSON.stringify([config.comments]);
        if (args[1] === "graphql")
          return JSON.stringify({
            data: { repository: { ref: { branchProtectionRule: config.protection } } },
          });
        if (args[1].includes("/reviews?")) return JSON.stringify([config.reviews]);
        if (args[1].includes("/rules/branches/")) return JSON.stringify([config.rules]);
        if (args[1].includes("/check-runs")) {
          const runs =
            config.runs ??
            (current?.statusCheckRollup ?? []).map((c, i) => ({
              id: i + 1,
              name: `ci-${i + 1}`,
              head_sha: current!.headRefOid,
              app: { id: 1 },
              status: c.status && c.status !== "COMPLETED" ? "in_progress" : "completed",
              conclusion: (c.conclusion ?? c.state ?? "success").toLowerCase(),
            }));
          return JSON.stringify([{ total_count: runs.length, check_runs: runs }]);
        }
        if (args[1].includes("/statuses?")) return JSON.stringify([config.statuses]);
        throw Error(`Unexpected fake forge call: ${args.slice(0, 2).join(" ")}`);
      }),
  };
  return { runner, config, calls };
}
