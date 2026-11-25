import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { embedReportPayload, validateDocumentHTML } from "../../src/reporting/report-export.ts";
import { reportDocument } from "../helpers/report-document.ts";
import { canonicalJSON } from "../../src/presentation/identity.ts";
import { captureReportSnapshot } from "../../src/reporting/report-snapshot.ts";
import { fixture, planned } from "../fixtures.ts";
import { run } from "../effects.ts";
import { reportHash } from "../../src/reporting/report-build.ts";

test("portable document validation refuses changed JSON, missing attribution and external assets", () => {
  const document = reportDocument(),
    json = canonicalJSON(document);
  const shell =
    '<!doctype html><html><body><script>const marker = "</body>";</script><div id="abracode-license-notices"></div></body></html>';
  const html = embedReportPayload(shell, json, "[]");
  assert.ok(html.includes('<script>const marker = "</body>";</script>'));
  validateDocumentHTML(html, document);
  assert.throws(
    () => validateDocumentHTML(html.replace(">[]</script>", ">[1]</script>"), document),
    /digest/,
  );
  assert.throws(
    () =>
      validateDocumentHTML(html.replace("abracode-license-notices", "missing-notices"), document),
    /notices/,
  );
  assert.throws(
    () =>
      validateDocumentHTML(
        html + '<script src="https://example.invalid/runtime.js"></script>',
        document,
      ),
    /inline/,
  );
  assert.throws(
    () => validateDocumentHTML(html + '<img src="https://example.invalid/image.png">', document),
    /self-contained/,
  );
  assert.throws(
    () => validateDocumentHTML(html.replace("Saved evidence", "Changed evidence"), document),
    /exact canonical/,
  );
  assert.throws(
    () => validateDocumentHTML(html.replace(reportHash(json), "a".repeat(64)), document),
    /digest/,
  );
});

test("snapshot truncation preserves a complete UTF-8 prefix", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const e = await run(planned(f));
  const prefix = "a".repeat(11899);
  const snapshot = await run(captureReportSnapshot(f.work, e, undefined, prefix + "🌿".repeat(40)));
  assert.equal(snapshot.title, prefix + "… [truncated in snapshot]");
});
