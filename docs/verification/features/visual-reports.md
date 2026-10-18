# Controller-owned portable visual reports

Prepare the [disposable native environment](../README.md), including a compatible
Chromium. Focused commands:

```sh
REPORT_CHROMIUM_PATH=/path/to/compatible/chrome \
  pnpm exec vp test run --project unit tests/unit/report-artifacts.test.ts
REPORT_CHROMIUM_PATH=/path/to/compatible/chrome \
  pnpm exec vp test run --project integration tests/integration/report-artifacts.test.ts
REPORT_CHROMIUM_PATH=/path/to/compatible/chrome \
ABRACODE_TEST_JOURNEY=reports \
ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-reports \
  pnpm exec vp test run --project e2e tests/e2e/native.test.ts
```

The unit tests exercise immutable inputs/digests, stale saves, native notice
response loss, a lost validated/publication receipt, occupied revisions,
symlinks, interrupted source authority, logical/compiler capacity, restart
reservations and same-request recovery. Diagnostic tool tests distinguish report
reads from generation authority. Snapshot tests reject malformed data, unsafe
links, executable Mermaid directives and external resources.

The integration test runs two real Vite builds concurrently, with separate
source/config/cache/output workspaces and unchanged trusted inputs. It moves the
result, opens it offline at 375 pixels, and uses a Blob iframe with the pinned
client's exact sandbox flags. Diagrams, inert hostile text, keyboard disclosures,
local filtering, notice assets and local feedback work with parent access denied
and no asset/network requests. Manual authoring, multiple diagram types and
invalid-diagram failures retain the existing reporter integration coverage.

`tests/e2e/reports.ts` uses actual native Research tool execution to request HTML,
checks preserved read-only permissions, renders completed research after worktree
retirement, interrupts a build with a service restart, then requires automatic
reconciliation of the same captured request/digest. No new worker is launched or
workflow reopened. Parent notifications retain a native file link. The focused
proof at `/tmp/abra-reports-native2-20261018/native-engineering.json` passed in
67.73 seconds on 2026-10-18 with cleanup complete. Subsequent full-suite results
supersede this focused evidence as structured findings/diagram assertions expand.

The pinned 2.0.28 graphical renderer sources were fetched and re-inspected on
2026-10-18: file links force-read into the existing side panel or supported desktop
browser pane; HTML uses an opaque Blob iframe without same-origin access. See
[supported APIs](../../supported-apis.md#report-html-preview). **No paired native
graphical client is available**, so actual GUI chat click-through remains not-run.
The native service, compiler and sandbox/browser assertions are executed proofs;
they are not a claim that a graphical-client interaction was performed.

Native evidence output copies a portable fixture HTML outside the disposable
installation when `ABRACODE_TEST_EVIDENCE_DIR` is set. JSON records its path and
hash after fixture cleanup. These reports describe sample fixture evidence, not
production architecture or real database performance.
