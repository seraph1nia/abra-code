import type { Git } from "../git/repository.ts";
import { constants } from "node:fs";
import { open, realpath, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import {
  CaptureInputSchema,
  WorkerReferenceSchema,
  type WorkerReference,
  type RetainedReference,
  type CaptureInput,
  type EvidenceQuery,
  type EvidenceReceipt,
} from "@abracode/contracts/web/worker-evidence";
import { CrewError, type Execution } from "../domain.ts";
import {
  ContentHash,
  StorageKey,
  timestamp,
  type AbsolutePath,
  type SessionId,
} from "@abracode/contracts/identities";
import { decode } from "../decode.ts";
import type { Store } from "../storage/store.ts";
import { canonicalJSON } from "../presentation/identity.ts";

const maxBytes = 2 * 1024 * 1024;
const fail = (message: string) => new CrewError("WORKER_EVIDENCE", message);
const digest = (bytes: Buffer) =>
  ContentHash.make(createHash("sha256").update(bytes).digest("hex"));
const key = (hash: ContentHash) => StorageKey.make("work/evidence/bytes/" + hash);

/** Compare every path component with its canonical spelling. Never follow a replaced final link. */
async function readOwned(root: string, relative: string, limit: number) {
  const path = resolve(root, relative);
  if (
    (await realpath(root)) !== root ||
    (await realpath(path)) !== path ||
    !path.startsWith(root + "/")
  )
    throw fail("Evidence must be a regular file inside its assigned directory");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > limit)
      throw fail("Evidence file is empty, unavailable or exceeds the capture size limit");
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const current = await lstat(path);
    if (
      length !== stat.size ||
      (await realpath(path)) !== path ||
      current.ino !== stat.ino ||
      current.dev !== stat.dev ||
      current.mtimeMs !== stat.mtimeMs
    )
      throw fail("Evidence changed during capture");
    return buffer.subarray(0, length);
  } finally {
    await file.close();
  }
}
export function captureEvidence(
  store: Store,
  home: AbsolutePath,
  e: Execution,
  session: SessionId,
  input: CaptureInput,
) {
  return Effect.gen(function* () {
    const source = yield* decode(CaptureInputSchema, input, "Worker evidence");
    const previous = e.worker_evidence?.find((item) => item.request_id === source.request_id);
    if (previous) {
      const prior = yield* decode(CaptureInputSchema, previous, "Retained evidence");
      if (
        previous.session_id !== session ||
        previous.generation !== e.control_generation ||
        canonicalJSON(prior) !== canonicalJSON(source)
      )
        return yield* fail("Evidence request has different inputs or ownership");
      return previous;
    }
    if ((e.worker_evidence?.length ?? 0) >= 64)
      return yield* fail("The task already has 64 retained evidence items");
    const root =
      source.kind === "trace" ? e.worktree_directory : resolve(home, ".abracode/browser", session);
    if (!root) return yield* fail("The owned worktree is unavailable");
    const bytes = yield* Effect.tryPromise({
      try: () => readOwned(root, source.path, maxBytes),
      catch: CrewError.from,
    });
    const common = {
      ...source,
      issue_id: e.issue_id,
      session_id: session,
      generation: e.control_generation,
      at: yield* timestamp,
      hash: digest(bytes),
      bytes: bytes.length,
    };
    let receipt: EvidenceReceipt;
    if (source.kind === "trace") {
      if (!source.path.endsWith(".zip") || !isTraceArchive(bytes))
        return yield* fail("A Playwright trace ZIP containing a .trace entry is required");
      receipt = { ...common, kind: "trace" };
    } else {
      if (
        bytes.length < 45 ||
        bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a" ||
        bytes.readUInt32BE(8) !== 13 ||
        bytes.toString("ascii", 12, 16) !== "IHDR" ||
        bytes.toString("ascii", bytes.length - 8, bytes.length - 4) !== "IEND"
      )
        return yield* fail("A PNG screenshot is required");
      const width = bytes.readUInt32BE(16),
        height = bytes.readUInt32BE(20);
      if (!width || !height || width * height > 32_000_000)
        return yield* fail("Unsupported image dimensions");
      receipt = { ...common, kind: "screenshot", width, height };
    }
    yield* store.set(key(receipt.hash), bytes.toString("base64"));
    return receipt;
  });
}
export function retainedEvidence(store: Store, e: Execution | undefined, q: EvidenceQuery) {
  return Effect.gen(function* () {
    const receipt = e?.worker_evidence?.find(
      (r) => r.issue_id === q.issue_id && r.request_id === q.request_id && r.hash === q.hash,
    );
    if (!receipt) return yield* fail("This exact evidence item is unavailable");
    const data = yield* decode(Schema.String, yield* store.get(key(q.hash)), "Evidence bytes");
    const bytes = Buffer.from(data, "base64");
    if (bytes.length !== receipt.bytes || digest(bytes) !== q.hash)
      return yield* fail("Retained evidence integrity failed");
    return { receipt, data };
  });
}

// Inspect the central directory without decompressing or running any archive entries.
function isTraceArchive(bytes: Buffer) {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) return false;
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (
    end < 0 ||
    end + 22 > bytes.length ||
    end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length
  )
    return false;
  let pos = bytes.readUInt32LE(end + 16);
  const entries = bytes.readUInt16LE(end + 10);
  if (pos + bytes.readUInt32LE(end + 12) !== end || entries > 8192) return false;
  let trace = false;
  for (let i = 0; i < entries; i++) {
    if (pos + 46 > end || bytes.readUInt32LE(pos) !== 0x02014b50) return false;
    const n = bytes.readUInt16LE(pos + 28),
      next = pos + 46 + n + bytes.readUInt16LE(pos + 30) + bytes.readUInt16LE(pos + 32);
    if (next > end) return false;
    const name = bytes.toString("utf8", pos + 46, pos + 46 + n);
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) return false;
    if (name.endsWith(".trace")) trace = true;
    pos = next;
  }
  return pos === end && trace;
}

export function captureReference(
  git: Git,
  e: Execution,
  session: SessionId,
  reference: WorkerReference,
) {
  return Effect.gen(function* () {
    const source = yield* decode(WorkerReferenceSchema, reference, "Worker reference");
    const result: RetainedReference = {
      source,
      session_id: session,
      generation: e.control_generation,
    };
    if (source.kind === "documentation") return result;
    const root = e.worktree_directory;
    if (
      !root ||
      ![e.base_commit, e.implementation_head, e.delivered_commit].includes(source.revision)
    )
      return result;
    const entry = yield* git
      .run(root, ["--literal-pathspecs", "ls-tree", "-z", source.revision, "--", source.file], {
        trim: false,
      })
      .pipe(Effect.orElseSucceed(() => ""));
    const match = /^100(?:644|755) blob ([a-f0-9]+)\t/.exec(entry);
    if (!match) return result;
    const blob = yield* git
      .run(root, ["cat-file", "blob", match[1]], { trim: false, max_output_bytes: 65536 })
      .pipe(Effect.orElseSucceed(() => ""));
    const line = blob && !blob.includes("\0") ? blob.split("\n")[source.line - 1] : undefined;
    return line === undefined ? result : { ...result, excerpt: line.slice(0, 2048) };
  });
}
