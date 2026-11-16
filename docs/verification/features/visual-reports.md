# Controller-owned portable visual reports

Prepare the [disposable native environment](../README.md), including a compatible
Chromium. Focused commands:

```sh
REPORT_CHROMIUM_PATH=/path/to/compatible/chrome \
  pnpm exec vp test run --project unit packages/runtime/tests/unit/report-artifacts.test.ts
REPORT_CHROMIUM_PATH=/path/to/compatible/chrome \
  pnpm test:one packages/runtime/tests/extended/report-artifacts.test.ts
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
concurrently using one prepared application shell and one bounded service diagram owner with immutable document/output identities. The input documents
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

### Mermaid preparation budgets

Focused preparation coverage lives in `integration/reporter.test.ts`, `diagram-preparation.test.ts` and `mermaid-tool.test.ts`. It exercises seven diagram families, render-after-parse failures, resource refusal, identified mixed results, real shared compilation, warm reuse and bounded queue/deadline cancellation. A service owner has two active and eight queued batches, a 60-second end-to-end deadline and a 128-entry/32 MiB derived cache. Canceling a viewer detaches that waiter; shared compilation remains bounded and available to other callers. Losing derived cache data permits preparation from exact retained sources and never recaptures report work.

### Diagram-heavy native and offline journey

Run the real registered verifier and browser save/export/restart path with retained evidence:

```sh
ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-mermaid-evidence pnpm test:one packages/runtime/tests/e2e/native-workspace.test.ts
ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-mermaid-evidence pnpm test:one packages/runtime/tests/extended/react-report-export.test.ts packages/runtime/tests/extended/report-artifacts.test.ts
```

The native workspace journey prepares 32 mixed diagrams, verifies an identical warm batch without compilation, checks a 100-node flowchart and 50-message sequence, displays all 32 diagrams, saves frozen bindings and reopens after restart/retirement. `native-transport.json` retains the actual compiler identity, Node/pnpm versions, elapsed command time, compiler launches/hits and sampled fixture-process-tree RSS (50 ms interval, baseline and peak). Times include the deterministic native command/browser round trip; RSS includes the fixture server/viewer and descendants, not just the compiler. Cold/warm observations are separate. The queue/deduplication and over-budget matrix lives in the focused preparation tests rather than duplicating all concurrency cases through the provider.

The portable fixture exports 31 inline diagrams plus captured diagram evidence, checks unique SVG IDs, source disclosure, keyboard expansion/zoom/reset/focus restoration and both 375/390 px themes in an offline opaque frame. Its JSON evidence records bytes, exporter identity, requests/errors and screenshots. The browser build writes `diagram-boundary.json` after inspecting module IDs, refusing the new report/catalog compiler and preparation tooling. Existing Streamdown chat Markdown rendering is preserved by explicit user decision.

The combined verification pool is capped at four workers. During this change, eight-worker runs reproduced Git fixture timeouts and a native inspector stuck loading while its exact approval form remained active. The identical suite passed all 694 tests with four workers; changing the default cap preserves every scenario and the original approval journey. Expected-output and authorization assertions were retained.

### Retained acceptance run: 2026-11-16

Final evidence is retained at `/tmp/abra-mermaid-evidence-final/verification.json`, with copied command logs, a changed-source manifest, native transport measurements and screenshots outside the removed fixtures. The current compiler digest matches the native measurement (`360e940350137d6857b417cec7a106bfc4c1b840d78c644bd857a17122b9b00f`).

`pnpm check` passed with zero Effect diagnostics across 394 files. The original `pnpm test:all` command passed all 694 tests in 119 files (176.61 seconds); both extended portable tests, both explicit `.mmd` fixtures and license evidence checks passed. A separate SDK boundary probe accepted 262,144 source bytes in a 262,883-byte surface. The 32-diagram native cold command took 7.18 seconds under the complete suite, with one compiler launch/32 compilations; the warm command took 0.62 seconds with zero launches/compilations. Concurrent warm reads also compiled nothing. The relocated opaque-frame export was 1,948,210 bytes with no requests or page errors at 375/390 px, including a dense 100-node diagram, repeated sources and keyboard expansion/focus restoration. Timings describe this fixture/toolchain, not a general latency guarantee.
