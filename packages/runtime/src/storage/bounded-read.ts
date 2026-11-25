import type { FileHandle } from "node:fs/promises";

/** An extra byte distinguishes a complete read from an oversized file, even on short reads. */
export async function readFilePrefix(handle: Pick<FileHandle, "read">, limit: number) {
  const buffer = Buffer.alloc(limit + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  return { buffer: buffer.subarray(0, Math.min(limit, offset)), limited: offset > limit };
}
