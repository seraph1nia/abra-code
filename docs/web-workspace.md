# AbraCode workspace

For development, run:

```sh
pnpm dev
```

Open `http://127.0.0.1:5173`. Vite serves the TanStack Router frontend and React Fast Refresh preserves component state. `tsx watch` restarts the Effect HTTP adapter when backend source changes. The native OpenCode service and its work stay independently owned; ordinary HTTP reloads reuse its existing Abra session. Changes to code loaded inside the native plugin require its normal controlled service restart.

Use `pnpm dev --port 5174 --backend-port 4099` to change the frontend/backend ports. The Vite proxy validates the browser's exact origin before translating it to the private backend origin. Ctrl+C stops both development servers and preserves native work. The workspace remains the TanStack Router index route; validated search parameters retain issue, inspector tab, file and diff scope through browser history and reload.

Build and open the single-session frontend from the installation root:

```sh
pnpm web:build
pnpm web
```

The default URL is `http://127.0.0.1:4097`. `pnpm web --port 4098 --no-open` selects another port and prints its URL. Keep the foreground process open. Closing a tab detaches its observer; stopping this process closes its listener and streams. Native Abra, workers, worktrees and work history continue in the existing background service. Provider login remains `pnpm auth`. The frontend uses the existing session's model and existing worker configuration, with no additional model configuration or CopilotKit account.

The workspace keeps Abra chat and its composer mounted. Work opens a collapsible finder with retained search/history pages; inspection opens beside chat or in a narrow-screen sheet. Attention remains accessible from the conversation header. Generated layouts and report attachments appear with their producing messages rather than replacing chat with a separate view mode. All instructions, including worker instructions and work-control requests, go through Abra. Work-control buttons fill a request in the main composer; sending it queues a normal native input. Stop current Abra turn is distinct from Pause work. Native OpenCode cannot stop an arbitrarily selected historical run, so the adapter refuses that operation.

See [the frontend architecture](frontend.md) for state ownership, shared components, CSS, native forms and Pierre diff rendering.

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

## Boundaries and decisions

Exact Host and Origin checks precede routing. Safe GETs can omit Origin; mutations require the exact frontend Origin. Other local ports, cross-origin requests, encoded paths, raw native APIs, generic proxying and WebSocket forwarding are excluded. Credentials remain in the native client on the server. This is a local single-operator interface, not a remotely authenticated service.

The attention dock renders native string, choice, numeric, integer, boolean, multiselect and external fields, including conditions, required fields, defaults and hidden defaults. A reply carries the observed form binding. The server re-reads the form and controller checkpoint, checks exact approval fingerprints or decision/finishing identities and rejects stale/cancelled/conflicting input. Native/controller checks remain authoritative. Permission choices remain separate: once, always or reject. Generated views cannot create approvals.

## A2UI v1 catalog

The supervisor-only `abra_render_ui` tool publishes **A2UI 1.0** complete `createSurface` revisions with inline components and `id: "root"`, using catalog ID `https://abracode.local/catalog/work/v1/catalog.json`. Effect schemas own custom component props. The shared catalog builder generates JSON Schema, adds the A2UI catalog structure and reuses the upstream Column, Row and Text definitions. The server and browser load the same document through the official SDK; the frontend build also exports `catalog/work-v1.json`. Catalog identifiers are identifiers, not fetched URLs.

The catalog supports Column, Row, Text, WorkTable, StatusSummary, Kanban, DependencyGraph, Timeline, DecisionSummary and ReportLink. The upstream `MessageProcessor` and `@a2ui/react` render surfaces; custom work widgets receive application context for live work, retained snapshots and inspector navigation. Text remains literal text. Layout references use the v1 flat component adjacency list. Work references bind existing issue IDs. Views use live read-model data or a clearly labelled retained snapshot. Selection and report links open the inspector. New validated revisions retain immutable captured layouts and exact message/call associations before updating the latest-view index. Historical cards load their own revision through `/api/surface`; they do not silently resolve to a newer layout. Catalog IDs, size, depth, component identities, cycles and work references are bounded; HTML, executable callbacks, arbitrary URLs and approval components are rejected. The model receives schema-derived tool/catalog instructions; no browser component is injected into its native tool loop.

Surfaces travel in the existing AG-UI workspace snapshots, including reconnect/bootstrap. There is no separate A2UI server or streaming endpoint. CopilotKit's automatic A2UI tool middleware stays disabled because OpenCode owns the tool loop. Application state and native RPC results use shared Effect contracts; AG-UI events use upstream types and runtime validators. The frontend retains its last valid state when a streamed payload is malformed.

Saved surfaces with the previous `https://abracode.local/catalog/v1` ID are normalized on read without rewriting native storage, revisions, call identities or captured work. Invalid saved records become individual unavailable placeholders. The renderer prepares valid replacement models before swapping revisions and releases SDK subscriptions on replacement/unmount.

New publication reserves one pending record per surface head before writing immutable bytes/receipts and associations. Native startup and identical retries reconcile those records without recapture or model replay. Conversation pages retain up to 200 presentation references for 100 native messages, with local diagnostics and explicit truncation. Report notices attach their exact request/hash through the existing report owner and notification identity. A legacy record without proven earlier layouts or message provenance remains explicitly latest-only; other retained views stay reachable through a conversation disclosure. See [retained presentation identity](frontend.md#retained-presentation-identity).

AbraCode sets `COPILOTKIT_TELEMETRY_DISABLED=true` before initializing the web runtime, passes it to development child processes and defines it in frontend builds. The runtime discovery response reports telemetry disabled. This setting also applies when the Effect server is embedded in tests or another launcher.

Reports reuse existing retained Markdown and visual-artifact receipts. Visual reads validate the existing owned path, regular-file/containment rules, digest and byte count. HTML previews use an opaque iframe and a CSP that disallows network access, form submission, embedding and app-origin access. Downloads are explicit attachments. There is no general file-serving or artifact-editing API.

The built frontend carries supplier attributions and full retained terms in `THIRD_PARTY_NOTICES.txt`. Build scripts produce this file from the frozen license inventory.

## Verification

Use `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, `pnpm config:schema` and `pnpm licenses:check`. The source-install journey builds the frontend offline, opens it in Chromium, tests native form types, controller-binding rejection, reload and native-service restart, and proves frontend shutdown preserves native service/session ownership. Focused transport tests cover typed clients/errors, origin/path isolation, AG-UI identity/retries, disconnect interruption, and report sandbox/download headers. Admission tests cover simultaneous tabs and response-loss recovery.

See [the verification recipe](verification/README.md). Browser fixtures and native deterministic-provider journeys prove their stated behavior, not autonomous model quality or live remote delivery.

## Recorded acceptance

Local acceptance on 2026-11-15 passed `pnpm check`, `pnpm test` (500 tests in 79 files), `pnpm test:e2e` (5 tests in 3 files, 433.54 seconds), build, schema generation, dependency-peer validation, license checks and diff checks. The browser coding journey registered a project, created work, rendered A2UI v1, answered plan approval and completed implementation, independent Review and preserved branch delivery through the main interface. The development journey observed React HMR preserving a draft, an Effect backend reload and the same native session after development-server shutdown.

Retained evidence is under `/tmp/abra-copilotkit-verified`, outside disposable installations. Native, workspace and reply-recovery JSON record a pass and completed cleanup; `development.json` records both reload paths and session preservation. Screenshots and command logs survive teardown. A read-only browser check also loaded the operator's existing Abra session and current model without browser errors.

Initial full runs exposed timing assumptions in the existing native fixture. Pause now waits for confirmed native quiescence. Lead routing waits for earlier management attention to settle and uses the supported finite five-turn allowance for three lead requests plus concurrent central attention. The final run recorded three lead turns and four shared management turns within that allowance. Production defaults and controller gates are unchanged; earlier failed logs are retained alongside final proof.

Task inspection shows policy-specific planning evidence and independent approval, delivery, cleanup and closure states. Retired full-spec plans use verified regular Markdown blobs from the retained archive and delivered commit, never similarly named files in the current checkout. Missing archive/commit evidence is explicitly unavailable. Changes use searchable Pierre side-by-side diffs with Pierre file headers and no separate file list or layout toolbar. Existing file/scope bookmarks remain readable. See [frontend evidence ownership](frontend.md).

Activity contains owned worker transcripts, communication, Reviews & checks and scoped lead/proposal history. Disabled leads and accepted proposals remain inspectable after scope changes. Compact lead attention also works for repositories without tasks; opening it loads history without starting work. Current native approval links live in Overview and focus their existing forms. Composer drafts survive reload in session-scoped browser storage without automatic submission.

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
scan and unrelated native/lead reads. Finder aggregates still describe all work,
independently of its filter/page; mutation admission always reads current authority.

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
