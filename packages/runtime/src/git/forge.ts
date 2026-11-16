import {
  Executable,
  RepositorySlug,
  CheckName,
  GitRemote,
  PullRequestUrl,
  BranchName,
} from "../identities.ts";

import { Effect, Schema } from "effect";
import { Commit, Count, NonEmpty, Positive } from "../contracts.ts";
import { CrewError, ensure, type Project } from "../domain.ts";
import { decodeJSON } from "../decode.ts";
import { type Runner, type RunOptions } from "../process.ts";
import { remoteIdentity } from "./source.ts";
import { mkdtemp, writeFile, rm } from "../filesystem.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PRSchema = Schema.Struct({
  url: PullRequestUrl,
  state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
  headRefOid: Commit,
  baseRefName: BranchName,
  isDraft: Schema.Boolean,
  mergeable: Schema.Literals(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
  mergeStateStatus: Schema.Literals([
    "BEHIND",
    "BLOCKED",
    "CLEAN",
    "DIRTY",
    "DRAFT",
    "HAS_HOOKS",
    "UNKNOWN",
    "UNSTABLE",
  ]),
  body: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  mergeCommit: Schema.optional(Schema.NullOr(Schema.Struct({ oid: Commit }))),
  mergedAt: Schema.optional(Schema.NullOr(NonEmpty)),
  reviewDecision: Schema.optional(
    Schema.NullOr(Schema.Literals(["", "APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"])),
  ),
  statusCheckRollup: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          status: Schema.optional(Schema.String),
          conclusion: Schema.optional(Schema.NullOr(Schema.String)),
          state: Schema.optional(Schema.String),
        }),
      ),
    ),
  ),
});
export type PR = { -readonly [K in keyof typeof PRSchema.Type]: (typeof PRSchema.Type)[K] };
export const RepoSchema = Schema.Struct({
  full_name: RepositorySlug,
  html_url: GitRemote,
  allow_merge_commit: Schema.Boolean,
  allow_squash_merge: Schema.Boolean,
  allow_rebase_merge: Schema.Boolean,
});
export type Repo = typeof RepoSchema.Type;
export const CheckSchema = Schema.Struct({
  name: CheckName,
  bucket: Schema.Literals(["pass", "fail", "pending", "skipping", "cancel"]),
  state: NonEmpty,
  link: Schema.String,
  workflow: Schema.String,
  startedAt: Schema.String,
  completedAt: Schema.String,
});
export const RuleSchema = Schema.Struct({
  type: NonEmpty,
  parameters: Schema.optional(Schema.Unknown),
});
export const RequiredParameters = Schema.Struct({
  required_status_checks: Schema.Array(
    Schema.Struct({
      context: CheckName,
      integration_id: Schema.optional(
        Schema.NullOr(
          Schema.Int.check(
            Schema.makeFilter((id) => id === -1 || id > 0 || "Invalid integration ID"),
          ),
        ),
      ),
    }),
  ),
  strict_required_status_checks_policy: Schema.Boolean,
});
export const ProtectionSchema = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.Struct({
      ref: Schema.Struct({
        branchProtectionRule: Schema.NullOr(
          Schema.Struct({
            requiresStatusChecks: Schema.Boolean,
            requiresLinearHistory: Schema.Boolean,
            requiresApprovingReviews: Schema.Boolean,
            requiredStatusChecks: Schema.NullOr(
              Schema.Array(
                Schema.Struct({
                  context: CheckName,
                  app: Schema.NullOr(Schema.Struct({ databaseId: Positive })),
                }),
              ),
            ),
          }),
        ),
      }),
    }),
  }),
});
export const CheckRunSchema = Schema.Struct({
  details_url: Schema.optional(Schema.NullOr(Schema.String)),
  id: Positive,
  name: CheckName,
  head_sha: Commit,
  status: Schema.Literals([
    "queued",
    "in_progress",
    "completed",
    "waiting",
    "requested",
    "pending",
  ]),
  conclusion: Schema.NullOr(Schema.String),
  app: Schema.Struct({ id: Positive }),
});
export const CheckPageSchema = Schema.Struct({
  total_count: Count,
  check_runs: Schema.Array(CheckRunSchema),
});
export const StatusSchema = Schema.Struct({
  target_url: Schema.optional(Schema.NullOr(Schema.String)),
  id: Positive,
  context: CheckName,
  state: Schema.Literals(["success", "failure", "error", "pending"]),
});

/** Owns JSON decoding and source identity; machine calls cannot inherit a foreign GH_REPO. */
export class Forge {
  constructor(
    private runner: Runner,
    private bin: Executable,
  ) {}
  run(p: Project, args: string[], options?: RunOptions) {
    return this.runner.run(
      this.bin,
      args,
      p.path,
      { GH_REPO: undefined, GH_HOST: undefined },
      options,
    );
  }
  json<S extends Schema.ConstraintDecoder<unknown>>(
    p: Project,
    schema: S,
    args: string[],
    options?: RunOptions,
  ) {
    return this.run(p, args, options).pipe(
      Effect.flatMap((output) =>
        decodeJSON(schema, output, `${this.bin} ${args.slice(0, 2).join(" ")}`),
      ),
      Effect.mapError((error) =>
        ["COMMAND_FAILED", "COMMAND_TIMEOUT"].includes(error.code)
          ? new CrewError(
              "FORGE_OBSERVATION_FAILED",
              "Forge observation unavailable; recheck before mutation",
            )
          : error,
      ),
    );
  }
  request<S extends Schema.ConstraintDecoder<unknown>>(
    p: Project,
    schema: S,
    method: string,
    endpoint: string,
    payload: object,
  ) {
    return Effect.scoped(
      Effect.gen({ self: this }, function* () {
        const directory = yield* Effect.acquireRelease(
          mkdtemp(join(tmpdir(), "abracode-forge-")),
          (d) => rm(d, { recursive: true }).pipe(Effect.orDie),
        );
        const path = join(directory, "request.json");
        yield* writeFile(path, JSON.stringify(payload), { mode: 0o600, flag: "wx" });
        return yield* this.json(p, schema, ["api", "--method", method, endpoint, "--input", path]);
      }),
    );
  }
  repo(p: Project) {
    return this.json(p, RepoSchema, ["api", "repos/{owner}/{repo}"]).pipe(
      Effect.tap((repo) =>
        Effect.try({
          try: () => {
            ensure(
              remoteIdentity(repo.html_url, p.path) === remoteIdentity(p.remote, p.path),
              "FORGE_IDENTITY",
              "Forge repository differs from configured origin",
            );
          },
          catch: CrewError.from,
        }),
      ),
    );
  }
}
