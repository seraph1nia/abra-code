# AbraCode workspace

For development, run:

```sh
pnpm dev
```

Open `http://127.0.0.1:5173`. Vite serves the TanStack Router frontend and React Fast Refresh preserves component state. `tsx watch` restarts the Effect HTTP adapter when backend source changes. Each `pnpm dev` launch first recreates the root Docker Compose services and waits for Memos to be healthy, then starts or restarts the native OpenCode service and reuses the Abra session. Relaunch it when workers are idle to load native plugin changes. Ordinary HTTP reloads keep the native process running.

Use `pnpm dev --port 5174 --backend-port 4099` to change the frontend/backend ports. The Vite proxy validates the browser's exact origin before translating it to the private backend origin. Ctrl+C stops both development servers. Memos and the native service keep running. The workspace remains the TanStack Router index route; validated search parameters retain issue, inspector tab, file and diff scope through browser history and reload.

Build and open the single-session frontend from the installation root:

```sh
pnpm web:build
pnpm web
```

The default URL is `http://127.0.0.1:4097`. `pnpm web --port 4098 --no-open` selects another port and prints its URL. Keep the foreground process open. Closing a tab detaches its observer; stopping this process closes its listener and streams. Native Abra, workers, worktrees and work history continue in the existing background service. Provider login remains `pnpm auth`. The frontend uses the existing session's model and existing worker configuration, with no additional model configuration or CopilotKit account.

The workspace keeps Abra chat and its composer mounted. Work opens a collapsible finder with retained search/history pages; inspection opens beside chat on desktop, in a sheet on tablets, and in Canvas on phones. The desktop header contains Work, Abra, connection status, the attention count, Settings and a keyboard-accessible appearance selector. Choose System, Light or Dark while reading or composing. Review next opens the first answerable native form or permission. Attention lists all retained obligations and any coverage limits. Collapsing the list preserves edits for that binding. The device recap tracks reading history separately. Chat prose wraps near 70 characters, with extra room for code and tables. Generated layouts and report attachments appear with their producing messages rather than replacing chat with a separate view mode. All instructions, including worker instructions and work-control requests, go through Abra. Work-control buttons fill a request in the main composer; sending it queues a normal native input. Stop current Abra turn is distinct from Pause work. Native OpenCode cannot stop an arbitrarily selected historical run, so the adapter refuses that operation.

See [the frontend architecture](frontend.md) for state ownership, shared components, CSS, native forms and Pierre diff rendering.

## Settings

The Settings sidebar opens **Agents** by default. Choose **Repositories** or visit `/settings/repositories` to see every onboarded repository, including those with no tasks. The read-only list shows the registered ID and checkout path when available. Refresh reads the current list through the authenticated `abracode-web.projects` RPC.

Open **Settings** from the workspace header, or visit `/settings`, to inspect the installation's agent definitions. The read-only list includes bundled and custom agents from the injected `Agents` Effect service. Expand a definition to see its revision, native mode, roles, model reference, declared tools and custom tools, skills and preloads, capability requirements, additional denials, instruction source references and inline instructions. File contents and assignment-specific context are not loaded by this view.

The lazy-loaded page reads `GET /api/settings/agents` through the authenticated `abracode-web.agents` RPC. The gateway validates the retained central Abra session and projects only definition metadata: it never resolves instruction files, prepares agents, executes tools or invokes context providers. There is no settings mutation endpoint. Refresh reads the catalog again; an older native plugin reports the existing service-restart guidance instead of substituting bundled defaults.

## State and transport

`apps/web` uses the CopilotKit **v2** React API. `packages/runtime/src/web/agent.ts` implements its custom `AbstractAgent` and `AgentRunner`; `packages/runtime/src/web/server.ts` preserves CopilotKit's v2 Fetch handler and AG-UI wire protocol. The only advertised runtime agent is `abra`; its thread is the installation's retained native supervisor ID. Run input contributes one text message, never a replayed transcript or client-supplied model, tools, role or location.

The loopback server uses pinned **Effect 4.1.4** `NodeHttpServer`, `HttpRouter`, `HttpApiBuilder` and shared `HttpApi` contracts. The browser uses Effect `AtomHttpApi` and `@effect/atom-react` for typed queries and mutations; `apps/web/src/api.ts` only builds report navigation URLs. Payload/query schemas, responses and typed operation errors are shared. `packages/runtime/src/web/wire.ts` owns browser data projections and imports no controller or Node adapters. Native reads and submissions still cross the existing authenticated OpenCode plugin RPC boundary; this adds no browser RPC protocol.

Task summaries extend the shared visibility schema, and communication/review/check pages reuse their owning native schemas. The bounded discovery endpoint `/api/work/find` supports repository and active/closed/all filters, title/ID search across retained history, pages of at most 50 and explicit totals/continuations. Fleet counts are independent of the loaded page. Attention retains current owners/next actions, examines obligations outside that page, and reports its 100-item coverage limit. Direct detail remains available for tasks outside the current filter. See [observation contracts](frontend.md#observation-and-resource-contracts) for bounds and freshness semantics.

Typed resource selections name task sections, owned sessions, generation-bound decisions, changes or a report request with its exact hash. `/api/work/resolve` is a read-only ownership check through the native gateway; unknown actions, extra command fields, unsafe paths and foreign resources are refused before their evidence is opened. It grants no controller authority. Existing issue/tab/file/scope bookmarks remain valid, while typed resource bookmarks preserve exact identities.

Observers are scoped Effect streams, coalesced through bounded PubSubs with a five-second snapshot fallback. Unsubscribing AG-UI interrupts the observer fiber. HTTP request scopes abort the Fetch/response stream on disconnect. Native admission masks interruption only inside the short locked persist/admit/persist operation; observing a turn never owns that turn's lifetime.

Native event subscriptions reconnect one second after either clean EOF or a
failure. Repeated empty streams cannot spin without that delay. The server-owned
five-second fallback remains active between subscriptions. Closing the observer
scope cancels both backoff and fallback without stopping native work. Controlled
clock regressions in `packages/runtime/tests/unit/web-agent.test.ts` exercise both termination
paths, changes on the second subscription, fallback and disposal during backoff.

A stable browser submission ID binds exact text and queue/steer mode. Plugin storage retains its native message ID before admission. Identical retries reuse that receipt; changed input under the same ID fails. A lost response is reconciled against native inbox/history, including exact message lookup across compaction. Absence remains uncertain and does not cause automatic replay. Admission is separate from native execution and controller work completion. The frontend persists only an outstanding submission identity/input for recovery, not a second conversation database.

The latest 100 receipts are display history, ordered by retained time and request
identity. Pending input outside that window is observed through the uncached
typed GET `/api/admission/receipt?request_id=…`. Its authenticated native `receipt`
operation reads exactly one key in the fixed Abra session. A missing receipt is
`null`; an uncertain receipt remains uncertain. Neither result admits or
resubmits input. The browser clears pending state only when request ID, exact
text, delivery mode and admitted status agree. A conflict preserves the pending
input with an explanation. The existing explicit Reconcile submission action
retains its same-ID recovery behavior. This also works for restored tabs and
does not clear their separate unsent drafts.

History is paginated using native identities. The backend accepts only cursors it issued for this session. Existing native text/tool observations are projected explicitly; provider replay blobs and hidden reasoning never enter the browser. Terminal/controller-originated turns appear through the same observation path.

## Search work and commands

Choose **Search** in the workspace header or Settings, or use ⌘K on macOS and Ctrl+K on Windows or Linux. On phones, tap Search beside the workspace destinations. Type a title or issue ID to search active and closed local work across all projects. Exact IDs rank first. **See all results in Work** carries your text into the full finder, where you can refine the project and state.

Use the arrow keys to highlight a result and Enter to open it. Escape returns focus to where you opened Search. While inspecting a task, search for Plan, Diff, Verification or Reports to jump to its evidence. An empty search offers the last inspected item in this tab and session and, when a decision is waiting, **Review pending decisions** opens Attention. **Return to chat** focuses your current draft. Decision answers and chat messages still require explicit submission.

## Boundaries and decisions

Exact Host and Origin checks precede routing. Safe GETs can omit Origin; mutations require the exact frontend Origin. Other local ports, cross-origin requests, encoded paths, raw native APIs, generic proxying and WebSocket forwarding are excluded. Credentials remain in the native client on the server. This is a local single-operator interface, not a remotely authenticated service.

The attention dock renders native string, choice, numeric, integer, boolean, multiselect and external fields, including conditions, required fields, defaults and hidden defaults. A reply carries the observed form binding. The server re-reads the form and controller checkpoint, checks exact approval fingerprints or decision/finishing identities and rejects stale/cancelled/conflicting input. Native/controller checks remain authoritative. Permission choices remain separate: once, always or reject. Generated views cannot create approvals.

## A2UI v1 catalog

The supervisor-only `abra_render_ui` tool publishes **A2UI 1.0** complete `createSurface` revisions with inline components and `id: "root"`, using catalog ID `https://abracode.local/catalog/work/v4/catalog.json`. Effect schemas own custom component props. The shared catalog builder generates JSON Schema, adds the A2UI catalog structure and reuses the upstream Column, Row and Text definitions. The server and browser load the same document through the official SDK; the frontend build exports `catalog/work-v4.json` and retains the v1, v2 and v3 discovery documents. Catalog identifiers are identifiers, not fetched URLs.

The Supervisor loads the on-demand `abra-express` skill for component signatures and examples. Call `abra_render_ui` with a stable `surface_id` and an untagged Express `source`. For example, the following arguments publish a live work board.

```json
{
  "surface_id": "work-board",
  "source": "root = Column([Text(\"Current work\"), Kanban(mode=\"live\")])"
}
```

Set `validate_only` to `true` to check the same source and bindings. A valid draft returns `{ "validated": true, "surface_id": "work-board" }`. Publishing checks current references again, assigns a revision and attaches the view to the producing message. Failed checks report the offending expression or reference when available.

Charts take a title and a literal `data` array of 1–100 observations. Saved reports retain the supplied data and render it offline.

| Component   | Data entries                                 | Options                                                                                                        |
| ----------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| LineChart   | `{label, value}`                             | Connects unique categories in input order.                                                                     |
| BarChart    | `{label, value}` or `{label, series, value}` | Use `stacked=true` for category/series pairs. Both modes accept vertical (default) and horizontal orientation. |
| PieChart    | `{label, value}`                             | Nonnegative shares with a legend below the pie (vertical) or beside it (horizontal).                           |
| Histogram   | Numbers, including repeat observations       | Supply `xLabel` with the unit. Bins and counts are computed from the observations.                             |
| ScatterPlot | `{x, y, label?}`                             | Supply `xLabel` and `yLabel` for the numeric axes.                                                             |
| Heatmap     | `{x, y, value}`                              | Each pair of column and row labels identifies one cell. Omitted cells are blank.                               |
| GanttChart  | `{label, start, end}`                        | Each task label identifies one lane. Times are UTC instants with end after start.                              |

The catalog supports Column, Row, Text, LineChart, BarChart, PieChart, Histogram, ScatterPlot, Heatmap, GanttChart, Mermaid, WorkTable, StatusSummary, Kanban, DependencyGraph, Timeline, DecisionSummary, ReportLink, ResourceLink and ReportEvidence. The upstream `MessageProcessor` and `@a2ui/react` render surfaces; custom work widgets receive application context for live work, retained snapshots and inspector navigation. Text remains literal text. Layout references use the A2UI 1.0 flat component adjacency list. Work references bind existing issue IDs. Views use live read-model data or a clearly labelled retained snapshot. Selection and report links open the inspector. New validated revisions retain immutable captured layouts and exact message/call associations before updating the latest-view index. Historical cards load their own revision through `/api/surface`; they do not silently resolve to a newer layout. Catalog IDs, size, depth, component identities, cycles and work references are bounded; HTML, executable callbacks, arbitrary URLs and approval components are rejected. The model receives catalog-derived Express signatures; no browser component is injected into its native tool loop.

Surfaces travel in the existing AG-UI workspace snapshots, including reconnect/bootstrap. There is no separate A2UI server or streaming endpoint. CopilotKit's automatic A2UI tool middleware stays disabled because OpenCode owns the tool loop. Application state and native RPC results use shared Effect contracts; AG-UI events use upstream types and runtime validators. The frontend retains its last valid state when a streamed payload is malformed.

Saved surfaces with the previous `https://abracode.local/catalog/v1` ID are normalized on read without rewriting native storage, revisions, call identities or captured work. Invalid saved records become individual unavailable placeholders. The renderer prepares valid replacement models before swapping revisions and releases SDK subscriptions on replacement/unmount.

New publication reserves one pending record per surface head before writing immutable bytes/receipts and associations. Native startup and identical retries reconcile those records without recapture or model replay. Conversation pages retain up to 200 presentation references for 100 native messages, with local diagnostics and explicit truncation. Report notices attach their exact request/hash through the existing report owner and notification identity. A legacy record without proven earlier layouts or message provenance remains explicitly latest-only; other retained views stay reachable through a conversation disclosure. See [retained presentation identity](frontend.md#retained-presentation-identity).

AbraCode sets `COPILOTKIT_TELEMETRY_DISABLED=true` before initializing the web runtime, passes it to development child processes and defines it in frontend builds. The runtime discovery response reports telemetry disabled. This setting also applies when the Effect server is embedded in tests or another launcher.

Reports reuse existing retained Markdown and visual-artifact receipts. Visual reads validate the existing owned path, regular-file/containment rules, digest and byte count. HTML previews use an opaque iframe and a CSP that disallows network access, form submission, embedding and app-origin access. Downloads are explicit attachments. There is no general file-serving or artifact-editing API.

Markdown report reads return `{content}` when published, or `{unavailable:"not_started"|"not_published"}` for an existing task without an execution or published report. These are ordinary empty states. Unknown tasks and failed integrity/ownership checks remain errors. The web adapter preserves domain codes from native RPC failures; safe resource errors explain the unavailable evidence without exposing raw native diagnostics.

If the web adapter requests a feature missing from the running native plugin, `WEB_NATIVE_UPDATE_REQUIRED` explains that the service needs a restart to load the updated plugin. Refreshing the browser cannot reload native plugin code.

The built frontend carries supplier attributions and full retained terms in `THIRD_PARTY_NOTICES.txt`. Build scripts produce this file from the frozen license inventory.

## Verification

Use `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, `pnpm config:schema` and `pnpm licenses:check`. The source-install journey builds the frontend offline, opens it in Chromium, tests native form types, controller-binding rejection, reload and native-service restart, and proves frontend shutdown preserves native service/session ownership. Focused transport tests cover typed clients/errors, origin/path isolation, AG-UI identity/retries, disconnect interruption, and report sandbox/download headers. Admission tests cover simultaneous tabs and response-loss recovery.

See [the verification recipe](verification/README.md). Browser fixtures and native deterministic-provider journeys prove their stated behavior, not autonomous model quality or live remote delivery.

## Recorded acceptance

Local acceptance on 2026-11-15 passed `pnpm check`, `pnpm test` (500 tests in 79 files), `pnpm test:e2e` (5 tests in 3 files, 433.54 seconds), build, schema generation, dependency-peer validation, license checks and diff checks. The browser coding journey registered a project, created work, rendered A2UI v1, answered plan approval and completed implementation, independent Review and preserved branch delivery through the main interface. The development journey observed React HMR preserving a draft, an Effect backend reload and the same native session after development-server shutdown.

Retained evidence is under `/tmp/abra-copilotkit-verified`, outside disposable installations. Native, workspace and reply-recovery JSON record a pass and completed cleanup; `development.json` records both reload paths and session preservation. Screenshots and command logs survive teardown. A read-only browser check also loaded the operator's existing Abra session and current model without browser errors.

Initial full runs exposed timing assumptions in the existing native fixture. Pause now waits for confirmed native quiescence. Lead routing waits for earlier management attention to settle and uses the supported finite five-turn allowance for three lead requests plus concurrent central attention. The final run recorded three lead turns and four shared management turns within that allowance. Production defaults and controller gates are unchanged; earlier failed logs are retained alongside final proof.

Opening Overview or a direct ticket link reads the selected ticket independently of OpenSpec. Selecting Plan loads its policy-specific scope or planning evidence, and document bookmarks load the selected document. Task inspection shows policy-specific planning evidence and independent approval, delivery, cleanup and closure states. Retired full-spec plans use verified regular Markdown blobs from the retained archive and delivered commit, never similarly named files in the current checkout. Missing archive/commit evidence is explicitly unavailable. Changes use searchable Pierre side-by-side diffs with Pierre file headers and no separate file list or layout toolbar. Existing file/scope bookmarks remain readable. See [frontend evidence ownership](frontend.md).

Activity contains owned worker transcripts, communication, Reviews & checks and scoped lead/proposal history. Disabled leads and accepted proposals remain inspectable after scope changes. Compact lead attention also works for repositories without tasks; opening it loads history without starting work. Current native approval links live in Overview and focus their existing forms. Reopening a review restores the latest saved answers for its exact revision, including edits from another tab. A pending response is checked under its original request ID without resending. Edits that could not be saved stay available in the same tab. Composer drafts survive reload in session-scoped browser storage without automatic submission.

Reports can open an exact immutable JSON document using the shared A2UI/React catalog. Its captured values stay frozen through live work updates and reload, including pending checks. Local finding filters and evidence disclosures do not contact Abra. Download JSON retains the canonical bytes; unsupported or malformed documents show their own diagnostic while other reports remain usable. Existing HTML reports continue through their isolated legacy preview and download.

An opened JSON report offers explicit offline HTML export, verified attachment download and a sandboxed preview. Export uses the exact saved values and an exporter fingerprint; it does not call the provider. [Saved reports](reports.md) describes local commands, runtime size bounds and legacy compatibility.

Acceptance on 2026-11-16 supersedes the earlier frontend checkpoint: 560 unit/integration tests, 27 end-to-end tests, formatting/types/Effect diagnostics, build, schema, license evidence and strict validation passed. The [parity map](verification/frontend-parity.md#integrated-acceptance-on-2026-11-16) identifies retained command logs, screenshots, portable artifacts and native cleanup outcomes.

The backend's `work` interface has fixed typed operations derived from the shared
HTTP endpoint contracts. It carries decoded numeric paging fields and branded
identities directly to fixed native RPCs. The server validates outputs before
responding, including optional compatibility fields; query parsing rejects excess
capabilities before invoking the adapter. Adapter observation/receipt timestamps
use the supplied Effect Clock; native message timestamps retain their provenance.
For performance probes, selected detail must have zero fleet-readiness, collection
scan and unrelated native/lead reads. The finder uses an indexed page and reads
retained evidence for selected issues, their dependencies and their projects in
one revision-fenced capture. Exact match counts and later offsets can still
require SQL scanning. Capacity annotations use a separately refreshed record
summary. When that summary is unavailable for the captured revision, the row
identifies readiness as unobserved. Mutation admission always reads current authority.

Fleet totals describe all work independently of finder filters. Once a finder
is observed, committed work hints and periodic reconciliation refresh fleet
evidence in a scoped background worker. A page can return while that refresh
is pending. It carries the last fleet observation time and source revision
when available, with explicit stale or unavailable status and separate native
activity coverage. Finder ordering is indexed using the host's locale comparison.
Supported older databases backfill that derived index without changing issue
identities or events.

Committed controller notifications now include an optional typed resource scope.
The native authenticated location envelope is preserved; a matching controller
home accepts commits from managed worker locations. Missing/malformed legacy
scope triggers broad work recovery. Transcript, attention, admissions, affected
issue IDs, finder/fleet, projects and presentations have separate hints; bounded
burst coalescing unions identities, promoting overflow to broad work recovery.
Hidden reasoning and unrelated native sessions do not trigger web observations.

Each web-feed lifetime owns an opaque epoch and increasing sequence. Every
connection/HTTP bootstrap starts from a full baseline. Contiguous observations
use AG-UI `STATE_DELTA`; append-only visible text uses the standard text events.
Tool/structural transcript changes use `MESSAGES_SNAPSHOT` to preserve exact
native IDs, metadata and ordering. Subscriber gaps and epoch changes recover a
full baseline. The browser refuses gaps, duplicates, reordered/retired epochs
and foreign sessions while preserving its last valid state, then requests a
baseline without resubmitting input. Wall time reports freshness only.

One server-owned five-second fallback remains. Unchanged observations emit a
small freshness event, preserving mounted data and receipts without full-message
emissions or work invalidation. Semantic comparison omits only observation-owned
timestamps; retained receipt/native/evidence times remain significant. Scoped
native reads reuse the last valid display observations of unaffected resources;
these values never authorize mutations. Issue hints invalidate exact mounted
queries, including selected off-page issues; transcript/attention/admission-only
updates do not invalidate work documents. Unknown legacy scopes still invalidate
all mounted work. Browser/native integration acceptance remains tracked with
the final disposable journeys.

Public `/assets/` files with content-hashed names use a one-year immutable cache
policy; mutable HTML, API, private reports and errors remain `no-store`. Effect's
compression middleware negotiates gzip at level 6 for public asset bodies above
1 KiB. Compression applies only to that static route, leaving SSE and private
report response policies with their existing owners. Focused HTTP fixtures verify
headers, changed asset identities, exact decompressed bytes, meaningful byte
reduction and same-origin refusal. Browser cache reuse remains final acceptance.

### Generated binding selection

A2UI work widgets keep their own live/snapshot mode and explicit IDs; omitting
`issueIds` selects the bounded retained-work population, while `issueIds: []`
selects nothing. Navigation references validate ownership and reserve their
referenced rows, but never filter an unfiltered sibling. Shared selection reserves
explicit IDs first, deduplicates and fills remaining capacity deterministically up
to 100 rows. More than 100 required identities is refused before publication.
New surface revisions retain returned/total, unavailable and truncation coverage.
Old revisions keep their original bytes and identities; absent historical coverage
is unknown, and cannot be repaired by silently inserting current work.

Mounted generated live widgets use an app-owned, selection-keyed shared query;
the pure renderer receives only rows and coverage. Explicit references are read
independently of finder pages, affected task invalidations refresh them, and
snapshot siblings keep their original rows. Pending/missing data is unavailable
rather than an authoritative zero; failed refreshes retain stale rows. Replaced
selections unsubscribe from their old query, so late reads cannot replace the
new view. Frozen report viewing never mounts these queries. The shipped-browser
regressions exercise off-page rows, shared references, refresh failures, selection
races and 375/390px layouts without native prompt admission.

### Browser observation lifetime

`workspace-state/observation-client.ts` owns validation, accepted/retired epochs,
ordering, coalesced baseline recovery, scoped invalidation, freshness, reconnect
and disposal. Its caller supplies transport, baseline/invalidation adapters and an
optional controlled clock, then subscribes to current display state, refreshes or
disposes. The React hook no longer retains sequences, retirement sets, recovery
flags or competing refresh paths. Both explicit refresh and a gapped update cross
the same interface. Ordering remains in the shared contracts; complete lifetime
behavior is tested through the production module rather than a comparator alone.

Retired baselines cannot revive an earlier epoch. Gaps arriving during a pending
baseline share that read and request a bounded follow-up only if still uncovered.
An unavailable baseline preserves valid rows; disposal aborts reads and clears
invalidation/reconnect timers before detaching observation. No browser polling or
input replay is added. Native server fallback stays with the backend; draft,
admission, history, navigation and explicit Stop remain separate owners.

### Backend native AG-UI adapter

`opencode/agui/source.ts` owns authorized native session reads, bounded paging and
cursor custody. `messages.ts` owns visible native projection and receives optional
app-owned typed tool decoration. `adapter.ts` owns AG-UI validation, admission
identity, observation projection/cursors and explicit Stop semantics. It accepts a
small native source and runs without workspace/finder/report data; the web runner
supplies optional encoded app state and delegates protocol operations.

Previously the web agent interpreted native input, receipts, cancellation and
message order while the backend reversed pages and retained native cursors. The
web module now composes application data and hosts CopilotKit; these native rules
live behind the adapter/source interfaces. The existing scoped workspace feed
still owns the native event subscription and bounded fallback during extraction;
no new service, network hop, thread store or execution loop is introduced.

Agent cloning uses the pinned base clone to retain middleware, state and agent
configuration, then restores the native runner reference. Standard AG-UI client
proof covers actual HTTP run/retry/connect and detach without native Stop. Connect
now emits a real `RUN_STARTED` envelope; the old unit test's synthetic envelope
had hidden its absence. Application snapshots/deltas are composed separately from
the single owner of native message events.

### Native streaming, completion and reconnect

The existing single scoped event subscription now carries a private native event
hint to `opencode/agui/native-state.ts` before coalesced application observation.
Only validated visible native projections leave this seam; raw provider/reasoning
payloads never enter AG-UI state. New text/tool parts stream immediately under
native message/call identities. Complete text/input boundaries reconcile fragments;
argument rewrites and native status/error fields use explicit full projections.
The one server fallback remains bounded and shared across browser consumers.

Native execution terminal markers group delivered inputs since the preceding idle
marker, including steer. Each transport run waits for its own admitted message in
that evidence; unrelated idle and tool failure cannot finish it. Known native
failure emits a bounded `RUN_ERROR`; absent completion evidence and uncertain
admission never become successful completion or automatic replay. A new transport
run ID still reconciles the original durable request/message identity.

Reconnect or gaps preserve valid observations, request a baseline and reset only
the projection cursor. Existing in-flight text/argument fragments are ambiguous
across a recovery baseline, so they wait for their complete-value boundary; fresh
parts can resume incremental output. Routine retained reads preserve a known live
cursor only when the retained part agrees with its observed prefix; they cannot
suppress subsequent text until the provider finishes. Duplicate native IDs and older durable sequences are
ignored. Baseline reads buffer bounded concurrent events; completion/error facts
remain separate from current busy state. Per-observer cursors close only tool
streams they actually opened before resetting. Detaching observers never invokes
native Stop, and closing the server scope releases subscription/fallback work.
Current-turn Stop remains an explicit operation; historical-run Stop stays refused.

### Mermaid catalog v2

The v2 work catalog adds `Mermaid` with literal `title`, `source` and optional `description`. Compose it alongside work widgets; use `abra_mermaid_verify` before publication. V1 and legacy readers retain their original component contracts and 64 KiB limit. V2 permits 384 KiB surfaces, 100 components and depth 10. Diagram limits apply across inline placements and captured evidence: 32 instances, 32 KiB UTF-8 per source and 256 KiB aggregate. Unknown SVG, configuration and callback props are refused.

A generated layout becomes current when its revision and originating message
attachment are durable and its head commits. During replacement the previous
committed layout can still be opened or saved. Restart or retry finishes the
original capture. A legacy latest-only record exposes its recorded revision.

The fallback reads recent receipts, generated surfaces, message attachments and
projects under one request-local supervisor check. Scoped refreshes request
only their affected sections. Later reads and all guarded actions check current
authority again.

Save snapshot retains the selected task, surface revision and request ID in browser storage before sending. If storage is unavailable, the view stays open and asks you to enable it. After an uncertain response or a failed local receipt write, reopening the same selection offers **Retry same save** with the original ID. After confirmation, **Save another snapshot** starts a new request.

### Asking about selected work

In Diff, highlight lines on one side or open **Select lines** to enter a range with the keyboard. **Ask Abra about selection** attaches one excerpt to the main draft. You can inspect another issue before sending. A changed source leaves the draft editable. A lost response uses the same request and its original capture. Expand the sent selection to read the excerpt, Abra's explicitly linked answer or a worker's acknowledgement and recheck. Opening a captured question works after the worktree retires.

The Verification tab shows the task scope, prior check receipts, independently attributed Review findings, and links to the bound decision. Expand a screenshot to load its exact retained bytes and provenance. The desktop canvas width slider supports arrow keys. The same route opens the tablet inspector sheet or the phone Canvas.

Since your last inspection compares material results and decisions for up to 20 recently inspected tasks on this device, scoped to the Abra session. Unobserved tasks have partial coverage. Opening the result advances its local reading position. Human-owned obligations remain in Attention until settled. While Abra is busy, choose Queue for Abra or Steer current Abra turn before sending. Stop current Abra turn acts on the conversation. Issue-specific pause, resume and advance requests still go through the controller.

In a plan document, expand Ask about a plan passage and choose its first and last source lines. For a retained screenshot, select a rectangle in original image pixels. Both use the same draft and captured-question reader as a diff. Verification can download a worker-designated repository Playwright trace, show a file or symbol at its cited revision, and open versioned HTTPS documentation. Workers can supply references independently of an image or trace.

The canvas opens an exact finding, file, passage or saved report first. Switch sections with **Work details**. **Ask Abra** attaches the selected lines, passage or image region to the existing draft and focuses the composer. Inspecting another task or reloading preserves that attachment. Sending captures the excerpt under its native submission identity.

A generated comparison, board or diagram opens from its producing call. The address identifies the Abra conversation and exact layout revision. Live widgets read current work while snapshot widgets use captured values. Saved reports retain their published content. Verification shows the observed check result, independent review and current decision before underlying receipts. **Refresh canvas** updates its visible live evidence. A section that fails retains its previous result and offers its own **Retry**.

## GitHub inbox

Open Work or ask Abra “What's open across my projects?” to read the shared inbox. Its default includes all open GitHub issues and PRs. Use GitHub filters for labels, item kind, remote state or Abra role. Open an item for recent discussion and linked work. Ask Abra to pick up an issue or privately review a PR, then send the prepared request. The recorded work and GitHub states can advance independently.

SQLite keeps summaries and page progress across restarts. First access starts filling the index, with at most two inventory calls at once. A warm view reads the index immediately. After five minutes, visible views request an incremental refresh covering closures and reopens. Hidden views suspend periodic reads. Refresh GitHub requests an earlier observation within rate-limit backoff. Coverage and observation times identify partial or stale results. Closed history loads on demand. Selected detail uses a bounded five-minute memory cache. Unlinked closed summaries expire after 30 days, while task links and accepted evidence remain durable.

### Asking what to work on next

Try this in a disposable registered project with an open release PR and a separate queued task. Give the PR a title that identifies the release so you can check which item Abra refers to.

1. Ask “The release is my priority. What should I work on next?” Look for one action you can take, a task ID or PR link, and the fact that makes it worth doing first. If the inbox is incomplete, the answer should identify the gap.
2. Say “The release moved to Friday. Does that change your pick?” Abra should explain which premise changed and why the same item or a different one deserves attention. You can check the work list after both turns to confirm that advice alone created no assignment.
3. Ask “Privately review that release PR for upgrade risks.” The resulting local review should reference the same repository and PR and carry that focus. Repeat the request to check that it returns the existing assignment. If two release PRs fit the reference, Abra should ask which one you mean.

## Phone workspace

At 760 CSS pixels and below, the top bar opens **Chat**, **Canvas**, or **Settings**. Opening the workspace starts in Chat. Canvas opens the Work finder on first use and recalls the last inspected item for this tab and Abra session. Use **Find other work** to choose another task. Bookmark the finder at `/?view=finder`, or copy the URL while looking at a file, report or generated view to reopen that selection. Settings opens Agents, with Repositories at `/settings/repositories`. Browser Back and Forward follow these destinations.

While writing a prompt, follow an evidence link in a message to inspect the exact file or revision. Select the relevant lines and choose **Ask Abra**. Chat reopens with the selection attached and the cursor in the original draft. Edit the prompt and press **Send** when ready.

### Preview a phone on desktop

Open the current workspace in Chrome, open DevTools, and toggle the device toolbar (Ctrl+Shift+M, or Cmd+Shift+M on macOS). Choose Responsive, enable touch and set the viewport to 390 × 844. Type a draft in Chat, open Canvas, choose a task, visit Settings, then return to Chat. The draft should still be there. Try 375 × 812 and reduce the height to 450 pixels with the composer focused to approximate the space above a software keyboard. Restore the height and widen past 760 pixels to check the tablet layout. Actual keyboard animation, caret tracking and home-indicator insets need a physical phone.

### Personal thoughts

Open the Work finder from Canvas on your phone or from the workspace header on desktop and choose **Thoughts**. Recent private personal memos appear across all projects, including when you have no projects. Search literal text, an optional tag, and UTC creation dates. **Before** excludes the date you enter. Open a result to read the memo, follow **Open in Memos**, or go back to the same filtered page.

**Ask Abra about this** attaches the selected memo to your existing chat draft. Edit your question and press Send. Abra checks the account, private scope and wording at submission and when reading the memo. If the wording changed, return to Thoughts and reselect the version you want to discuss.

Programmatic callers can use the same workspace reads. `GET /api/thoughts?text=planning&tag=road&from=2026-11-01&until=2026-12-01` returns `entries` and, when another page exists, `next_cursor`. Send that value as `cursor` with the same filters. For detail, pass the returned reference fields (`instance`, `account`, `name`, `wording_hash`) as URL-encoded query parameters to `GET /api/thoughts/detail`. The workspace’s ordinary origin and session checks apply. The browser never needs a Memos access token.
