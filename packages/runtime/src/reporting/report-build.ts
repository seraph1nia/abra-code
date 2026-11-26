import { sha256 } from "../digest.ts";
import { maximumPortableHTMLBytes } from "@abracode/contracts/presentation/report-export-contract";
import { Effect } from "effect";
import { join, resolve, relative } from "node:path";
import { AbsolutePath, ContentHash } from "@abracode/contracts/identities";
import { CrewError, ensure } from "../domain.ts";
import { lstat, mkdir, realpath } from "../filesystem.ts";

export const reportHash = (text: string) => ContentHash.make(sha256(text));
export const maximumHTMLBytes = maximumPortableHTMLBytes;

/** Create one checked path segment at a time; never mkdir through a symlink. */
export const reportDirectory = (home: AbsolutePath, segments: readonly string[]) =>
  Effect.gen(function* () {
    const canonical = yield* realpath(home);
    let path: AbsolutePath = home;
    for (const segment of segments) {
      if (!/^[a-zA-Z0-9._-]+$/.test(segment) || [".", ".."].includes(segment))
        return yield* new CrewError("REPORT_PATH", "Invalid owned report path segment");
      path = AbsolutePath.make(join(path, segment));
      yield* mkdir(path, { mode: 0o700 }).pipe(
        Effect.catchIf(
          (error) => error.code === "EEXIST",
          () => Effect.void,
        ),
      );
      const stat = yield* lstat(path);
      if (
        stat.type !== "Directory" ||
        (yield* realpath(path)) !== resolve(canonical, relative(home, path))
      )
        return yield* new CrewError(
          "REPORT_PATH",
          "Report storage must use owned real directories",
        );
    }
    return yield* realpath(path);
  });

/** Validation is independent of publication. Assets are inline; untrusted JSON
 * stays inert and must round-trip to the exact captured snapshot. */
export function validatePortableHTML(html: string) {
  ensure(
    Buffer.byteLength(html) <= maximumHTMLBytes && /<!doctype html>/i.test(html),
    "REPORT_HTML",
    "Invalid or oversized HTML artifact",
  );
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  ensure(
    html.includes("abracode-license-notices"),
    "REPORT_HTML",
    "Required license notices are absent",
  );
  ensure(
    !scripts.some((m) => /\bsrc\s*=/i.test(m[1]!)),
    "REPORT_HTML",
    "Report scripts must be inline",
  );
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  const resources = [
    ...markup.matchAll(
      /<(?:img|iframe|source|video|audio|image|use|feImage|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']*)["']/gi,
    ),
  ];
  ensure(
    resources.every((m) => m[1]!.startsWith("data:") || m[1]!.startsWith("#")),
    "REPORT_HTML",
    "Report assets must be self-contained",
  );
  for (const style of markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    ensure(
      !/@import\b/i.test(style[1]!) &&
        [...style[1]!.matchAll(/url\(\s*["']?([^)'"\s]+)/gi)].every(
          (m) => m[1]!.startsWith("data:") || m[1]!.startsWith("#"),
        ),
      "REPORT_HTML",
      "Report styles cannot require external assets",
    );
  }
}

export function embeddedReportJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new CrewError("REPORT_HTML", "Embedded report data is invalid JSON");
  }
}
