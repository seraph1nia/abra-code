import { Effect, Schema } from "effect";
import { NonEmpty } from "../contracts.ts";
import { ensure, type ManagedExecution, type Project } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type Git } from "./repository.ts";
import { type Forge } from "./forge.ts";
import { restPages } from "./feedback.ts";

export const ReviewerSuggestions = Schema.Struct({
  head: NonEmpty,
  suggestions: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(["user", "team"]),
      name: NonEmpty,
      evidence: Schema.Array(NonEmpty),
      eligible: Schema.Boolean,
      reason: Schema.optional(Schema.String),
    }),
  ).check(Schema.isMaxLength(40)),
  limited: Schema.Boolean,
  notes: Schema.Array(Schema.String),
});
const safeLogin = /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/;
/** Supported simple CODEOWNERS globs. Unsupported syntax is disclosed, never silently guessed. */
export function ownersFor(content: string, files: readonly string[], organization: string) {
  const rules: { pattern: RegExp; owners: string[] }[] = [],
    notes: string[] = [];
  for (const line of content.split("\n")) {
    const parts = line.trim().split(/\s+/);
    const pattern = parts.shift();
    if (!pattern || pattern.startsWith("#")) continue;
    if (/[![\]\\?#]/.test(pattern)) {
      notes.push(`Unsupported CODEOWNERS pattern: ${pattern}`);
      continue;
    }
    const owners = parts
      .filter((x) => !x.startsWith("#"))
      .filter((x) => /^@[A-Za-z0-9][A-Za-z0-9/-]*$/.test(x));
    if (parts.some((x) => !x.startsWith("#") && !owners.includes(x)))
      notes.push(`Unsupported owner identity for ${pattern}`);
    const anchored = pattern.startsWith("/") || pattern.replace(/\/$/, "").includes("/");
    const raw = pattern.replace(/^\//, "").replace(/\/$/, "");
    let regex = "";
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === "*" && raw[i + 1] === "*") {
        i++;
        if (raw[i + 1] === "/") {
          i++;
          regex += "(?:.*/)?";
        } else regex += ".*";
      } else if (raw[i] === "*") regex += "[^/]*";
      else regex += raw[i]!.replace(/[.+^${}()|]/g, "\\$&");
    }
    rules.push({ pattern: new RegExp(`${anchored ? "^" : "(?:^|/)"}${regex}(?:/|$)`), owners });
  }
  const selected = new Map<string, string[]>();
  for (const file of files) {
    const rule = rules.findLast((r) => r.pattern.test(file));
    for (const owner of rule?.owners ?? []) {
      const [org, team] = owner.slice(1).split("/");
      if (team && org !== organization) {
        notes.push(`Team ${owner} belongs to a different organization`);
        continue;
      }
      const key = team ? `team:${team}` : `user:${org}`;
      selected.set(key, [...(selected.get(key) ?? []), `CODEOWNERS: ${file}`]);
    }
  }
  return { selected, notes };
}
export function reviewerPermission(
  forge: Forge,
  p: Project,
  slug: string,
  kind: "user" | "team",
  name: string,
) {
  return domainEffect(
    Effect.gen(function* () {
      ensure(
        safeLogin.test(name),
        "REVIEWER_TARGET",
        "Reviewer target must be an explicit login or team slug",
      );
      if (kind === "user") {
        const result = yield* forge.json(p, Schema.Struct({ permission: NonEmpty }), [
          "api",
          `repos/${slug}/collaborators/${name}/permission`,
        ]);
        return ["write", "maintain", "admin"].includes(result.permission);
      }
      const teams = yield* restPages(
        forge,
        p,
        Schema.Struct({ slug: NonEmpty, permission: NonEmpty }),
        `repos/${slug}/teams?per_page=100`,
      );
      return teams.some(
        (t) => t.slug === name && ["push", "write", "maintain", "admin"].includes(t.permission),
      );
    }),
  );
}
export class GitHubReviewers {
  constructor(
    private git: Git,
    private forge: Forge,
  ) {}
  suggest = Effect.fn("GitHubReviewers.suggest")(
    function* (this: GitHubReviewers, p: Project, e: ManagedExecution) {
      ensure(
        e.delivered_commit && e.worktree_directory && e.base_commit,
        "REVIEWER_HEAD",
        "Suggestions require the retained delivered comparison",
      );
      const repo = yield* this.forge.repo(p);
      const changed = yield* this.git.run(
        e.worktree_directory,
        ["diff", "--name-only", "-z", e.base_commit, e.delivered_commit],
        { trim: false, max_output_bytes: 65536 },
      );
      const all = changed.split("\0").filter(Boolean),
        files = all.slice(0, 10);
      const selected = new Map<string, string[]>(),
        notes: string[] = [];
      for (const path of [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]) {
        const text = yield* Effect.result(
          this.git.run(e.worktree_directory, ["show", `${e.base_commit}:${path}`], {
            max_output_bytes: 65536,
            trim: false,
          }),
        );
        if (text._tag === "Failure") {
          if (text.failure.code === "COMMAND_OUTPUT_LIMIT")
            notes.push(`${path} exceeds bounded suggestion size`);
          continue;
        }
        const owners = ownersFor(text.success, all.slice(0, 200), repo.full_name.split("/")[0]!);
        for (const [key, evidence] of owners.selected) selected.set(key, evidence.slice(0, 10));
        notes.push(...owners.notes);
        break;
      }
      const CommitAuthor = Schema.Struct({
        sha: NonEmpty,
        author: Schema.NullOr(Schema.Struct({ login: NonEmpty })),
      });
      for (const path of files) {
        const result = yield* Effect.result(
          this.forge.json(p, Schema.Array(CommitAuthor), [
            "api",
            `repos/${repo.full_name}/commits?sha=${e.delivered_commit}&path=${encodeURIComponent(path)}&per_page=5`,
          ]),
        );
        if (result._tag === "Failure") {
          notes.push(`Recent authorship unavailable for ${path}`);
          continue;
        }
        for (const commit of result.success)
          if (commit.author?.login && safeLogin.test(commit.author.login)) {
            const key = `user:${commit.author.login}`;
            selected.set(
              key,
              [...(selected.get(key) ?? []), `Recent commit ${commit.sha}: ${path}`].slice(0, 10),
            );
          }
      }
      const suggestions: (typeof ReviewerSuggestions.Type)["suggestions"][number][] = [];
      for (const [key, evidence] of [...selected].slice(0, 40)) {
        const [kind, name] = key.split(":") as ["user" | "team", string];
        const permission = yield* Effect.result(
          reviewerPermission(this.forge, p, repo.full_name, kind, name),
        );
        suggestions.push({
          kind,
          name,
          evidence,
          eligible: permission._tag === "Success" && permission.success,
          reason:
            permission._tag === "Failure"
              ? "Eligibility could not be confirmed"
              : permission.success
                ? undefined
                : "Repository write access is required",
        });
      }
      return {
        head: e.delivered_commit,
        suggestions,
        limited: all.length > 10 || selected.size > 40 || notes.length > 0,
        notes: notes.slice(0, 40),
      };
    }.bind(this),
    domainEffect,
  );
}
