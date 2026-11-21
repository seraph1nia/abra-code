import { ExpressParser } from "@a2ui/agent";
import { catalog, catalogId } from "./catalog.ts";
import { maxSurfaceBytes, validateSurface } from "./surfaces.ts";

export function compileWorkView(surfaceId: string, source: string) {
  if (Buffer.byteLength(source, "utf8") > maxSurfaceBytes)
    throw new Error("Shorten the Express source to fit the 384 KiB limit");
  const parser = new ExpressParser(catalog, surfaceId, "v1.0");
  const messages = parser.compile(source, true);
  // The SDK strips chat tags and discards surrounding prose. Check the entire
  // body with ordinary tag names when these delimiters occur. The grammar
  // still permits literal tags inside strings, including Mermaid labels.
  const body = source.replace(/<(\/?)a2ui(?=[\s>])/gi, "<$1express_literal");
  if (body !== source) {
    try {
      parser.compile(body, true);
    } catch {
      throw new Error("Supply a complete Express body without chat tags or surrounding prose");
    }
  }
  const [message] = messages;
  if (messages.length !== 1 || !message || !("createSurface" in message))
    throw new Error("Supply one complete layout with a root component");
  if (
    message.createSurface.surfaceId !== surfaceId ||
    message.createSurface.catalogId !== catalogId
  )
    throw new Error("Use the requested surface_id and the AbraCode work catalog");
  return validateSurface(message);
}
