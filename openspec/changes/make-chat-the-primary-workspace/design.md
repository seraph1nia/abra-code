# Design

## Context

See `proposal.md` for the outcome and scope. The current checkout already contains an uncommitted React frontend refactor: Base UI/shadcn primitives, CopilotKit Markdown, Pierre diffs, typed URL navigation, Effect HTTP atoms, a scoped workspace hook and responsive inspector sheets. These are the implementation baseline, not completed acceptance for this proposal. Do not overwrite that work or treat the earlier audit's rendering defects as necessarily still present.

The remaining architectural gaps are visible in concrete callers:

- `src/web/agent.ts` maps native transcript messages to text-only AG-UI messages, while `backend.ts` separately serializes native tool input/result observations into strings. Standard tool renderers cannot recover ordered, typed presentation from that projection.
- `workspace.tsx` separates Conversation and Work views; `inspector.tsx` still renders decisions, communication and feedback as generic structured evidence.
- `src/web/wire.ts` omits native supervision/delivery detail and uses arbitrary JSON for communication/feedback entries. The native visibility services already own richer, typed evidence and fleet classification.
- `render-tool.ts` stores only the latest `web/surface/<session>/<surface>` revision, plus per-call receipts. Its `SurfaceRecord` contains a surface, captured work and a compound native call identity. There is no general immutable report document or attachment index.
- `visual-reports.ts` and `report-build.ts` retain immutable HTML builds compiled by the Solid template. `Reports` separately owns accepted research Markdown and its evidence. Generated HTML never owns research acceptance.
- The TUI plugin registers footers, sidebar, work panel/route and commands. `src/visibility` mixes those renderers with backend read models, diff/document services, RPC contracts, invalidations and pure classification used by the web/controller.

## Goals / Non-Goals

**Goals:**

- One ordered Abra conversation with reusable minimal summaries and deterministic navigation to evidence.
- One presentation catalog reused by routine cards, generated A2UI, frozen JSON reports and optional portable exports.
- Typed, bounded data at browser/native boundaries with honest freshness, coverage and resource availability.
- Retained compatibility for existing sessions, pending forms, published HTML, research receipts and saved surfaces.
- Complete removal of the custom terminal presentation after equivalent inspection behavior is proven in the browser.

**Non-Goals:**

- A second agent/model runner, frontend model tools, browser-owned workflow state, direct worker messaging, or new approval authority.
- A general arbitrary HTML/JavaScript authoring service, public hosting, cross-device collaboration, report editing/version merging, or automatic deletion of retained artifacts.
- A pixel-identical archival guarantee across every future renderer. Preserve supported document semantics with versioned catalog support; an exported HTML file captures a portable rendering.
- Rewriting unrelated controller logic, historical OpenSpec archives or active changes; replacing the normal operational CLI is outside this change.

## Decisions

### 1. Chat remains mounted; inspection is a resource selection

The root workspace always shows Abra and the composer. Remove the Conversation/Work views mode. A compact Work button opens a finder with repository filters, search, actionable attention and paginated history. It can be collapsed without losing discoverability; no permanently expanded project hierarchy is required.

A discriminated route selection identifies a task section, worker session or artifact revision. Use the current TanStack search validation and Sheet primitives. Desktop displays one adjacent inspector/canvas; narrow screens display one accessible full-screen sheet. Preserve draft, transcript scroll and message identities on navigation; support Back, Escape, reload and a direct deep link. Map current `issue/tab/file/scope` URLs to the new selection where possible rather than silently breaking bookmarks.

Task inspection defaults to summary. Plan, Changes, Activity and Reports are secondary sections. Open decisions appear in the summary and persistent compact attention affordance. Workers, communication and review/check detail are expandable Activity sections rather than eight equally prominent destinations. Configured lead scope, pending proposals and related work remain available through Activity/attention; this adds inspection, not management editing.

Alternative: keep the dashboard and place chat beside it. Rejected because it preserves competing primary modes and requires users to understand internal navigation before asking a question.

### 2. Preserve native observations through AG-UI and attach presentation by identity

Project an ordered transcript containing native text and tool observations with stable native message and tool-call IDs, streaming/executing/completed/error state and safe typed results for supported AbraCode tools. Preserve the existing history cursor and admission receipt semantics. Never expose hidden reasoning/provider replay blobs. Unknown tools use a compact name/state fallback with bounded optional details, not an automatic full JSON dump.

Use CopilotKit v2 render-only registration/consumption for these observations; verify exact installed declarations and native message shapes before changing the adapter. Do not register new browser-executed tools, replay tool calls, enable automatic A2UI tool injection or change the native model/tool loop. The default renderer must work for historical completed tool calls as well as current runs.

Persist a small presentation attachment referencing an existing typed resource: `{message_id, tool_call_id?, target}`. Targets identify an exact generated surface revision or report document. A reverse index resolves presentation for the currently loaded conversation page. Persist publication before association/notification; retries reconcile the same native call/request identity and repair a missing association without republishing. Background report completion uses the existing notice identity to attach the result; when no retained producing message can be proven, keep it reachable from task Reports instead of inventing an association.

Historical messages link to exact surface/report revisions. A live surface's data can update, but its layout revision remains explicit; updating its layout creates a new revision. A saved report always resolves its frozen data. Do not reinterpret a past report card as the latest report.

Alternative: parse resource paths/IDs out of Markdown or stringified tool output. Rejected because it loses typing, ordering, provenance and reliable restart associations.

### 3. Summary projections are small; domain evidence keeps its owner

Derive presentation types from browser-safe owning Effect schemas, using picks/refinements and explicit JSON codecs. Keep Node/controller adapters out of browser imports. Do not manually maintain parallel decision/message/feedback enums or an editable display lifecycle. Reuse native `supervisionSummary`, `fleetState`, readiness and delivery outcomes; retain generation/observation identity even when not displayed.

Default cards show:

| Kind          | Default fields                                                         | On-demand evidence                                                                                        |
| ------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Task          | Title, primary observed state, latest concise progress, next action    | Policy/scope, capacity/dependency blockers, independent approval/delivery/cleanup/closure, plans, changes |
| Decision      | Question, owner, open/resolved status                                  | Context, answer, exact form reference and disposition history                                             |
| Communication | Sender/recipient roles, kind, concise body/reply, response status      | Request body, evidence, admission/acknowledgement/recovery distinctions, source identities                |
| Session       | Role, model label, running/queued/idle/unavailable, last progress/time | Paginated visible transcript and expandable tool observations                                             |
| Review/check  | Finding/check summary, blocking/disposition state                      | Source/head, links, logs, external gate and action history                                                |
| Artifact      | Title, format, captured time, availability                             | Frozen report and provenance, JSON download, optional HTML export                                         |

Prefer human labels over raw phase strings; technical IDs, hashes and generations live in expanded provenance. A closed issue, completed provider turn and delivered artifact remain independent observations.

The workspace feed carries bounded conversation data, native forms/permissions, aggregate counts and compact presentation references. It does not repeatedly ship all artifact bodies, worker transcripts, PR histories or all graph rows. Finder and selected detail are paged HTTP reads; full document payloads load on open. Keep existing native limits unless a stricter projection applies: 50 work rows per page, 20 communication/feedback entries per page, up to 100 transcript messages per page, 64 KiB per plan/patch, 100 components and depth 10 per A2UI surface. Expose totals/continuations and explicit truncation. Search runs over eligible retained issues by title/ID with repository/state filters, not just the current page.

Use existing committed invalidations and scoped atom queries to refresh only mounted/observed pages and details; coalesce refresh and retain the native fallback. Do not add a second browser bootstrap polling loop. A late response cannot replace a new selection. On loss of service, preserve and label the last valid observation; a missing document is a local resource error.

### 4. Navigation is a small typed application capability

Shared cards and A2UI receive an application navigation adapter for `open_task`, `open_session`, `open_decision`, `open_changes` and `open_artifact`. Each target is schema validated and resolved against retained issue/session/artifact ownership. The adapter is implemented inside trusted catalog components, not arbitrary generated callbacks, generic URLs or controller commands.

Read navigation makes no agent turn and no mutation. An explicitly labeled Ask Abra action routes exact context through normal central input admission. An Answer/Review approval action opens the current native form; the reply endpoint rechecks bindings, fingerprints, target/generation and ownership. No model-generated card or HTML export can grant plan/merge authorization. Preserve native permission choices and the distinct Stop current Abra turn behavior.

Alternative: use arbitrary A2UI action names to call backend tools. Rejected because ordinary drill-down needs only local navigation and must not become another control plane.

### 5. One bounded catalog supports app cards and authored A2UI

Extract data-only React presentation primitives and navigation-independent layout from `surfaces.tsx`/inspector components. Bind them through the existing upstream A2UI processor/React renderer. Keep the catalog closed, generated from Effect schemas and validated server/client side. Add only the summary, report-section/evidence and link components exercised by actual scenarios, including findings, available checks, code/diff excerpts, limitations and prepared diagrams needed by current reports.

Ensure labels match behavior. A table presents actual rows/columns. A timeline uses captured chronological events and times. A dependency graph uses actual dependency references; for data lacking them render a labeled blocker list. Responsive rows wrap/stack and boards scroll inside a bounded container. Avoid page-wide overflow at 375/390px and when the inspector is open.

Keep layout/data binding distinct from domain state. Snapshot rendering receives only captured data and a local navigation adapter; live rendering receives current summary queries. A generated report may choose layout and literal explanations, while status/verification claims shown as evidence are bound to validated captured sources. Literal model prose remains clearly commentary, never a passed-check receipt.

### 6. Canonical reports are immutable JSON documents

Introduce a versioned artifact union supporting `a2ui-snapshot` and existing `legacy-html` receipts. Store the actual A2UI report as one validated UTF-8 JSON blob under the installation's owned report storage, with a content hash/byte receipt in retained plugin evidence. No second database is needed. Presentation associations are references, not copies of the report.

The proposed snapshot envelope contains:

```text
format_version, document_id, revision, title, captured_at
catalog_id, catalog_version, renderer_compatibility
provenance: issue/execution/generation/source commit and available evidence refs
surface: complete validated A2UI layout revision
data: frozen values used by every rendered binding
limitations: coverage, truncation and unavailable evidence
```

Start with the existing 512 KiB evidence snapshot bound plus 64 KiB surface bound and a 1 MiB complete JSON document bound. Reject oversized publication with a concrete limit; never silently truncate retained accepted evidence. Derived displays can select bounded excerpts with declared omissions and references. Catalog identity includes an explicit version; a schema document alone is not a renderer implementation. Ship a compatibility registry for supported catalog/component versions. Unsupported future versions remain preserved and individually unavailable with JSON download.

Report creation has two routes sharing publication: freeze a known live surface revision with its resolved data, or let authorized Abra compose a report surface over a freshly captured bounded evidence snapshot. Allow saving a surface as an explicit user artifact action through the native owner; the browser sends an observed surface/revision and stable request identity, and the server validates and freezes it without a provider turn. A changed revision is a conflict, not an implicit capture of different data. Neither route advances work. Existing authorized Research requests continue through accepted structured research evidence; new presentation does not replace its Markdown receipt/acceptance.

Freeze values, not just work IDs. Exported or reopened snapshots never query current work to fill missing data or turn pending checks into passed checks. Optional app drill-downs resolve current resources and are labeled separately from captured evidence. Expandable captured evidence works after worktree retirement. Missing optional transcripts remain unavailable instead of triggering a live substitution.

Publication reuses retained request identity, bounded coordination, safe owned directories, digest verification and atomic exclusive writes. Identical retries return the same document; conflicting request reuse fails. Write the document before publishing the receipt/attachment. Crash recovery verifies bytes and reconciles incomplete metadata. A new request creates a new revision, never overwrites an earlier document. Download returns the verified canonical JSON as an explicit attachment.

Alternative: make HTML the primary artifact and reverse-extract its data. Rejected because document identity, browser viewing and optional export should share the original validated representation.

### 7. React renders all new presentations; HTML is an optional derivative

Use the same React catalog and frozen binding layer in chat, inspector/canvas, and a small isolated export entry. The default chat representation is an artifact card with Open, optional inline preview, and Download JSON. Large report bodies stay unmounted until opened. In-app local filtering/disclosure is ephemeral and never mutates the document.

For an explicit HTML export, bundle the exact document, compatible React/A2UI component implementations, required styles, prepared SVG diagrams and notices into one offline HTML file. Include only exercised report components; do not pull in CopilotKit, live HTTP/query clients, app routing, credentials or controller capabilities. Measure real output size; do not assume shared source removes the runtime duplicated in portable files. Preserve the existing 8 MiB HTML cap. Cache exports by document hash plus exporter/catalog identity; publication is idempotent and does not recapture current work.

App navigation is replaced with captured sections/links or clear unavailable-app actions in offline exports. Only local search, disclosures, filtering and optional Markdown/JSON feedback export operate there. Existing legacy HTML stays behind the verified containment/hash/byte reader and opaque iframe/CSP. Both legacy and new exports download as attachments. The JSON is the canonical artifact; HTML failure leaves it usable.

Retire `vite-plugin-solid`, Solid report components and the independent manual-template-first workflow after exporter parity. Reuse the single-file packaging, prepared Mermaid validation and attribution where still applicable. Move browser-launch/diagram tooling out of the retired template location before removing imports used by frontend/native tests. Preserve the evidence schema's semantic contract when removing backend imports from presentation directories. Keep the operator's explicit exported-file preview command documented, without automatic detached servers.

### 8. Remove terminal presentation, preserve shared observation and operations

Delete the custom TUI plugin/export, `abracode-tui` pack entry, terminal-only renderers/client state/resources/controls, footer/sidebar/panel/routes/commands and terminal renderer acceptance. First classify dependencies: preserve backend visibility/protocol, invalidations, fleet/supervision, worker inspection and safe document/diff services; retain pure presentation semantics used by controller/tests until moved to a browser-safe owner.

Audit root/plugin/workspace dependencies and licensing. Remove direct Solid/OpenTUI/theme dependencies only after neither reports, custom TUI nor supported code uses them; native OpenCode may still bring its own transitive terminal stack. Keep source installation, service, authentication, configuration and ordinary native attach commands working. The normal launch/reattach contract remains unchanged by this presentation change; the browser workspace is the supported custom work UI.

Alternative: leave a dormant TUI plugin or compatibility flag. Rejected because the user requested removal and retaining a second renderer prolongs the same maintenance cost.

## Risks / Trade-offs

- Native observations currently lose tool ordering/typed values -> prove one real native tool/card round-trip through the pinned AG-UI/CopilotKit versions before building the full card catalog; keep the existing run/admission model.
- Small summaries can hide important waits -> server-derived attention/counts preserve owner, next action, coverage and independent delivery/cleanup/closure; full evidence remains reachable.
- Snapshot JSON depends on a compatible viewer -> retain explicit catalog versions and supported readers; preserve unknown documents for download; portable HTML is the standalone-browser option.
- Immutable revisions increase storage -> bound individual documents and page artifact listings; do not introduce automatic retention deletion in this change.
- HTML export includes a runtime and may grow -> bundle a minimal isolated entry, measure actual bytes, retain caps and offline/network-blocked acceptance.
- Refactoring shared `visibility` code can remove backend behavior -> dependency audit and web parity precede terminal deletion; controller/native tests remain mandatory.
- Active `harden-operational-maturity` deltas still require Native Work/lead views -> coordinate requirements at integration, preserving their bounded communication, response recovery, fleet/lead and attention semantics in browser scenarios; do not edit the other change or historical archives to hide conflicts.
- Existing checkpoints use in-memory native forms -> maintain recreation/current-binding behavior across service restart; artifact persistence never constitutes an answer.

## Migration Plan

1. Establish typed browser-safe summary/resource contracts and immutable document readers first; old records, current UI URLs and HTML continue to work.
2. Deliver a vertical chat task-card -> inspector/session read with real native tool identity and no new prompt, then migrate other cards and the primary shell.
3. Introduce the shared catalog and immutable surface revisions/attachments. Keep legacy latest-only surfaces readable without fabricating unrecoverable old revisions.
4. Publish canonical JSON snapshots and render them through the same catalog. Preserve legacy report request retries as legacy artifacts; only new requests produce new-format reports. Add safe JSON download and supported-version diagnostics.
5. Verify React offline export parity, local feedback, prepared diagrams and legacy viewing; then remove the Solid report pipeline and update all test/helper imports.
6. Transfer terminal scenarios to web/native acceptance; remove TUI entry/export/renderers and unused direct dependencies.
7. Update operator/contributor/API/verification docs, dependency/license evidence and affected spec integration. Run full required checks and retain disposable native/browser proof outside fixture cleanup.

At every step, delivery remains controller-owned. No in-place conversion/deletion of old reports, sessions, worktrees or pending decisions is required. For rollback, preserve old artifact bytes and receipts; stop new-format publication before downgrading. An older binary must preserve unsupported versioned records and refuse unsafe mutation rather than dropping them. UI rollback cannot restore deleted historical layout revisions that were never retained, so label those limits instead of synthesizing history.
