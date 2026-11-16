# Controller-owned portable visual reports

Prepare the [disposable native environment](../README.md), including a compatible
Chromium. Focused commands:

```sh
REPORT_CHROMIUM_PATH=/path/to/compatible/chrome \
  pnpm exec vp test run --project unit packages/runtime/tests/unit/report-artifacts.test.ts
REPORT_CHROMIUM_PATH=/path/to/compatible/chrome \
  pnpm exec vp test run --project integration packages/runtime/tests/extended/report-artifacts.test.ts
REPORT_CHROMIUM_PATH=/path/to/compatible/chrome \
ABRACODE_TEST_JOURNEY=reports \
ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-reports \
  pnpm test:one packages/runtime/tests/extended/native.test.ts
```

The JSON/document unit tests exercise bounded versioned envelopes, exact surface saves,
immutable captured bindings, stale saves, lost validation/publication/association
responses, concurrent requests, occupied paths, symlinks and unsupported versions.
Legacy artifact fixtures prove original retries, staged publication, integrity
and explicit unavailable unfinished builds without invoking a retired compiler.
Export fixtures prove digest/exporter-keyed reuse, receipt repair and failure
preservation. Diagnostic tool tests keep read authority separate from generation.

`packages/runtime/tests/extended/report-artifacts.test.ts` builds two real React exports
concurrently using isolated source/config/cache/output roots. The input documents
are saved JSON, including literal hostile text and captured diagrams. The shared
catalog renders in an opaque iframe without repository code execution.
`react-report-export.test.ts` relocates the real single-file output, blocks all
network access, withholds same-origin privileges and checks 375/390px, filtering,
disclosures, pending checks, prepared SVG, local Markdown/JSON feedback and clean
explicit preview shutdown. `reporter.test.ts` checks multiple Mermaid types,
syntax/rendering failures and explicit missing-file diagnostics. Manual Solid
authoring/dev-server tests are retired with that workflow.

`packages/runtime/tests/e2e/reports.ts` uses actual native Research tool execution to request JSON,
keeps read-only permissions and accepted Markdown receipts, creates new saved
revisions after worktree retirement, restarts, retries the exact request, then
explicitly exports through authenticated native RPC. Canonical JSON and portable
HTML digests are verified independently. `workspace.ts` exercises the browser
save/export/preview/download path without provider calls, native restart, frozen
pending checks and task completion. Set external evidence output to preserve the
fixture's JSON/HTML after cleanup; these are sample claims, not production proof.

Current focused evidence for the report migration is retained under
`/tmp/abra-frontend-coherence-20261115/`: `report-retirement-native.log` and
`report-retirement-native/native-engineering.json` passed on 2026-11-16;
`report-retirement-focused-integration.log` records the shared renderer/helpers;
`export-native.log` covers the explicit browser export and no-provider assertion.
Full integrated checks remain a separate required gate.

The pinned graphical file renderer's source and opaque sandbox contract are
recorded in [supported APIs](../../supported-apis.md#report-html-preview).
No paired graphical GUI click-through is claimed by these service/browser tests.

Binding coverage acceptance uses the shipped app and portable renderer:

```sh
pnpm web:build
pnpm test:one packages/runtime/tests/e2e/web-rendering.test.ts
pnpm test:one packages/runtime/tests/e2e/web-coherence.test.ts -t 'exact saved reports'
pnpm test:one packages/runtime/tests/extended/react-report-export.test.ts packages/runtime/tests/extended/report-artifacts.test.ts
```

The app and offline fixtures share frozen rows and coverage: an unfiltered live
capture reports 1 of 102 rows and partial counts, while an older snapshot states
unknown coverage. Source changes never supplement either binding. The renderer
journey relocates HTML into an offline opaque frame and asserts no HTTP requests;
the app fixture asserts zero binding-summary reads during frozen viewing. New save
unit coverage resolves off-page live references independently, refuses missing
explicit values and retries already-published JSON after source loss. Set external
`ABRACODE_TEST_EVIDENCE_DIR` to retain browser screenshots alongside command logs.
