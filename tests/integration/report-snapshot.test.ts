import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { validateDocumentHTML } from "../../src/workflow/report-export.ts";
import { reportDocument } from "../helpers/report-document.ts";
import { canonicalJSON } from "../../src/presentation/identity.ts";
import { reportHash } from "../../src/workflow/report-build.ts";

test("portable document validation refuses changed JSON, missing attribution and external assets", () => {
  const document = reportDocument(),
    json = canonicalJSON(document);
  const html = `<!doctype html><script id="abracode-license-notices" type="application/json">{}</script><script id="abracode-report-document" type="application/json" data-hash="${reportHash(json)}">${json.replaceAll("<", "\\u003c")}</script>`;
  validateDocumentHTML(html, document);
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
