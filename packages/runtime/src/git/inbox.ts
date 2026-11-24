import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { readFile } from "../filesystem.ts";
import { Effect, Schema } from "effect";
import { createHash } from "node:crypto";
import { Commit, GitRemote, Timestamp, type RepositoryId } from "@abracode/contracts/identities";
import { Positive, Count } from "@abracode/contracts/primitives";
import { CrewError, ensure, type Project } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { decode, decodeJSON } from "../decode.ts";
import { Forge } from "./forge.ts";
import { remoteIdentity } from "./source.ts";
import {
  InboxState,
  type InboxTarget,
  type InboxSummary,
} from "@abracode/contracts/visibility/github-inbox";

const actor = Schema.NullOr(Schema.Struct({ login: Schema.String }));
const pageInfo = Schema.Struct({
  hasNextPage: Schema.Boolean,
  endCursor: Schema.NullOr(Schema.String),
});
const fields = {
  id: Schema.NonEmptyString,
  number: Positive,
  url: Schema.String,
  title: Schema.String,
  state: InboxState,
  updatedAt: Timestamp,
  author: actor,
  isDraft: Schema.optional(Schema.Boolean),
  labels: Schema.Struct({ nodes: Schema.Array(Schema.Struct({ name: Schema.String })), pageInfo }),
};
const summarySchema = Schema.Struct(fields);
const detailSchema = Schema.Struct({
  ...fields,
  body: Schema.String,
  comments: Schema.Struct({
    nodes: Schema.Array(Schema.Struct({ author: actor, body: Schema.String })),
    totalCount: Count,
  }),
  baseRefOid: Schema.optional(Commit),
  headRefOid: Schema.optional(Commit),
  changedFiles: Schema.optional(Count),
});
const repoFields = { id: Schema.NonEmptyString, url: Schema.String };
const viewer = Schema.Struct({ id: Schema.NonEmptyString });
const listEnvelope = Schema.Struct({
  data: Schema.Struct({
    viewer,
    repository: Schema.NullOr(
      Schema.Struct({
        ...repoFields,
        items: Schema.Struct({ nodes: Schema.Array(summarySchema), pageInfo }),
      }),
    ),
  }),
  errors: Schema.optional(Schema.Array(Schema.Unknown)),
});
const detailEnvelope = Schema.Struct({
  data: Schema.Struct({
    viewer,
    repository: Schema.NullOr(Schema.Struct({ ...repoFields, item: Schema.NullOr(detailSchema) })),
  }),
  errors: Schema.optional(Schema.Array(Schema.Unknown)),
});
const common =
  "id number url title state updatedAt author { login } labels(first:100){ nodes { name } pageInfo { hasNextPage endCursor } }";
const options = { deadline_ms: 15000, max_output_bytes: 2 * 1024 * 1024 };
export type InboxOrigin = { host: string; owner: string; name: string };
export const githubHosts = Effect.suspend(() => {
  const config =
    process.env.GH_CONFIG_DIR ||
    join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "gh");
  return readFile(join(config, "hosts.yml"), "utf8").pipe(
    Effect.flatMap((text) =>
      Effect.try({
        try: () => Object.keys(parse(text) ?? {}),
        catch: (cause) =>
          new CrewError(
            "INBOX_CONFIG",
            `Invalid GitHub CLI hosts configuration: ${cause instanceof Error ? cause.message : String(cause)}`,
          ),
      }),
    ),
    Effect.catchIf(
      (error) => error.code === "ENOENT",
      () => Effect.succeed([] as string[]),
    ),
    Effect.map(
      (hosts) =>
        new Set([
          "github.com",
          ...hosts.map((h) => h.toLowerCase()),
          ...(process.env.GH_HOST ? [process.env.GH_HOST.toLowerCase()] : []),
        ]),
    ),
  );
});
export function inboxOrigin(project: Project, hosts: ReadonlySet<string>): InboxOrigin | undefined {
  const match = /^([a-z0-9.-]+)\/([\w.-]+)\/([\w.-]+)$/i.exec(
    remoteIdentity(project.remote, project.path),
  );
  if (!match) return;
  const [, host, owner, name] = match;
  // Recognize enterprise origins through the active GitHub CLI configuration.
  if (!hosts.has(host!)) return;
  return { host: host!, owner: owner!, name: name! };
}
function normalize(
  row: typeof summarySchema.Type,
  project: RepositoryId,
  repo: string,
  kind: InboxTarget["kind"],
  origin: InboxOrigin,
): InboxSummary {
  const base = "https://" + origin.host + "/" + origin.owner + "/" + origin.name;
  ensure(
    row.url.toLowerCase() ===
      (base + "/" + (kind === "pr" ? "pull" : "issues") + "/" + row.number).toLowerCase(),
    "INBOX_IDENTITY",
    "GitHub returned a different item URL",
  );
  return {
    repository_id: project,
    repo_node: repo,
    item_node: row.id,
    kind,
    number: row.number,
    url: row.url,
    title: row.title,
    author: row.author?.login ?? null,
    labels: row.labels.nodes.map((x) => x.name),
    labels_complete: !row.labels.pageInfo.hasNextPage,
    state: row.state,
    updated_at: row.updatedAt,
    draft: row.isDraft ?? false,
  };
}
export class InboxForge {
  constructor(private forge: Forge) {}
  partition(p: Project, origin: InboxOrigin) {
    // Local credential lookup lets a warm read detect an account switch without an API request.
    return this.forge
      .run(p, ["auth", "token", "--hostname", origin.host], { deadline_ms: 5000 })
      .pipe(
        Effect.mapError(
          () => new CrewError("INBOX_AUTH", "GitHub credentials unavailable for " + origin.host),
        ),
        Effect.flatMap((token) =>
          token.trim()
            ? Effect.succeed(
                createHash("sha256")
                  .update(origin.host + "\0" + token.trim())
                  .digest("hex"),
              )
            : Effect.fail(new CrewError("INBOX_AUTH", "Sign in to GitHub to see this repository")),
        ),
      );
  }
  private graphql<S extends Schema.Constraint>(
    p: Project,
    o: InboxOrigin,
    schema: S,
    query: string,
    vars: string[],
  ) {
    return this.forge
      .run(
        p,
        [
          "api",
          "--hostname",
          o.host,
          "graphql",
          "-f",
          "query=" + query,
          "-f",
          "owner=" + o.owner,
          "-f",
          "name=" + o.name,
          ...vars,
        ],
        options,
      )
      .pipe(
        Effect.mapError((err) =>
          /rate.limit|retry.after|abuse detection/i.test(err.message)
            ? new CrewError("INBOX_LIMIT", "GitHub rate limit reached")
            : /forbidden|unauthorized|could not resolve to a repository|not found|HTTP (401|403|404)/i.test(
                  err.message,
                )
              ? new CrewError("INBOX_ACCESS", "GitHub repository access unavailable")
              : new CrewError("INBOX_READ", "GitHub observation unavailable"),
        ),
        Effect.flatMap((raw) => decodeJSON(schema, raw, "GitHub inbox response")),
      );
  }
  page(
    p: Project,
    o: InboxOrigin,
    kind: InboxTarget["kind"],
    mode: "open" | "history" | "delta",
    cursor?: string,
    label?: string,
  ) {
    const pr = kind === "pr";
    const states =
      mode === "delta"
        ? ""
        : mode === "open"
          ? "states:[OPEN],"
          : pr
            ? "states:[CLOSED,MERGED],"
            : "states:[CLOSED],";
    const query =
      "query($owner:String!,$name:String!,$cursor:String" +
      (label ? ",$label:String!" : "") +
      "){ viewer{id} repository(owner:$owner,name:$name){id url items:" +
      (pr ? "pullRequests" : "issues") +
      "(" +
      states +
      (label ? "labels:[$label]," : "") +
      "first:50,after:$cursor,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{" +
      common +
      (pr ? " isDraft" : "") +
      "} pageInfo{hasNextPage endCursor}}}}";
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const r = yield* this.graphql(p, o, listEnvelope, query, [
          ...(cursor ? ["-f", "cursor=" + cursor] : []),
          ...(label ? ["-f", "label=" + label] : []),
        ]);
        const repo = r.data.repository;
        const repoRemote = repo
          ? yield* decode(GitRemote, repo.url, "GitHub repository URL")
          : undefined;
        ensure(
          repo &&
            repoRemote &&
            remoteIdentity(repoRemote, p.path) === remoteIdentity(p.remote, p.path),
          "INBOX_ACCESS",
          "Incomplete or mismatched repository observation",
        );
        ensure(!r.errors?.length, "INBOX_READ", "GitHub returned incomplete results");
        const items = repo.items.nodes.map((row) => {
          const item = normalize(row, p.id, repo.id, kind, o);
          return label && !item.labels_complete && !item.labels.includes(label)
            ? { ...item, labels: [...item.labels, label] }
            : item;
        });
        const { hasNextPage, endCursor } = repo.items.pageInfo;
        ensure(
          !hasNextPage || (endCursor && endCursor !== cursor),
          "INBOX_CURSOR",
          "GitHub returned an invalid continuation",
        );
        return {
          items,
          repo: repo.id,
          viewer: r.data.viewer.id,
          cursor: hasNextPage ? endCursor! : undefined,
        };
      }),
    );
  }
  detail(p: Project, o: InboxOrigin, target: InboxTarget) {
    const pr = target.kind === "pr";
    const query =
      "query($owner:String!,$name:String!,$number:Int!){viewer{id} repository(owner:$owner,name:$name){id url item:" +
      (pr ? "pullRequest" : "issue") +
      "(number:$number){" +
      common +
      " body comments(last:10){totalCount nodes{author{login} body}} " +
      (pr ? "isDraft baseRefOid headRefOid changedFiles" : "") +
      "}}}";
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const response = yield* this.graphql(p, o, detailEnvelope, query, [
          "-F",
          "number=" + target.number,
        ]);
        const repo = response.data.repository,
          row = repo?.item;
        const repoRemote = repo
          ? yield* decode(GitRemote, repo.url, "GitHub repository URL")
          : undefined;
        ensure(
          repo &&
            repoRemote &&
            repo.id === target.repo_node &&
            remoteIdentity(repoRemote, p.path) === remoteIdentity(p.remote, p.path),
          "INBOX_ACCESS",
          "GitHub repository identity or access changed",
        );
        ensure(!response.errors?.length, "INBOX_READ", "GitHub returned incomplete item details");
        ensure(
          row?.id === target.item_node && row.number === target.number,
          "INBOX_IDENTITY",
          "Item identity or access changed",
        );
        const comments = row.comments.nodes.map((x) => ({
          author: x.author?.login ?? "Unknown",
          body: x.body.slice(0, 8192),
        }));
        return {
          ...normalize(row, p.id, repo.id, target.kind, o),
          body: row.body.slice(0, 65536),
          comments,
          comments_complete:
            comments.length === row.comments.totalCount &&
            row.comments.nodes.every((x) => x.body.length <= 8192),
          base: row.baseRefOid,
          head: row.headRefOid,
          changed_files: row.changedFiles,
        };
      }),
    );
  }
  files(p: Project, o: InboxOrigin, num: number, count: number) {
    const file = Schema.Struct({
      filename: Schema.String,
      patch: Schema.optional(Schema.String),
      additions: Count,
      deletions: Count,
    });
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        let seen = 0,
          partial = false,
          bytes = 0;
        const blocks: string[] = [];
        for (let page = 1; seen < count && page <= 30; page++) {
          const batch = yield* this.forge.json(
            p,
            Schema.Array(file),
            [
              "api",
              "--hostname",
              o.host,
              "repos/" +
                o.owner +
                "/" +
                o.name +
                "/pulls/" +
                num +
                "/files?per_page=100&page=" +
                page,
            ],
            options,
          );
          for (const f of batch) {
            seen++;
            const patch = f.patch ?? "";
            const lines = patch.split("\n");
            if (
              !patch ||
              lines.filter((x) => x.startsWith("+")).length !== f.additions ||
              lines.filter((x) => x.startsWith("-")).length !== f.deletions
            )
              partial = true;
            const block = f.filename + "\n" + patch;
            if (bytes + Buffer.byteLength(block) > 65536) {
              partial = true;
              break;
            }
            blocks.push(block);
            bytes += Buffer.byteLength(block);
          }
          if (batch.length < 100 || blocks.length < seen) break;
        }
        return {
          text: blocks.join("\n\n"),
          complete: !partial && seen === count,
          files: blocks.length,
        };
      }),
    );
  }
}
