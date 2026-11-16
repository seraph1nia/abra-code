import { parsePatchFiles } from "@pierre/diffs";

/** Accept both Git patches and the jsdiff patches used for bounded untracked files. */
export function parseDiffPatch(patch: string) {
  const files = parsePatchFiles(patch, { throwOnError: true }).flatMap((parsed) => parsed.files);
  if (!files.length) throw new Error("This patch could not be rendered.");
  return files;
}
