import { Transform, type TransformCallback } from "node:stream";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** OpenCode 2.3's generic typed-field dock uses the mcp-elicitation renderer tag.
 * Project older AbraCode forms for display without changing their retained identity. */
function present(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(present);
  if (!object(value)) return value;
  if (
    Array.isArray(value.fields) &&
    object(value.metadata) &&
    value.metadata.source === "abracode" &&
    value.metadata.kind === undefined
  )
    return { ...value, metadata: { ...value.metadata, kind: "mcp-elicitation" } };
  if ("data" in value) return { ...value, data: present(value.data) };
  return value;
}

/** Only bounded form JSON is buffered. Chat, assets and event streams pass through. */
export class WebForms extends Transform {
  private chunks: Buffer[] = [];
  private size = 0;
  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback) {
    this.size += chunk.length;
    if (this.size > 8 * 1024 * 1024)
      return done(new Error("Form response exceeds the web display limit"));
    this.chunks.push(chunk);
    done();
  }
  override _flush(done: TransformCallback) {
    try {
      this.push(JSON.stringify(present(JSON.parse(Buffer.concat(this.chunks).toString("utf8")))));
      done();
    } catch {
      done(new Error("Invalid native form response"));
    }
  }
}
