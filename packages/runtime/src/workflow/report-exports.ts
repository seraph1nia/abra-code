import { writeReportStaging, linkReportStaging } from "./report-files.ts";
import { ReportExportSchema } from "../presentation/report-export-contract.ts";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Effect } from "effect";
import { CrewError, ensure } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { AbsolutePath, ContentHash, LockKey } from "../identities.ts";
import type { Locks } from "../storage/lock.ts";
import { lstat, realpath, readFile, pathExists, rm } from "../filesystem.ts";
import { decode } from "../decode.ts";
import { canonicalJSON } from "../presentation/identity.ts";
import { readReportDocument } from "../presentation/report-document.ts";
import { reportDirectory, reportHash, maximumHTMLBytes } from "./report-build.ts";
import { validateDocumentHTML, type DocumentRenderer } from "./report-export.ts";

/** Derived exports have no workflow authority. Canonical JSON stays untouched. */
export class ReportExports {
  constructor(
    private home: AbsolutePath,
    private locks: Locks,
    private renderer: DocumentRenderer,
  ) {}
  private directory(document: ContentHash, exporter: ContentHash) {
    return reportDirectory(this.home, [".abracode", "reports", "exports", document, exporter]);
  }
  private verified(directory: string, document: ContentHash, exporter: ContentHash) {
    return domainEffect(
      Effect.gen(function* () {
        for (const name of ["receipt.json", "index.html"]) {
          const path = join(directory, name),
            stat = yield* lstat(path);
          ensure(
            stat.isFile() &&
              !stat.isSymbolicLink() &&
              (yield* realpath(path)) === path &&
              stat.size <= maximumHTMLBytes,
            "REPORT_PATH",
            "Export must remain a bounded owned regular file",
          );
        }
        const receipt = yield* decode(
          ReportExportSchema,
          JSON.parse(yield* readFile(join(directory, "receipt.json"), "utf8")),
          "HTML export receipt",
        );
        ensure(
          receipt.document_hash === document && receipt.exporter_hash === exporter,
          "REPORT_IDENTITY",
          "Export receipt identity changed",
        );
        const html = yield* readFile(join(directory, "index.html"), "utf8");
        ensure(
          reportHash(html) === receipt.hash && Buffer.byteLength(html) === receipt.bytes,
          "REPORT_TAMPERED",
          "HTML export no longer matches its retained digest",
        );
        return { ...receipt, html };
      }),
    );
  }
  read(document: ContentHash, exporter: ContentHash) {
    return this.directory(document, exporter).pipe(
      Effect.flatMap((directory) => this.verified(directory, document, exporter)),
    );
  }
  create(json: string, hash: ContentHash) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        ensure(reportHash(json) === hash, "REPORT_TAMPERED", "Canonical JSON digest changed");
        const parsed = yield* Effect.try({
          try: () => readReportDocument(json),
          catch: CrewError.from,
        });
        ensure(
          parsed.supported,
          "REPORT_FORMAT",
          "This document version cannot be exported by the installed renderer",
        );
        const exporter = yield* this.renderer.fingerprint;
        return yield* this.locks.with(
          LockKey.make(`report-export-${reportHash(hash + exporter)}`),
          () =>
            domainEffect(
              Effect.gen({ self: this }, function* () {
                const directory = yield* this.directory(hash, exporter);
                if (yield* pathExists(join(directory, "receipt.json")))
                  return yield* this.verified(directory, hash, exporter);
                const destination = join(directory, "index.html");
                if (yield* pathExists(destination)) {
                  const stat = yield* lstat(destination);
                  ensure(
                    stat.isFile() &&
                      !stat.isSymbolicLink() &&
                      stat.size <= maximumHTMLBytes &&
                      (yield* realpath(destination)) === destination,
                    "REPORT_PATH",
                    "Occupied export destination must be an owned regular file",
                  );
                }
                // A crash after HTML publication can be repaired from the exact retained JSON.
                const html = (yield* pathExists(destination))
                  ? yield* readFile(destination, "utf8")
                  : yield* this.renderer.render(parsed.document, exporter);
                yield* Effect.try({
                  try: () => validateDocumentHTML(html, parsed.document),
                  catch: CrewError.from,
                });
                const receipt = {
                  document_hash: hash,
                  exporter_hash: exporter,
                  hash: reportHash(html),
                  bytes: Buffer.byteLength(html),
                };
                const publish = (name: string, text: string) =>
                  domainEffect(
                    Effect.gen(function* () {
                      const stage = join(directory, `.stage-${randomUUID()}`);
                      yield* writeReportStaging(stage, text);
                      yield* linkReportStaging(stage, join(directory, name));
                      const stat = yield* lstat(stage);
                      if (
                        stat.isFile() &&
                        !stat.isSymbolicLink() &&
                        (yield* realpath(stage)) === stage &&
                        reportHash(yield* readFile(stage, "utf8")) === reportHash(text)
                      )
                        yield* rm(stage);
                    }),
                  );
                if (!(yield* pathExists(destination))) yield* publish("index.html", html);
                const stat = yield* lstat(destination);
                ensure(
                  stat.isFile() &&
                    !stat.isSymbolicLink() &&
                    (yield* realpath(destination)) === destination &&
                    reportHash(yield* readFile(destination, "utf8")) === receipt.hash,
                  "REPORT_TAMPERED",
                  "Occupied export destination was preserved",
                );
                yield* publish("receipt.json", canonicalJSON(receipt));
                return yield* this.verified(directory, hash, exporter);
              }),
            ),
          { waitSeconds: 60 },
        );
      }),
    );
  }
}
