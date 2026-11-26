import { constants } from "node:fs";
import { lstat, open, realpath, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { Schema } from "effect";
import { ContentHash, SafeRelativePath } from "@abracode/contracts/identities";
import { canonicalJson } from "@abracode/contracts/canonical-json";
import {
  maximumPortableHTMLBytes,
  portableRendererABI,
} from "@abracode/contracts/presentation/report-export-contract";

const refuse = (code: string, message: string) => Object.assign(new Error(message), { code });

/** Use one descriptor for inspection and capture, including an extra byte to detect growth. */
export async function captureRegularFile(path: string, maximum: number) {
  const expected = await lstat(path);
  if (!expected.isFile() || expected.size > maximum || (await realpath(path)) !== path)
    throw refuse("REPORT_PATH", "Expected a bounded owned regular file");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (
      !before.isFile() ||
      before.ino !== expected.ino ||
      before.dev !== expected.dev ||
      before.size > maximum
    )
      throw refuse("REPORT_PATH", "File ownership or size changed before capture");
    const bytes = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await file.stat();
    if (
      offset !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw refuse("REPORT_TAMPERED", "File bytes changed during bounded read");
    return { buffer: bytes.subarray(0, offset), dev: before.dev, ino: before.ino };
  } finally {
    await file.close();
  }
}

export const diagramFileLimit = 16 * 1024 * 1024;
export const Manifest = Schema.Struct({
  abi: Schema.Literal(portableRendererABI),
  inputs: Schema.Array(Schema.Struct({ file: SafeRelativePath, hash: ContentHash })).check(
    Schema.isMaxLength(8192),
  ),
  links: Schema.Array(Schema.Tuple([SafeRelativePath, SafeRelativePath])).check(
    Schema.isMaxLength(8192),
  ),
  notices_hash: ContentHash,
});
const Receipt = Schema.Struct({
  abi: Schema.Literal(portableRendererABI),
  fingerprint: ContentHash,
  html_hash: ContentHash,
  manifest_hash: ContentHash,
  engine_hash: ContentHash,
  host_hash: ContentHash,
  bytes: Schema.Int.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(maximumPortableHTMLBytes),
  ),
});
export const ManifestJSON = Schema.fromJsonString(Manifest);
export const PointerJSON = Schema.fromJsonString(Schema.Struct({ fingerprint: ContentHash }));
const decodeReceipt = Schema.decodeUnknownSync(Schema.fromJsonString(Receipt), {
  reportInput: false,
});
const hash = (text: string) => ContentHash.make(createHash("sha256").update(text).digest("hex"));
export function evidence(manifest: string, html: string, engine: string, host: string) {
  const assets = {
    abi: portableRendererABI,
    manifest_hash: hash(manifest),
    html_hash: hash(html),
    engine_hash: hash(engine),
    host_hash: hash(host),
    bytes: Buffer.byteLength(html),
  };
  return { ...assets, fingerprint: hash(canonicalJson(assets)) };
}

export async function captureText(path: string, maximum: number) {
  return (await captureTextFile(path, maximum)).text;
}

export async function captureTextFile(path: string, maximum: number) {
  const { buffer, dev, ino } = await captureRegularFile(path, maximum);
  if (!isUtf8(buffer)) throw refuse("REPORT_TAMPERED", "Captured file contains invalid UTF-8");
  return { text: buffer.toString("utf8"), bytes: buffer.length, dev, ino };
}

export async function readPreparedBundle(root: string, fingerprint: ContentHash) {
  const directory = join(root, fingerprint);
  if ((await realpath(directory)) !== directory || !(await lstat(directory)).isDirectory())
    throw refuse("REPORT_SHELL", "Renderer cache directory changed ownership");
  if (
    (await readdir(directory)).sort().join("/") !==
    "diagram-engine.js/diagram-host.cjs/index.html/manifest.json/receipt.json"
  )
    throw refuse("REPORT_SHELL", "Renderer cache contains unexpected files");
  const [manifest, html, engine, host, rawReceipt] = await Promise.all([
    captureText(join(directory, "manifest.json"), 2 * 1024 * 1024),
    captureText(join(directory, "index.html"), maximumPortableHTMLBytes),
    captureText(join(directory, "diagram-engine.js"), diagramFileLimit),
    captureText(join(directory, "diagram-host.cjs"), diagramFileLimit),
    captureText(join(directory, "receipt.json"), 4096),
  ]);
  let receipt: typeof Receipt.Type;
  try {
    receipt = decodeReceipt(rawReceipt);
  } catch {
    throw refuse(
      "REPORT_SHELL",
      "Invalid or incompatible prepared renderer receipt. Run pnpm report:prepare or pnpm build.",
    );
  }
  const expected = evidence(manifest, html, engine, host);
  if (expected.fingerprint !== fingerprint || canonicalJson(receipt) !== canonicalJson(expected))
    throw refuse("REPORT_SHELL", "Renderer bundle digest does not match its receipt");
  return { fingerprint, manifest, html, engine, host };
}
