# Saved reports and portable exports

The shared presentation package owns catalog geometry, metadata/evidence styles,
semantic light/dark tokens and reduced-motion behavior. Portable reports import
those same styles directly; work cards retain full-width titles even when app
navigation is replaced with frozen text. Verified SVG canvases stay deliberately
light, with themed frames and controls, without rewriting captured source.

Legacy retained HTML and explicit HTML export previews use the shared
`report-preview` reading area: full container width, explicit viewport-relative
height and no flex shrinking inside the inspector. Scrolling stays local and
expanded viewing follows the report canvas. Frames retain `sandbox="allow-scripts"`
without same-origin privileges or parent-document measurement. The small legacy
HTML in the HTTP/browser fixture proves host sizing/isolation rather than the
layout of an arbitrary historical report; relocated export acceptance exercises
the actual offline renderer separately.

A report is an immutable JSON document rendered by the same React/A2UI catalog used in the workspace. Open a generated view and choose **Save snapshot**. The selected task must have a retained execution. Saving uses the observed surface revision, captures its live and snapshot inputs separately, and makes no provider call. If the response is uncertain, use **Retry same save**; **Save another snapshot** creates a new identity and revision.

The portable application imports `@abracode/presentation/report-document`, its
shared primitives, styles and tokens through declared workspace exports.
`@abracode/contracts` owns the saved-document decoder and catalog. Neither the
portable entry nor the shared renderer imports the live web application.
Source installations include `packages/` and install all linked workspaces from
the frozen lockfile before building or exporting. Supplier notices follow those
workspace dependency links, including dependencies shared by native, web and
portable consumers.

Authorized `abra_work_report` generation composes captured report evidence into that catalog. New requests default to JSON; the optional `format: "a2ui-snapshot"` tag remains accepted. Accepted research Markdown and its controller gates remain independent. Reading or exporting a report cannot approve work or satisfy research acceptance.

Open a report from its conversation attachment or task Reports section. Chat preview, inspector and expanded canvas read the same exact request/hash. Bodies load only when opened. Findings, excerpts, chronological observations, limitations and pending/not-run checks come from saved values; the viewer never fills gaps from current work. App resource links explicitly inspect current resources. Malformed or unsupported documents retain their original JSON download and an individual diagnostic.

## Format and storage

`a2ui-snapshot` format version 1 retains the document/request ID, revision, capture time, issue/execution/control generation, catalog version, renderer compatibility, exact source surface and proven native message/call provenance. Catalog-v2 surfaces are bounded to 384 KiB (retained v1 surfaces to 64 KiB), evidence to 512 KiB and the complete UTF-8 document to 1 MiB. The catalog rejects callbacks, arbitrary links, approval components, cyclic/excessive layouts and unknown references.

The existing report owner reserves captured input, writes and syncs an exclusive private stage, retains a digest/byte receipt, and atomically links `.abracode/reports/generated/<issue>/<request>/index.json`. It never overwrites occupied output. Reads verify the retained identity, containment, real regular file, byte count and SHA-256. Same-ID retries reconcile bytes without recapture. These files and receipts survive worktree retirement; deleting them makes that revision unavailable. Preserve installation state and report files together when backing up.

Older applications do not understand the new receipt union or catalog: downgrading an installation with new reports is unsupported. Keep the original state backup when changing versions. Future format/catalog/renderer versions remain downloadable but cannot be rendered or exported by an incompatible reader.

## Optional offline HTML

Choose **Export offline HTML** in an opened report. The explicit export uses only its saved JSON, compatible installed React/catalog components, shared design tokens, prepared SVG diagrams and supplier notices. The file has local filtering/disclosures and Markdown/JSON feedback controls; feedback is review input only. App navigation is unavailable offline. External images, fonts, scripts and framework/diagram downloads are unsupported. Mermaid runs during preparation and is absent from the exported runtime.

Exports are cached by document hash and exporter identity. The
`abracode-portable-renderer-v3` identity covers the prepared shell bytes, actual
compiler modules, explicit stylesheet scan inputs, resolved package/tool links,
Mermaid preparation sources and installed rendering dependency closure, shared
asset-format ABI and embedded notices. Backend-only changes and unrelated lockfile
changes do not change that identity. Verified receipt/hash/byte checks protect preview and attachment download. Identical exports reuse existing bytes; an interrupted receipt can reconcile already published HTML. A changed exporter creates a separate destination under `.abracode/reports/exports/<document-hash>/<exporter-hash>/`. Export failures leave canonical JSON usable. The HTML cap is 8 MiB; verification evidence records actual bytes for each exercised fixture rather than guaranteeing one report size.

Contributors can export an explicitly downloaded JSON document and run an independent foreground preview:

```sh
pnpm report:browser:install
pnpm report:prepare
pnpm report:export /absolute/saved.json /absolute/new-export.html
pnpm report:preview /absolute/new-export.html 4174
pnpm report:validate /absolute/diagram.mmd
```

The export command refuses to overwrite its output. Preview binds loopback only, opens no browser or native connection, serves only that file with an opaque sandbox/CSP, and ends on Ctrl+C. No detached preview starts automatically. Copy the HTML elsewhere and open it directly without sibling files or networking. A supported native graphical file viewer can also open an absolute-path Markdown link; clients without that viewer can use a browser. The Solid template/manual-authoring workflow is retired.

## Legacy compatibility

Published untagged version-1 HTML receipts retain their original request, file and integrity checks. Retrying an original request returns that artifact, even after the default changes. Validated legacy staging or an interrupted publication can reconcile its original bytes. Pending/unfinished legacy builds without verified output retain captured input, hashes, errors and staging evidence but become explicitly unavailable because their compiler is retired. Create a new request to capture JSON; upgrades never convert or overwrite an old artifact. Accepted research Markdown remains readable under its original receipt.

See [frontend contracts](frontend.md), [API evidence](supported-apis.md#report-html-preview) and [verification](verification/README.md) for ownership, transport isolation and executable proof.

## Reusable renderer preparation

`pnpm build` prepares the exporter after the plugin and web builds. On a source installation, use `pnpm report:prepare` directly. Both commands inspect the renderer inputs and resolved dependencies, build the React shell and diagram worker when needed, verify their bytes and atomically select the complete bundle. An interrupted preparation leaves the prior selection available.

CLI and workspace exports load the selected bundle into memory before rendering. Source edits take effect after the next successful preparation. Each export verifies the prepared HTML (including styles and notices), diagram host, browser engine and integrity metadata. Mermaid documents use the runtime’s Playwright driver and require a compatible Chromium installation. Export reads no renderer source files and runs no application compiler. Missing bundles report the preparation command. Damaged bytes remain available for inspection.

The cache is `.abracode/reports/renderers/v3/<identity>/` and retains up to eight complete identities. An in-flight export can finish using its captured bytes after another preparation activates or evicts a bundle. Published HTML and historical export receipts remain independently readable under their original hashes. Source verification during preparation is bounded to 8192 files, 128 MiB and a 2 MiB manifest. Saved JSON and exported HTML retain their 1 MiB and 8 MiB limits.

Each export injects escaped canonical JSON and separately prepared SVG as inert
JSON script data. Captured content never becomes source code, a Vite config or a
module import. The prepared diagram worker uses the strict Mermaid engine, bounded queue, cache and deadline. The portable runtime embeds its rendering assets and remains usable offline.

JSON and HTML publication share the exclusive, private, flushed staging write and
non-overwriting link primitives. Their owners retain request binding, current-state
updates, digest/byte verification, receipt-loss reconciliation and owned scratch cleanup.

### Measured export cost

A matched local run on 2026-11-19 used Node 26.13.0, pnpm 12.21.0 and the saved document fixture in `tests/helpers/report-document.ts`. Each row measures one acquisition and render in the same process per version. The first row removes diagram evidence, the second renders one Mermaid source, and the third repeats it.

| Export           | Previous v2 | Prepared v3 | Browser launches / SVG compilations / cache hits (both) |
| ---------------- | ----------: | ----------: | ------------------------------------------------------- |
| Text only        |      769 ms |       22 ms | 0 / 0 / 0                                               |
| First diagram    |    2,516 ms |    1,324 ms | 1 / 1 / 0                                               |
| Repeated diagram |      819 ms |       24 ms | 0 / 0 / 1                                               |

Each v2 export opened 7,435 distinct source inputs twice and read 5,176,016 bytes of prepared files and metadata. Each v3 export opened zero source inputs and verified 7,496,522 prepared bytes including metadata. Neither version invoked an application compiler in these measurements because both installations had already been prepared. V3 preparation recorded 4,480 inputs. The CLI source-edit check produced identical HTML before re-preparation and a new exporter identity and HTML digest afterwards.

## Immutable file protocol

`workflow/report-files.ts` owns physical publication for canonical JSON, derived
HTML and export receipt files. Callers choose the owned destination and byte
policy, and supply expected digest/size plus content or a retained `.stage-*`
path. The module checks each directory, refuses symlinks and nonregular files,
reads through a bounded file handle, stages exclusively, flushes, links without
replacement and verifies the occupied destination. Identical concurrent writes
reuse the same bytes; conflicts stay available for inspection.

JSON stages remain retained until the owner's durable publication receipt commits.
An interrupted receipt resumes from the original stage or matching destination;
cleanup preserves changed scratch. Export recovery separately validates HTML
already present before `receipt.json`, then publishes the matching receipt without
rerendering or recapturing. This is ordered recovery, not a multi-file transaction.
`report-files.test.ts` exercises success, bounds, path/symlink refusal, concurrent
matching publication, conflicts, interrupted receipts and changed staging through
the production interface and live filesystem. Domain suites retain JSON receipt
loss and HTML-before-receipt recovery coverage.

`ReportDocuments` and `ReportExports` previously coordinated path checks, reads,
staging, linking, post-link verification and scratch cleanup independently. They
now select files and call this protocol. They still own locks, document/export
validation, request identity, execution generation, authorization and receipts;
verified file bytes alone grant no publication authority. Legacy Markdown and HTML
publication retain their existing compatibility path and immutable identities.

Saved generated surfaces resolve each required live task through the bounded
summary read, including closed work outside loaded history. A missing or failed
explicit live observation refuses a new save before reservation/publication. A
published same-request retry returns its original document even when source tasks
later disappear. Snapshot widgets retain their original publication-time rows;
live widgets freeze their separately observed save-time rows. Optional
`live_coverage` and `snapshot_coverage` remain with those respective values.
Unfiltered limits are explicit partial observations, and missing historical
coverage remains unknown. App and portable viewers share this pure binding
adapter and perform no summary reads for frozen documents.

### Diagram collection limits

New catalog-v2 reports support 32 diagram placements, 32 KiB UTF-8 source each and 256 KiB aggregate source across inline Mermaid and displayed captured-evidence sections. Repeated placements count even when preparation is reused. The new surface cap is 384 KiB; captured data/evidence remains bounded to 512 KiB, the canonical document to 1 MiB and the HTML artifact to 8 MiB. Every applicable bound must fit. Historical catalog-v1 documents retain their original eight-diagram and surface limits. Accepted research Markdown retains its enclosing 64 KiB publication bound.

### Shared diagram preparation and verifier

`abra_mermaid_verify` accepts `{ "diagrams": [{ "id": "overview", "source": "flowchart LR\nA --> B" }] }`. It returns overall `verified`, a compiler identity, per-source status/location when available, and preparation counts. Successful verification covers parsing, rendering and safe output; it does not prove factual correctness, visual legibility or repository checks. Malformed syntax, render errors, forbidden features, limit, timeout, busy and unavailable compiler outcomes remain distinct. Only current authorized managed roles and the central Supervisor can invoke it; no shell/file permission is needed.

The plugin, app, CLI and exporter use one bounded preparation interface. The service caches at most 128 results/32 MiB by exact source and compiler/security/theme identity, deduplicates pending sources, permits two active batches/eight queued batches and enforces a 60-second end-to-end deadline. Standalone CLI processes use the same policy with their own cache. Failed or interrupted viewing preserves source/JSON and never changes controller truth. Prepared output is capped at 8 MiB; final HTML must still fit its own 8 MiB bound.

Supported safe syntax includes flowcharts, sequence, state, class, ER, Gantt and mindmaps. Bidirectional arrows and ordinary label punctuation are accepted. Initialization directives/frontmatter, HTML labels, links/callbacks, images and external resources are refused; the compiler uses fixed strict settings and checks output SVG. Source-induced network requests are blocked. Chromium remains a preparation prerequisite (`pnpm report:browser:install` or a compatible `REPORT_CHROMIUM_PATH`); it is absent from exported viewing.

Explicit diagram lists replace defaults, including an empty list. With no override, generation uses retained research diagrams if present or the documented work/authority defaults. Requested collections are never clipped. Inline Mermaid placements and report-evidence diagrams are exported together. The app displays source/loading/failure individually and prepares only exact opened revisions; saved and offline viewers never substitute current work. Upgrade preserves historical JSON, HTML and research Markdown bytes; old readers cannot render catalog-v2 documents and must preserve their download.

## In-app interactive reviews

Abra can publish a separate [interactive review](interactive-reviews.md) alongside
an exact saved report. Choices, design previews and comments become an explicit
revision request to Abra. Review data and response receipts do not modify the
canonical document, authorize work or appear as new offline controls. Existing
HTML feedback exports retain their original behavior.
