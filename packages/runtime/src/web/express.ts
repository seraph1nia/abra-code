import { ExpressParser } from "@a2ui/agent";
import { catalog, catalogId } from "@abracode/contracts/web/catalog";
import { maxSurfaceBytes, validateSurface } from "@abracode/contracts/web/surfaces";

/**
 * Checks whether `<a2ui>` or `</a2ui>` sentinel tags occur outside Express string literals
 * or block comments (line comments end at `</a2ui>` per the Express compiler).
 */
function hasTopLevelSentinelTag(source: string): boolean {
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i]!;
    if (
      ch === '"' ||
      ((ch === "r" || ch === "R") &&
        source[i + 1] === '"' &&
        (i === 0 || !/[a-zA-Z0-9_]/.test(source[i - 1]!)))
    ) {
      const raw = ch !== '"';
      const q = raw ? i + 1 : i;
      const triple = source.startsWith('"""', q);
      i = q + (triple ? 3 : 1);
      while (i < n) {
        if (!raw && source[i] === "\\") {
          i += 2;
          continue;
        }
        if (triple ? source.startsWith('"""', i) : source[i] === '"') {
          i += triple ? 3 : 1;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (
      ch === "#" ||
      (ch === "/" && source[i + 1] === "/") ||
      (ch === "-" && source[i + 1] === "-")
    ) {
      const nl = source.indexOf("\n", i);
      const end = nl < 0 ? n : nl;
      if (/<\/a2ui\s*>/i.test(source.slice(i, end))) return true;
      i = end + 1;
      continue;
    }
    if (ch === "<" && /^<\/?a2ui(?:\s[^>]*)?>/i.test(source.slice(i))) return true;
    i++;
  }
  return false;
}

let cachedParser: ExpressParser | undefined;
export function compileWorkView(surfaceId: string, source: string) {
  if (Buffer.byteLength(source, "utf8") > maxSurfaceBytes)
    throw new Error("Shorten the Express source to fit the 384 KiB limit");
  const parser =
    cachedParser?.surfaceId === surfaceId
      ? cachedParser
      : (cachedParser = new ExpressParser(catalog, surfaceId, "v1.0"));
  // The tool expects a bare Express body without chat <a2ui> wrappers or surrounding prose.
  // Use ExpressParser's native unwrap/hasFormatContent check before compiling, while still
  // allowing literal "<a2ui>" text inside quoted Express strings.
  if (parser.hasFormatContent(source) && hasTopLevelSentinelTag(source)) {
    throw new Error("Supply a complete Express body without chat tags or surrounding prose");
  }
  const messages = parser.compile(source, true);
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
