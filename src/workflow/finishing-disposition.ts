import { createHash } from "node:crypto";
import { join } from "node:path";
import { Effect } from "effect";
import { AbsolutePath, ContentHash, Fingerprint, timestamp } from "../identities.ts";
import { CrewError, type Execution } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { type Git } from "../git/repository.ts";
import { type CleanupSample } from "../git/cleanup.ts";
import { inspectGeneratedPath, sameDirectory, directoryIdentity } from "../git/retirement.ts";
import { GeneratedPathSchema, GeneratedPathsSchema } from "../config/paths.ts";
import { Schema } from "effect";
import { decode } from "../decode.ts";
import { lstat, pathExists } from "../filesystem.ts";
import { type Records } from "../storage/store.ts";
import { type FinishingTarget } from "./finishing-contracts.ts";

const fileHash = Effect.fn("Finishing.fileHash")(function* (git: Git, e: Execution, path: string) {
  let cursor = e.worktree_directory!;
  for (const [i, part] of path.split("/").entries()) {
    cursor = AbsolutePath.make(join(cursor, part));
    const stat = yield* lstat(cursor);
    if (
      stat.isSymbolicLink() ||
      (i === path.split("/").length - 1 ? !stat.isFile() : !stat.isDirectory())
    )
      return yield* new CrewError(
        "FINISHING_PATH",
        "Inclusion requires an exact regular file with real directory ancestors",
      );
  }
  return yield* decode(
    ContentHash,
    yield* git.run(e.worktree_directory!, ["hash-object", "--", path]),
    "Disposition file content",
  );
}, domainEffect);

/** Only exact safe directories/files become selectable consequential targets. */
export const residueTarget = Effect.fn("Finishing.residueTarget")(function* (
  git: Git,
  e: Execution,
  sample: CleanupSample,
) {
  if (!e.worktree_identity)
    return yield* new CrewError("OWNERSHIP", "Retained worktree identity required");
  const directories: Extract<FinishingTarget, { kind: "residue" }>["directories"][number][] = [];
  const files: Extract<FinishingTarget, { kind: "residue" }>["files"][number][] = [];
  for (const item of sample.paths) {
    if (item.kind === "directory" && Schema.is(GeneratedPathSchema)(item.path)) {
      const inspected = yield* Effect.result(inspectGeneratedPath(git, e, item.path));
      if (inspected._tag === "Success")
        directories.push({ path: item.path, identity: inspected.success });
    } else if (item.kind === "file") {
      const hashed = yield* Effect.result(fileHash(git, e, item.path));
      if (hashed._tag === "Success") files.push({ path: item.path, hash: hashed.success });
    }
  }
  const target = {
    schema_version: 1 as const,
    kind: "residue" as const,
    generation: e.control_generation,
    worktree: e.worktree_identity,
    paths: sample.paths,
    truncated: sample.truncated,
    directories,
    files: e.current_phase === "cleaning" ? [] : files,
    fingerprint: Fingerprint.make(
      createHash("sha256")
        .update(JSON.stringify([sample.fingerprint, directories, files]))
        .digest("hex"),
    ),
  };
  return target satisfies FinishingTarget;
}, domainEffect);

/** Apply answered native receipts under execution ownership. Collection alone never mutates files. */
export const applyDispositions = Effect.fn("Finishing.applyDispositions")(function* (
  git: Git,
  records: Records,
  e: Execution,
) {
  let included = false;
  if (e.stop_status) return { included };
  for (const d of e.decisions ?? []) {
    const target = d.finishing_target;
    const answer = d.finishing_answer;
    if (
      !(
        d.generation === e.control_generation &&
        d.status === "answered" &&
        target &&
        answer &&
        d.form_id &&
        d.form_session &&
        d.resolved_at
      )
    )
      continue;
    if (target.kind !== "residue" || answer.action === "defer" || answer.action === "preserve")
      continue;
    if (
      !(
        e.operation?.generation === e.control_generation &&
        e.worktree_identity &&
        sameDirectory(target.worktree, e.worktree_identity) &&
        sameDirectory(target.worktree, yield* directoryIdentity(e.worktree_directory!))
      )
    )
      return yield* new CrewError("CLEANUP_REPLACEMENT", "Disposition worktree identity changed");
    if (answer.action === "generated") {
      if (
        e.finishing?.authorizations?.some((a) => a.key === d.key && a.generation === d.generation)
      )
        continue;
      const selected = target.directories.filter((dir) => answer.paths.includes(dir.path));
      if (selected.length !== answer.paths.length)
        return yield* new CrewError("DECISION_TARGET", "Selected directory set changed");
      yield* decode(
        GeneratedPathsSchema,
        [
          ...e.effective_policy.generated_paths,
          ...selected.map((dir) => dir.path),
          ...(e.finishing?.authorizations
            ?.filter((a) => a.generation === e.control_generation)
            .flatMap((a) => a.directories.map((dir) => dir.path)) ?? []),
        ],
        "Execution cleanup policy",
      );
      for (const dir of selected) {
        const current = yield* inspectGeneratedPath(git, e, dir.path);
        if (!sameDirectory(current, dir.identity))
          return yield* new CrewError(
            "CLEANUP_REPLACEMENT",
            "Selected directory was replaced before authorization",
          );
      }
      e.finishing = {
        ...e.finishing,
        schema_version: 1,
        authorizations: [
          ...(e.finishing?.authorizations ?? []),
          {
            schema_version: 1,
            generation: e.control_generation,
            revision: (e.finishing?.authorizations?.at(-1)?.revision ?? 0) + 1,
            key: d.key,
            form_id: d.form_id,
            session_id: d.form_session,
            authorized_at: yield* timestamp,
            worktree: target.worktree,
            fingerprint: target.fingerprint,
            directories: selected,
          },
        ],
      };
      e.finishing = { ...e.finishing, preflight: undefined };
      delete e.cleanup_blocker;
      yield* records.save(e);
    } else if (answer.action === "include") {
      if (e.current_phase === "cleaning")
        return yield* new CrewError(
          "FINISHING_FOLLOW_ON",
          "Already preserved delivery cannot silently include additional files",
        );
      const selected = target.files.filter((file) => answer.paths.includes(file.path));
      if (selected.length !== answer.paths.length)
        return yield* new CrewError("DECISION_TARGET", "Selected file set changed");
      // Idempotence is based on a retained inclusion receipt, never an answer string.
      if (
        e.finishing?.inclusions?.some(
          (i) => i.key === d.key && i.generation === d.generation && i.stage === "staged",
        )
      )
        continue;
      for (const file of selected) {
        if (
          !(yield* pathExists(join(e.worktree_directory!, file.path))) ||
          file.hash !== (yield* fileHash(git, e, file.path))
        )
          return yield* new CrewError(
            "DECISION_STALE",
            "Selected file content changed; request fresh adoption",
          );
      }
      const prior = e.finishing?.inclusions?.find(
        (i) => i.key === d.key && i.generation === d.generation,
      );
      const intended = yield* git.candidateTree(
        e.worktree_directory!,
        selected.map((file) => file.path),
      );
      if (prior && prior.intended_tree !== intended)
        return yield* new CrewError("DECISION_STALE", "Inclusion input changed during recovery");
      e.finishing = {
        ...e.finishing,
        schema_version: 1,
        inclusions: prior
          ? e.finishing!.inclusions
          : [
              ...(e.finishing?.inclusions ?? []),
              {
                schema_version: 1,
                generation: e.control_generation,
                key: d.key,
                files: selected,
                stage: "admitted",
                intended_tree: intended,
                source_clean: !(yield* git.dirty(e.worktree_directory!)),
                head: yield* git.head(e.worktree_directory!),
              },
            ],
      };
      yield* records.save(e);
      for (const file of selected)
        yield* git.run(e.worktree_directory!, [
          "--literal-pathspecs",
          "add",
          "--force",
          "--",
          file.path,
        ]);
      for (const file of selected)
        if (file.hash !== (yield* fileHash(git, e, file.path)))
          return yield* new CrewError("DECISION_STALE", "Selected file changed while staging");
      if ((yield* git.candidateTree(e.worktree_directory!)) !== intended)
        return yield* new CrewError("DECISION_STALE", "Other content changed during inclusion");
      const staged = yield* git.fingerprint(e.worktree_directory!);
      e.finishing = {
        ...e.finishing,
        schema_version: 1,
        inclusions: e.finishing.inclusions!.map((i) =>
          i.key === d.key ? { ...i, stage: "staged", content: staged } : i,
        ),
      };
      e.finishing = { ...e.finishing, preflight: undefined };
      yield* records.save(e);
      included = true;
    }
  }
  return { included };
}, domainEffect);
