import { ReportFile } from "./report-files.ts";
import { ReportExportSchema } from "../presentation/report-export-contract.ts";
import { Effect } from "effect";
import { CrewError, ensure } from "../domain.ts";
import { domainEffect } from "../effect.ts";
import { AbsolutePath, ContentHash, LockKey } from "../identities.ts";
import type { Locks } from "../storage/lock.ts";
import { decodeJSON } from "../decode.ts";
import { canonicalJSON } from "../presentation/identity.ts";
import { readReportDocument } from "../presentation/report-document.ts";
import { reportHash, maximumHTMLBytes } from "./report-build.ts";
import { validateDocumentHTML, type DocumentRenderer } from "./report-export.ts";

/** Derived exports have no workflow authority. Canonical JSON stays untouched. */
export class ReportExports {
  constructor(
    private home: AbsolutePath,
    private locks: Locks,
    private renderer: DocumentRenderer,
  ) {}
  private file(document: ContentHash, exporter: ContentHash, name: string) {
    return new ReportFile(
      this.home,
      [".abracode", "reports", "exports", document, exporter],
      name,
      maximumHTMLBytes,
    );
  }
  private verified(document: ContentHash, exporter: ContentHash) {
    return domainEffect(
      Effect.gen({ self: this }, function* () {
        const raw = yield* this.file(document, exporter, "receipt.json").read();
        const receipt = yield* decodeJSON(ReportExportSchema, raw.text, "HTML export receipt");
        ensure(
          receipt.document_hash === document && receipt.exporter_hash === exporter,
          "REPORT_IDENTITY",
          "Export receipt identity changed",
        );
        const html = yield* this.file(document, exporter, "index.html").read(receipt);
        return { ...receipt, html: html.text };
      }),
    );
  }
  read(document: ContentHash, exporter: ContentHash) {
    return this.verified(document, exporter);
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
        const bundle = yield* this.renderer.acquire;
        const exporter = bundle.fingerprint;
        return yield* this.locks.with(
          LockKey.make(`report-export-${reportHash(hash + exporter)}`),
          () =>
            domainEffect(
              Effect.gen({ self: this }, function* () {
                if (yield* this.file(hash, exporter, "receipt.json").existing())
                  return yield* this.verified(hash, exporter);
                const output = this.file(hash, exporter, "index.html");
                // Reuse validated HTML after a crash before its receipt; no rerender or recapture.
                const existing = yield* output.existing();
                const html = existing ? existing.text : yield* bundle.render(parsed.document);
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
                yield* output.publish({ text: html, identity: receipt });
                const text = canonicalJSON(receipt);
                yield* this.file(hash, exporter, "receipt.json").publish({
                  text,
                  identity: { hash: reportHash(text), bytes: Buffer.byteLength(text) },
                });
                return yield* this.verified(hash, exporter);
              }),
            ),
          { waitSeconds: 60 },
        );
      }),
    );
  }
}
