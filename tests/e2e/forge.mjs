#!/usr/bin/env node
// Disposable forge protocol fixture. Every Git write is confined to the explicitly recorded local bare remote.
import { readFileSync, writeFileSync, renameSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const stateFile = fileURLToPath(new URL("./forge-state.json", import.meta.url));
const state = JSON.parse(readFileSync(stateFile, "utf8"));
const args = process.argv.slice(2),
  arg = (name) => args[args.indexOf(name) + 1];
const git = (...argv) =>
  execFileSync("git", argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const save = () => {
  writeFileSync(`${stateFile}.${process.pid}`, JSON.stringify(state));
  renameSync(`${stateFile}.${process.pid}`, stateFile);
};
const output = (value) => {
  process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
};
const count = (kind) => {
  state.counts ??= {};
  state.counts[kind] = (state.counts[kind] ?? 0) + 1;
};
const remoteHead = (branch) => git("ls-remote", "origin", `refs/heads/${branch}`).split(/\s/)[0];
const current = () =>
  state.pr
    ? {
        ...state.pr,
        headRefOid: remoteHead(state.branch),
        mergeStateStatus: state.merge_hold ? "BLOCKED" : state.pr.mergeStateStatus,
        reviewDecision: state.reviewDecision ?? "APPROVED",
        statusCheckRollup: [
          {
            status: state.check === "pending" ? "IN_PROGRESS" : "COMPLETED",
            conclusion:
              state.check === "fail" ? "FAILURE" : state.check === "pending" ? null : "SUCCESS",
          },
        ],
      }
    : undefined;
if (args[0] === "pr") {
  if (args[1] === "list") {
    output(state.pr ? [current()] : []);
  } else if (args[1] === "create") {
    if (state.pr) throw Error("Duplicate PR creation refused");
    state.branch = arg("--head");
    state.base = arg("--base");
    state.pr = {
      url: "https://example.invalid/fixture/api/pull/1",
      state: "OPEN",
      headRefOid: remoteHead(state.branch),
      baseRefName: state.base,
      isDraft: args.includes("--draft"),
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      body: readFileSync(arg("--body-file"), "utf8"),
      title: arg("--title"),
    };
    state.created_draft = state.pr.isDraft;
    state.created_body = state.pr.body;
    count("create");
    save();
    output(state.pr.url);
  } else if (args[1] === "edit") {
    state.pr.body = readFileSync(arg("--body-file"), "utf8");
    count("edit");
    save();
    output("");
  } else if (args[1] === "ready") {
    state.pr.isDraft = false;
    count("ready");
    save();
    output("");
  } else if (args[1] === "checks") {
    output([
      {
        name: "ci-1",
        bucket: state.check === "fail" ? "fail" : state.check === "pending" ? "pending" : "pass",
        state: state.check === "fail" ? "FAILURE" : "SUCCESS",
        link: "https://example.invalid/fixture/api/actions/runs/7/job/70",
        workflow: ".github/workflows/ci.yml",
        startedAt: `2026-10-16T00:00:${String(state.attempt ?? 1).padStart(2, "0")}Z`,
        completedAt: state.check === "pending" ? "" : "2026-10-16T01:00:00Z",
      },
    ]);
  } else if (args[1] === "merge") {
    const pr = current();
    if (arg("--match-head-commit") !== pr.headRefOid) throw Error("Stale merge head");
    if (
      git("remote", "get-url", "origin") !== state.remote ||
      !isAbsolute(state.remote) ||
      !basename(dirname(stateFile)).startsWith("abracode-native-") ||
      !realpathSync(state.remote).startsWith(realpathSync(dirname(stateFile)) + sep) ||
      execFileSync("git", ["--git-dir", state.remote, "rev-parse", "--is-bare-repository"], {
        encoding: "utf8",
      }).trim() !== "true"
    )
      throw Error("Only this fixture's local bare remote may receive a write");
    if (state.merge_delay_ms) {
      if (state.merge_delay_ms > 5000) throw Error("Fixture delay exceeds its bound");
      state.merge_started = true;
      save();
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, state.merge_delay_ms);
    }
    git("push", "origin", `${pr.headRefOid}:refs/heads/${state.base}`);
    state.pr = {
      ...pr,
      state: "MERGED",
      mergeCommit: { oid: pr.headRefOid },
      mergedAt: new Date().toISOString(),
    };
    count("merge");
    save();
    output("");
  } else throw Error(`Unsupported fake PR call ${args[1]}`);
} else if (args[0] === "run" && args[1] === "view") {
  output("Fixture failure log: runner infrastructure unavailable.\n");
} else if (args[0] === "api") {
  const method = args.includes("--method") ? arg("--method") : "GET",
    endpoint = args[1] === "--method" ? args[3] : args[1];
  if (endpoint === "repos/{owner}/{repo}")
    output({
      full_name: "fixture/api",
      html_url: state.remote,
      allow_merge_commit: true,
      allow_squash_merge: true,
      allow_rebase_merge: true,
    });
  else if (endpoint === "user") output({ login: "abracode-bot" });
  else if (endpoint === "graphql") {
    const query = args.find((x) => x.startsWith("query=")) ?? "";
    const threads = state.threads ?? [];
    if (query.includes("resolveReviewThread")) {
      const thread =
        threads.find(
          (x) =>
            x.id === arg("-f") || x.id === (args.find((x) => x.startsWith("id=")) ?? "").slice(3),
        ) ?? threads[0];
      thread.isResolved = true;
      count("resolve");
      save();
      output({ data: { resolveReviewThread: { thread: { id: thread.id, isResolved: true } } } });
    } else if (query.includes("reviewThreads"))
      output({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: { nodes: threads, pageInfo: { hasNextPage: false, endCursor: null } },
            },
          },
        },
      });
    else if (query.includes("viewerCanResolve")) {
      const thread = threads[0];
      output({
        data: {
          node: {
            id: thread.id,
            isResolved: thread.isResolved,
            viewerCanResolve: thread.viewerCanResolve,
          },
        },
      });
    } else
      output({
        data: {
          repository: {
            ref: {
              branchProtectionRule: {
                requiresStatusChecks: false,
                requiresLinearHistory: false,
                requiresApprovingReviews: false,
                requiredStatusChecks: [],
              },
            },
          },
        },
      });
  } else if (endpoint.includes("/rules/branches/")) output([[]]);
  else if (endpoint.includes("/check-runs?"))
    output([
      {
        total_count: state.two_jobs ? 2 : 1,
        check_runs: Array.from({ length: state.two_jobs ? 2 : 1 }, (_, index) => ({
          id: (state.attempt ?? 1) * 10 + index,
          details_url: "https://example.invalid/fixture/api/actions/runs/7/job/70",
          name: `ci-${index + 1}`,
          head_sha: current().headRefOid,
          status: state.check === "pending" ? "in_progress" : "completed",
          conclusion:
            state.check === "fail" ? "failure" : state.check === "pending" ? null : "success",
          app: { id: 1 },
        })),
      },
    ]);
  else if (endpoint.includes("/statuses?")) output([[]]);
  else if (endpoint.includes("/collaborators/")) {
    if (state.permission_unavailable) {
      process.stderr.write("Permission read unavailable");
      process.exit(1);
    }
    output({ permission: "write" });
  } else if (endpoint.endsWith("/teams?per_page=100"))
    output([[{ slug: "api", permission: "push" }]]);
  else if (endpoint.endsWith("/requested_reviewers")) {
    if (method === "GET") output(state.requested ?? { users: [], teams: [] });
    else {
      const body = JSON.parse(readFileSync(arg("--input"), "utf8"));
      state.requested = {
        users: (body.reviewers ?? []).map((login) => ({ login })),
        teams: (body.team_reviewers ?? []).map((slug) => ({ slug })),
      };
      count("reviewers");
      save();
      output({
        requested_reviewers: state.requested.users,
        requested_teams: state.requested.teams,
      });
    }
  } else if (endpoint.endsWith("/pulls/1"))
    output({
      user: { login: "abracode-bot" },
      head: { sha: current().headRefOid },
      base: { ref: state.base },
    });
  else if (endpoint.includes("/reviews?")) output([state.reviews ?? []]);
  else if (endpoint.includes("/comments?") && method === "GET") {
    if (endpoint.includes("/pulls/"))
      output([
        (state.threads ?? []).flatMap((t) =>
          t.comments.nodes.map((c) => ({
            body: c.body,
            html_url: c.url,
            user: c.author,
            in_reply_to_id: c.in_reply_to_id,
          })),
        ),
      ]);
    else output([state.comments ?? []]);
  } else if (
    method === "POST" &&
    (endpoint.endsWith("/comments") || endpoint.endsWith("/replies"))
  ) {
    const body = JSON.parse(readFileSync(arg("--input"), "utf8")).body;
    const id = 100 + (state.counts?.reply ?? 0),
      url = `${state.pr.url}#issuecomment-${id}`;
    const reply = {
      id,
      body,
      html_url: url,
      updated_at: new Date().toISOString(),
      user: { login: "abracode-bot" },
    };
    if (endpoint.endsWith("/replies")) {
      const thread = state.threads[0];
      thread.comments.nodes.push({
        id: `IC_${id}`,
        databaseId: id,
        in_reply_to_id: Number(endpoint.match(/comments\/(\d+)\/replies$/)[1]),
        body,
        url,
        updatedAt: reply.updated_at,
        author: reply.user,
        originalCommit: { oid: current().headRefOid },
        pullRequestReview: { state: "COMMENTED" },
      });
    } else {
      state.comments ??= [];
      state.comments.push(reply);
    }
    count("reply");
    const lose = state.lose_reply_response;
    state.lose_reply_response = false;
    save();
    if (lose) {
      process.stderr.write("Lost fixture reply response");
      process.exit(1);
    }
    output(reply);
  } else if (endpoint.includes("/actions/runs/7")) {
    if (endpoint.endsWith("/rerun-failed-jobs")) {
      if (!state.defer_rerun_attempt) {
        state.attempt = (state.attempt ?? 1) + 1;
        state.check = "pending";
      }
      count("rerun");
      save();
      output("");
    } else if (endpoint.includes("/jobs?"))
      output([
        {
          total_count: 1,
          jobs: [
            {
              id: 70,
              run_id: 7,
              name: "CI",
              status: "completed",
              conclusion: state.check === "fail" ? "failure" : "success",
              steps: [
                { name: "Run checks", conclusion: state.check === "fail" ? "failure" : "success" },
              ],
            },
          ],
        },
      ]);
    else
      output({
        id: 7,
        head_sha: current().headRefOid,
        run_attempt: state.attempt ?? 1,
        path: ".github/workflows/ci.yml",
        status: state.check === "pending" ? "in_progress" : "completed",
        conclusion:
          state.check === "fail" ? "failure" : state.check === "pending" ? null : "success",
      });
  } else throw Error(`Unsupported fake API call ${method} ${endpoint}`);
} else throw Error(`Unsupported fake forge command ${args[0]}`);
