# Saved reports and portable exports

A report is an immutable JSON document rendered by the same React/A2UI catalog used in the workspace. Open a generated view and choose **Save snapshot**. The selected task must have a retained execution. Saving uses the observed surface revision, captures its live and snapshot inputs separately, and makes no provider call. If the response is uncertain, use **Retry same save**; **Save another snapshot** creates a new identity and revision.

Authorized `abra_work_report` generation composes captured report evidence into that catalog. New requests default to JSON; the optional `format: "a2ui-snapshot"` tag remains accepted. Accepted research Markdown and its controller gates remain independent. Reading or exporting a report cannot approve work or satisfy research acceptance.

Open a report from its conversation attachment or task Reports section. Chat preview, inspector and expanded canvas read the same exact request/hash. Bodies load only when opened. Findings, excerpts, chronological observations, limitations and pending/not-run checks come from saved values; the viewer never fills gaps from current work. App resource links explicitly inspect current resources. Malformed or unsupported documents retain their original JSON download and an individual diagnostic.

## Format and storage

`a2ui-snapshot` format version 1 retains the document/request ID, revision, capture time, issue/execution/control generation, catalog version, renderer compatibility, exact source surface and proven native message/call provenance. Its surface is bounded to 64 KiB, evidence to 512 KiB and complete UTF-8 document to 1 MiB. The catalog rejects callbacks, arbitrary links, approval components, cyclic/excessive layouts and unknown references.

The existing report owner reserves captured input, writes and syncs an exclusive private stage, retains a digest/byte receipt, and atomically links `.abracode/reports/generated/<issue>/<request>/index.json`. It never overwrites occupied output. Reads verify the retained identity, containment, real regular file, byte count and SHA-256. Same-ID retries reconcile bytes without recapture. These files and receipts survive worktree retirement; deleting them makes that revision unavailable. Preserve installation state and report files together when backing up.

Older applications do not understand the new receipt union or catalog: downgrading an installation with new reports is unsupported. Keep the original state backup when changing versions. Future format/catalog/renderer versions remain downloadable but cannot be rendered or exported by an incompatible reader.

## Optional offline HTML

Choose **Export offline HTML** in an opened report. The explicit export uses only its saved JSON, compatible installed React/catalog components, shared design tokens, prepared SVG diagrams and supplier notices. The file has local filtering/disclosures and Markdown/JSON feedback controls; feedback is review input only. App navigation is unavailable offline. External images, fonts, scripts and framework/diagram downloads are unsupported. Mermaid runs during preparation and is absent from the exported runtime.

Exports are cached by document hash and exporter identity, which fingerprints the installed renderer, catalog, styles, lockfile and attribution. Verified receipt/hash/byte checks protect preview and attachment download. Identical exports reuse existing bytes; an interrupted receipt can reconcile already published HTML. A changed exporter creates a separate destination under `.abracode/reports/exports/<document-hash>/<exporter-hash>/`. Export failures leave canonical JSON usable. The HTML cap is 8 MiB; the exercised React fixture is about 1.2 MB before compression, rather than a size guarantee for every report.

Contributors can export an explicitly downloaded JSON document and run an independent foreground preview:

```sh
pnpm report:browser:install
pnpm report:export /absolute/saved.json /absolute/new-export.html
pnpm report:preview /absolute/new-export.html 4174
pnpm report:validate /absolute/diagram.mmd
```

The export command refuses to overwrite its output. Preview binds loopback only, opens no browser or native connection, serves only that file with an opaque sandbox/CSP, and ends on Ctrl+C. No detached preview starts automatically. Copy the HTML elsewhere and open it directly without sibling files or networking. A supported native graphical file viewer can also open an absolute-path Markdown link; clients without that viewer can use a browser. The Solid template/manual-authoring workflow is retired.

## Legacy compatibility

Published untagged version-1 HTML receipts retain their original request, file and integrity checks. Retrying an original request returns that artifact, even after the default changes. Validated legacy staging or an interrupted publication can reconcile its original bytes. Pending/unfinished legacy builds without verified output retain captured input, hashes, errors and staging evidence but become explicitly unavailable because their compiler is retired. Create a new request to capture JSON; upgrades never convert or overwrite an old artifact. Accepted research Markdown remains readable under its original receipt.

See [frontend contracts](frontend.md), [API evidence](supported-apis.md#report-html-preview) and [verification](verification/README.md) for ownership, transport isolation and executable proof.
