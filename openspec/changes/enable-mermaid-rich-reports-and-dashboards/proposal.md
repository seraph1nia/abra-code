# Proposal

## Why

Diagram-heavy reports and dashboards currently expose Mermaid source in the app and render it only during offline export. Agents cannot place standalone diagrams through the A2UI catalog or call a dedicated verifier, while eight-diagram limits, silent clipping and a broad source blacklist undermine larger requested presentations.

## What Changes

- Add a trusted `Mermaid` A2UI component with literal source, title and optional textual description, placeable among normal report/dashboard components. Make captured report diagrams use the same presentation and preparation behavior.
- Render diagrams in generated views, chat report previews, inspector/expanded reports and offline HTML; provide accessible source disclosure, local scrolling and an expanded diagram view with zoom/reset controls.
- Expose `abra_mermaid_verify` in the OpenCode plugin for Supervisor and active managed Explore, Apply, Review and Research roles. Return bounded per-diagram parse/render/safety diagnostics without requiring shell or repository writes.
- Accept up to 32 diagrams per surface/report with explicit aggregate source/output budgets. Preserve all requested diagrams or refuse the operation; never silently clip a list or append defaults that displace supplied diagrams.
- Replace punctuation-based rejection with shared syntax-aware validation, fixed compiler security settings and SVG resource checks. Exercise common flowchart, sequence, state, class, ER, Gantt and mindmap syntax plus hostile and expensive inputs.
- Introduce an explicit new catalog/renderer compatibility path while preserving historical surfaces, canonical JSON, accepted research Markdown and exported HTML under their original identities.

## Capabilities

### New Capabilities

- `mermaid-diagrams`: Bounded diagram composition, trusted preparation, accessible viewing and agent-facing verification shared by dashboards and reports.

### Modified Capabilities

- `report-template`: Preserve and render complete diagram collections from both catalog components and captured evidence in immutable documents and portable exports.
- `worker-policy`: Permit the diagnostic verifier through the authoritative role policy without widening shell, file, publication or lifecycle authority.

## Impact

Affected boundaries are `packages/contracts/src/web/{catalog,surfaces}.ts`, report evidence/document/workflow contracts, `packages/presentation/src/{surfaces,work-widgets,report-evidence,report-document}.tsx`, web report viewers, fixed HTTP/visibility transport, OpenCode tool registration/outputs/role policy, surface and report publication, and `apps/report/scripts/{diagrams,mermaid-engine,prepare-diagrams,validate,renderer-manifest}.ts`. The existing Playwright/Mermaid preparation dependency remains authoring/service tooling; it must not enter the app's eager browser bundle or portable runtime. Update renderer identity inputs, notices if dependency reachability changes, and report/API/verification documentation.

## Scope and Choices

### Existing behavior and concurrent work

The current catalog contains `ReportEvidence(section: "diagrams")`, not a standalone diagram component; `DependencyGraph` is a dependency list and remains a separate work widget. `report-snapshot.ts` appends two defaults and slices the combined list to eight. The report engine already parses, renders and checks SVG, but only exports call it. The focused catalog/schema/renderer suite passed 14 tests during investigation; that is not heavy-use acceptance evidence.

`make-chat-the-primary-workspace` has implemented, unsynced canonical-document deltas that retire manual TSX authoring. `strengthen-opencode-agui-and-surface-bindings` is changing publication bindings and immutable file mechanics in this checkout. Build on those owners and reconcile their deltas before sync/archive; do not restore the stale manual-template requirements in main specs or overwrite concurrent edits. This proposal adds requirements rather than replacing those pending blocks.

### One preparation interface

Deepen the existing diagram preparation owner into one bounded batch interface used by the verifier, publication preflight, exact app-view preparation and HTML export. A caller supplies stable diagram IDs and exact source; the owner handles source policy, parse/render, SVG checks, compiler identity, deduplication, scheduling, deadlines, diagnostics and cleanup. The CLI adapts file contents to this interface. Avoid separate browser/compiler implementations or caller-specific sanitizers.

For example, `abra_mermaid_verify({diagrams:[{id:"request-flow",source:"flowchart LR\nA --> B"}]})` returns an overall result and an identified result for each diagram. A failure identifies syntax, rendering, forbidden content, resource limit, timeout or unavailable compiler; line/column are optional when the engine supplies them. It validates syntax/renderability/safety, not factual diagram correctness or label legibility. Results cannot authorize report publication or become controller check/approval receipts. Return metadata/diagnostics, not unbounded SVG, from the native tool.

New surface/report publication preflights all selected diagrams before publishing a complete revision. The browser requests prepared assets only for an exact authorized surface revision or report request/hash through fixed typed routes; it cannot select paths, compiler options, native operations or remote resources. Existing report/surface owners retain authorization, frozen binding capture, locks, retries and receipts. View-only preparation never admits an agent turn. On compiler failure, retained JSON/source and previous revisions remain available with an individual diagnostic.

### Limits and heavy-use target

Initial target: 32 diagram instances per view/report; 32 KiB UTF-8 source each; 256 KiB aggregate source across inline and captured diagrams; 8 MiB prepared batch output. Count repeated placements even when compilation is deduplicated. A new catalog surface permits 384 KiB total while retaining 100 components and depth 10; old catalog surfaces keep their original limits. Keep the 512 KiB evidence, 1 MiB canonical document and 8 MiB final HTML caps: fitting one diagram limit does not bypass the enclosing budget. Diagnose the exceeded bound before publication and preserve prior outputs.

An explicitly supplied diagram list replaces automatic defaults; omitted input can use retained research diagrams or the existing defaults. Never clip explicit or retained lists. Persist only source/data in canonical JSON. Derived preparation is cached by exact source digest plus compiler/security/theme identity, with SVG IDs namespaced per rendered placement. Bound the cache to 128 entries/32 MiB, deduplicate in-flight work, and allow at most two preparation batches concurrently with eight queued batches per service process. Each batch has a 60-second end-to-end deadline including queue time; failure/timeout releases slots and owned browser/process resources. Detaching one caller must not cancel work still needed by another caller. Standalone CLI processes share the interface/policy but do not require a cross-process cache. Cache misses or service restart may reprepare from retained source.

### Safety and compatibility

Use the pinned installed Mermaid parser/renderer with fixed strict configuration and no source-controlled initialization/frontmatter, callbacks, links, HTML labels, images or external resources. Reject prohibited constructs as syntax/features, not arbitrary occurrences of `<`, backslashes or words inside plain labels. Reuse and harden SVG validation; enforce no source-induced resource requests during preparation. Do not execute generated SVG until the trusted preparation boundary has verified it.

Use a new catalog ID/version and renderer compatibility identity for the component and larger collections. Retain explicit readers for current/legacy catalogs and their historical limits; never reinterpret old bytes under the new contract. Extend active report inputs with shared diagram schemas without rewriting old retained execution/report records. Older applications can preserve/download new incompatible documents rather than silently render a partial view. No automatic migration of stored artifacts is included.

### Proof and boundaries

Retain reproducible measurements for a 32-diagram mixed report/dashboard, a dense 100-node flowchart, a 50-message sequence, repeated sources, concurrent batches and over-budget failures. Require all 32 lightweight diagrams to prepare within the 60-second budget on the documented verification machine, no compiler activity on an identical warm request, and no duplicate in-flight compilation. Record elapsed time, peak memory, compiler launches and output bytes; cold compilation and cached viewing are separate observations. Verify app/portable behavior at 375/390 px, in light/dark themes and after restart/relocation, with no external requests or provider admissions.

This does not add diagram editing, automatic factual verification, remote assets, executable Mermaid extensions, arbitrary dashboard code, or a global preference that adds diagrams to every response. Agent instructions should choose diagrams when requested or useful for the requested report/dashboard. Controller gates, independent Review and applicable human checkpoints remain required; this planning request does not admit implementation or authorize delivery.
