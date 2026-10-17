import { RelativePath } from "../identities.ts";
import { Schema } from "effect";
const controls = new Set([".git", ".opencode", ".agents", ".abracode", "openspec", "AGENTS.md"]);
export const GeneratedPathSchema = RelativePath.check(
  Schema.makeFilter((path) => {
    const parts = path.split("/");
    return (
      (path.length > 0 &&
        !Array.from(path).some(
          (char) =>
            char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || "\\*?[]{}".includes(char),
        ) &&
        parts.every(
          (part) => part !== "" && part !== "." && part !== ".." && !controls.has(part),
        )) ||
      "Expected an exact relative generated directory outside repository control paths"
    );
  }),
);
export const GeneratedPathsSchema = Schema.mutable(Schema.Array(GeneratedPathSchema)).check(
  Schema.makeFilter(
    (paths) =>
      paths.every((path, i) =>
        paths.every((other, j) => i === j || (path !== other && !path.startsWith(`${other}/`))),
      ) || "Generated directories must not overlap",
  ),
);
