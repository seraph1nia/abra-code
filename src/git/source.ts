import {
  AbsolutePath,
  BranchName,
  Commit,
  GitRemote,
  RemoteIdentity,
  ExecutionId,
  RepositoryId,
} from "../identities.ts";

import { domainEffect } from "../effect.ts";
import { Effect, Schema } from "effect";
import { decodeJSON } from "../decode.ts";
import { PackageSchema } from "../config/contracts.ts";
import { NonEmpty } from "../contracts.ts";
import { access, mkdir, readFile, rename, writeFile } from "../filesystem.ts";
import { isAbsolute, join, resolve } from "node:path";
import { CrewError, ensure, identifier, type Project } from "../domain.ts";
import { Git } from "./repository.ts";
const exists = (path: AbsolutePath) =>
  access(path).pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }));
// Identity is separate from the transport URL: HTTPS and SSH may name the same repository.
export function remoteIdentity(remote: GitRemote, cwd?: AbsolutePath): RemoteIdentity {
  ensure(remote.length > 0 && !remote.startsWith("-"), "REMOTE", "Invalid remote");
  if (isAbsolute(remote)) return RemoteIdentity.make(resolve(remote));
  if (!remote.includes(":")) {
    ensure(cwd, "REMOTE", "Supply a repository URL or absolute remote path");
    return RemoteIdentity.make(resolve(cwd, remote));
  }
  const scp = /^(?:[^@/:]+@)?([^/:]+):([^:].*)$/.exec(remote);
  let url: URL;
  try {
    url = scp && !remote.includes("://") ? new URL(`ssh://${scp[1]}/${scp[2]}`) : new URL(remote);
  } catch {
    ensure(false, "REMOTE", "Invalid repository URL");
  }
  ensure(
    ["https:", "http:", "ssh:", "file:"].includes(url.protocol),
    "REMOTE",
    "Unsupported Git transport",
  );
  ensure(
    !url.password && (!url.username || url.protocol === "ssh:"),
    "REMOTE",
    "Keep credentials out of remote URLs",
  );
  ensure(
    !url.search && !url.hash,
    "REMOTE",
    "Remote URLs cannot include query strings or fragments",
  );
  if (url.protocol === "file:")
    return RemoteIdentity.make(resolve(decodeURIComponent(url.pathname)));
  let path = url.pathname.replace(/\/+$/, "").replace(/\.git$/, "");
  if (url.hostname.toLowerCase() === "github.com") path = path.toLowerCase();
  ensure(path.length > 1, "REMOTE", "Remote must identify a repository");
  return RemoteIdentity.make(`${url.host.toLowerCase()}${path}`);
}
export class RepositorySources {
  constructor(
    private git: Git,
    private root: AbsolutePath,
  ) {}
  clone = Effect.fn("RepositorySources.clone")(
    function* (this: RepositorySources, id: RepositoryId, remote: GitRemote) {
      identifier(id);
      const identity = remoteIdentity(remote);
      if (!isAbsolute(this.root))
        return yield* new CrewError("CONFIG", "Managed repository root must be absolute");
      const directory = AbsolutePath.make(join(this.root, id));
      yield* mkdir(directory, { recursive: true });
      const path = AbsolutePath.make(join(directory, "checkout"));
      const pending = AbsolutePath.make(join(directory, "pending"));
      const intent = AbsolutePath.make(join(directory, "clone.json"));
      if (!(yield* exists(path))) {
        if (yield* exists(intent)) {
          const saved = yield* decodeJSON(
            Schema.Struct({ remote: NonEmpty }),
            yield* readFile(intent, "utf8"),
            "Clone intent",
          );
          if (!(saved.remote === identity))
            return yield* new CrewError("PROJECT_REBIND", "Clone intent belongs to another remote");
        } else {
          if (yield* exists(pending))
            return yield* new CrewError(
              "CLONE_AMBIGUOUS",
              "Unowned partial clone; preserve it and inspect manually",
            );
          yield* writeFile(intent, JSON.stringify({ remote: identity }), { flag: "wx" });
        }
        if (!(yield* exists(pending)))
          yield* this.git.run(directory, ["clone", "--origin", "origin", "--", remote, pending]);
        // A complete interrupted clone can be adopted. Invalid partial directories are retained.
        const candidate = yield* this.git.identity(pending);
        if (!(remoteIdentity(candidate.remote) === identity))
          return yield* new CrewError("REMOTE_MISMATCH", "Partial clone has a different origin");
        yield* this.git.head(pending);
        if (yield* this.git.dirty(pending))
          return yield* new CrewError(
            "CLONE_AMBIGUOUS",
            "Partial clone has checkout changes; preserve it for inspection",
          );
        yield* rename(pending, path);
      }
      const current = yield* this.git.identity(path);
      if (!(remoteIdentity(current.remote) === identity))
        return yield* new CrewError("REMOTE_MISMATCH", "Managed clone has a different origin");
      return current;
    }.bind(this),
    domainEffect,
  );
  fetch = Effect.fn("RepositorySources.fetch")(
    function* (this: RepositorySources, path: AbsolutePath, target?: BranchName) {
      if (target === undefined) {
        const output = yield* this.git.run(path, ["ls-remote", "--symref", "origin", "HEAD"]);
        const discovered = /^ref: refs\/heads\/([^\t\n]+)\tHEAD$/m.exec(output)?.[1];
        target = discovered ? BranchName.make(discovered) : undefined;
        if (!target)
          return yield* new CrewError(
            "DEFAULT_BRANCH",
            "Remote HEAD does not identify a default branch; configure target_branch explicitly",
          );
      }
      yield* this.git.run(path, ["check-ref-format", `refs/heads/${target}`]);
      const ref = `refs/remotes/origin/${target}`;
      yield* this.git.run(path, ["fetch", "--no-tags", "origin", `+refs/heads/${target}:${ref}`]);
      const commit = Commit.make(
        yield* this.git.run(path, ["rev-parse", "--verify", `${ref}^{commit}`]),
      );
      return { target_branch: target, commit };
    }.bind(this),
    domainEffect,
  );
  base = Effect.fn("RepositorySources.base")(
    function* (this: RepositorySources, p: Project, executionID: ExecutionId) {
      const result = yield* this.fetch(
        p.path,
        p.branch_policy === "default" ? undefined : p.target_branch,
      );
      identifier(executionID);
      // Retain a fetched commit even if the remote moves before native provisioning recovers.
      yield* this.git.run(p.path, [
        "update-ref",
        `refs/abracode/bases/${executionID}`,
        result.commit,
      ]);
      return result;
    }.bind(this),
    domainEffect,
  );
  inspect = Effect.fn("RepositorySources.inspect")(
    function* (this: RepositorySources, path: AbsolutePath, commit: Commit) {
      const files = new Set(
        (yield* this.git.run(path, ["ls-tree", "-r", "--name-only", "-z", commit])).split("\0"),
      );
      const read = (name: string) =>
        files.has(name) ? this.git.run(path, ["show", `${commit}:${name}`]) : Effect.succeed(null);
      const [config, agents, packageJSON] = yield* Effect.all(
        [read("openspec/config.yaml"), read("AGENTS.md"), read("package.json")],
        { concurrency: "unbounded" },
      );
      const pkg = yield* decodeJSON(
        PackageSchema,
        packageJSON ?? "{}",
        "Managed repository package.json",
      );
      const manager = files.has("pnpm-lock.yaml")
        ? "pnpm"
        : files.has("yarn.lock")
          ? "yarn"
          : "npm";
      return {
        commit,
        agents_md: agents !== null,
        agents_md_content: agents,
        skills: [
          ...new Set(
            [...files].flatMap((name) => /^\.agents\/skills\/([^/]+)\//.exec(name)?.[1] ?? []),
          ),
        ],
        openspec_config: config,
        verification: ["test", "lint", "typecheck", "check", "build"]
          .filter((name) => pkg.scripts?.[name])
          .map((name) => [manager, "run", name]),
      };
    }.bind(this),
    domainEffect,
  );
}
