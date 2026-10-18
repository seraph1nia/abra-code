import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { validateSnapshot, snapshotJSON } from "../../templates/reporter/src/snapshot-data.ts";
const snapshot = {
  schema_version: 1,
  issue_id: "fixture-issue",
  execution_id: "fixture-execution",
  title: "Read-only evidence",
  summary: "A disposable snapshot fixture",
  observed_at: "2026-10-18T00:00:00.000Z",
  provenance: "Test fixture only",
  status: "unknown",
  findings: [],
  checks: [],
  events: [],
  excerpts: [],
  limitations: ["No controller receipts supplied"],
};

test("report snapshots require observation/provenance, bounded data and explicit check evidence", () => {
  assert.deepEqual(validateSnapshot(snapshot), snapshot);
  for (const fields of [
    { schema_version: 2 },
    { observed_at: "2026-02-30T00:00:00.000Z" },
    { observed_at: "" },
    { provenance: "" },
    { observed_at: undefined },
    { checks: [{ name: "Unproved check", status: "passed" }] },
    { checks: [{ name: "Failed check", status: "failed", evidence: "" }] },
    {
      findings: Array.from({ length: 65 }, () => ({
        title: "Finding",
        category: "Evidence",
        summary: "",
        evidence: "",
        references: [],
      })),
    },
    {
      excerpts: [
        { title: "Too large", kind: "code", text: "é".repeat(32769), provenance: "Fixture" },
      ],
    },
    {
      findings: Array.from({ length: 64 }, () => ({
        title: "Finding",
        category: "Evidence",
        summary: "x".repeat(16384),
        evidence: "",
        references: [],
      })),
    },
    { html: "<script>untrusted</script>" },
  ])
    assert.throws(() => validateSnapshot({ ...snapshot, ...fields }));
  assert.equal(
    validateSnapshot({ ...snapshot, checks: [{ name: "Not run", status: "not_run" }] }).checks[0]
      .evidence,
    undefined,
  );
});

test("snapshot sources reject unsafe URLs and malformed identities", () => {
  for (const reference of [
    { url: "javascript:alert(1)" },
    { url: "data:text/html,<script>" },
    { url: "file:///etc/passwd" },
    { url: "https://user:secret@example.invalid" },
    { url: "https://" },
    { commit: "unknown" },
    { line: 1 },
    { path: "source.ts", line: 0 },
    {},
  ])
    assert.throws(() =>
      validateSnapshot({
        ...snapshot,
        findings: [
          {
            title: "Source",
            category: "Evidence",
            summary: "",
            evidence: "",
            references: [reference],
          },
        ],
      }),
    );
  assert.equal(
    validateSnapshot({
      ...snapshot,
      findings: [
        {
          title: "Source",
          category: "Evidence",
          summary: "",
          evidence: "",
          references: [
            {
              path: "source.ts",
              line: 1,
              commit: "1".repeat(40),
              url: "https://example.invalid/evidence",
            },
          ],
        },
      ],
    }).findings.length,
    1,
  );
});

test("snapshot JSON escapes script delimiters without changing repository text", () => {
  const hostile = "</script><script>globalThis.snapshotExecuted=true</script><!--\u2028\u2029";
  const input = {
    ...snapshot,
    title: hostile,
    excerpts: [
      {
        title: "Untrusted code",
        kind: "diff",
        text: hostile,
        provenance: "Untrusted repository text",
      },
    ],
  };
  const json = snapshotJSON(input);
  assert.doesNotMatch(json, /<script|<\/script|<!--|[\u2028\u2029]/);
  assert.deepEqual(JSON.parse(json), validateSnapshot(input));
});

test("generated Mermaid data refuses executable directives, HTML, links and external resources", () => {
  for (const source of [
    "%%{init: {securityLevel: 'loose'}}%%\nflowchart LR\nA --> B",
    "flowchart LR\nA[<img src=x>]",
    "flowchart LR\nclick A href 'https://example.invalid'",
    "flowchart LR\nA[https://example.invalid]",
    "flowchart LR\nA[style url(attack)]",
  ])
    assert.throws(
      () => validateSnapshot({ ...snapshot, diagrams: [{ title: "Unsafe diagram", source }] }),
      /directives|HTML|links|external/,
    );
  assert.equal(
    validateSnapshot({
      ...snapshot,
      diagrams: [
        {
          title: "Safe diagram",
          source:
            "sequenceDiagram\nAbra->>Worker: inspect retained evidence\nWorker-->>Abra: finding",
        },
      ],
    }).diagrams!.length,
    1,
  );
});
