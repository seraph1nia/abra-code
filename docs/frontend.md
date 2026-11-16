# Browser frontend

The workspace uses React, TanStack Router, Effect HTTP atoms, CopilotKit v2/AG-UI, shadcn components on Base UI, Tailwind CSS 4 and Pierre Diffs. Saved reports share the React/catalog renderer; the custom Solid terminal/report presentation is retired. OpenCode still owns its native CLI.

Shared schemas, branded identities, resource selections, HTTP operations and the
bounded catalog belong to `@abracode/contracts`. Its explicit subpath exports
carry browser-safe data and validation only. Policy resolution, native observation
and execution projections stay with their host owners. Root schema forwarders
preserve existing host imports during the runtime extraction.

`@abracode/presentation` owns UI primitives, design tokens, captured work/report
bindings and the upstream A2UI React renderer. Both applications use the same
exports. Navigation callbacks are supplied by the web caller; frozen callers
omit them. Query atoms, router state, admission, native tool rendering and report
save/export actions remain in `apps/web`. Shared rendering performs no live
reads. Tailwind scans the presentation workspace in both application builds.

Oxlint's workspace boundary rule checks value and type imports, re-exports and
literal dynamic imports against direct dependencies and explicit local exports.
It rejects cross-package source traversal, host imports in browser source, live
capabilities in frozen rendering and build-only dependencies in shipped source.
Package checks resolve the same exports as Vite and relocated source installs;
there are no report aliases back into web implementation files.

## State and transport ownership

Retained work bundles validate a work-graph source revision around a coordinated
record capture. Readers refuse a mixed capture and return resource-unavailable
after bounded contention/timeout retries. Native activity is observed separately
after that section. A source revision identifies captured retained state; a
timestamp describes observation freshness and never grants mutation authority.

An unavailable retained-work capture is local to that resource. The native web
adapter retains one last-valid, decoded work projection and sets the optional
`work_unavailable` status; it continues projecting current native conversation,
forms and permissions. Before any valid capture, work rows remain unavailable
with no fabricated fleet totals. The workspace labels retained work explicitly
and clears that label after a valid read. This presentation cache is never used
for native ownership checks, form answers, report capture or lifecycle actions.

- OpenCode owns the native session, model/tool loop, inbox, forms and permissions. Closing a browser only detaches observation.
- CopilotKit owns the live AG-UI state. `use-workspace.ts` validates snapshots against the shared JSON codec, retains the last valid snapshot and refuses another session's state. It also owns reconnect cleanup and durable submission reconciliation. HTTP bootstrap runs at startup, on explicit refresh and after mutations; live observation retains the server's five-second snapshot fallback. There is no second browser polling loop.
- `data.ts` owns `AtomHttpApi` queries, errors, caching and mutations. Query keys include their typed endpoint arguments. Work reads use issue invalidation keys and a 30-second idle cache; workspace updates coalesce invalidation to at most once per second. Resource selection subscribes to the selected query, so a late response cannot replace another resource's result. Registry disposal interrupts its owned effects.
- Native form/permission mutations are scoped to their observed binding, so separate forms do not share a promise/result slot. Same-form writes are serialized. Successful replies request a fresh authoritative snapshot.
- TanStack Router owns the selected issue, inspector tab, document/diff file and scope in validated search parameters. History/back/reload restore that selection. Composer drafts are scoped to the native session in local storage (32,768 characters), restored without submitting and removed after confirmed admission; unavailable storage leaves the mounted draft usable. Field edits, expanded sections and view preferences remain local React state.

Chat and the composer remain mounted while the collapsible Work finder and inspector open. The finder queries retained work through HTTP pages rather than filtering the bootstrap rows. Desktop can show a finder/inspector beside chat; narrow screens use sheets, preserving the draft and returning finder focus to its trigger. Attention has persistent access and keeps native form edits mounted when collapsed. Forms that already represent a work obligation are not counted again as another attention item. Queue input and Stop current Abra turn retain their native paths and do not change issue lifecycle state as observation side effects.

The shared Effect `HttpApi` definition still owns request encoding, response validation, typed errors and report URLs. Components consume typed query results, never a generic unknown resource cast. `RequestState` supplies consistent pending, retry and retained-value error presentation.

### Observation and resource contracts

`visibility/work-summary.ts` is the common task summary. Native visibility extends it with retained scope, policy and controller evidence. Supervision and delivery are projections of their owning contracts, including independent approval, delivery, cleanup and closure observations. Browser communication and feedback pages reuse the native Effect schemas. The data-only session and delivery contracts do not import the native tool registry or controller. Earlier saved browser observations may omit record versions or wait timing; readers preserve those gaps rather than invent timestamps.

`GET /api/work/find` accepts `repository_id`, `state` (`active`, `closed`, `all`), case-insensitive title/ID `search`, `offset` and `limit` (1–50, default 50). Active means retained issues whose status is not closed; it does not imply native execution. Search runs over all eligible retained issues before pagination. Results contain `entries`, filtered `total`, `next_offset` when more matches exist, and an observation time. Fleet totals use the complete retained population, independent of the page and filters; completed-today uses the service host's local calendar boundaries and explicit timezone. `queries.find({ state: "closed", search: "build", limit: 20 })` uses the same typed HTTP definition as native visibility. Query invalidation includes the finder key without adding a polling loop.

Fleet attention derives current approvals, open decisions, unresolved responses, expired/invalid waits and actionable recovery/cleanup evidence. It examines retained obligations beyond the loaded history page and beyond per-task display excerpts. Handled and superseded incidents alone do not qualify. Each attention item includes its owner and next action. A task can have several obligations. The first 100 are returned with `attention_total` and `attention_truncated`; truncated coverage is not an all-clear. Capacity and dependency waits remain separately classified. Missing native observations remain unavailable rather than idle.

`web/resources.ts` defines read-only selections for task sections, sessions, generation-bound decisions, changes and exact artifacts. Artifact selections bind a retained request ID and content hash. `POST /api/work/resolve` validates the capability and retained ownership through authenticated native RPC before resource bodies are requested. Unknown actions/extra command fields and unsafe file paths are rejected. This read-only operation does not admit a prompt, execute a tool or answer a form. Existing `issue/tab/file/scope` URLs map to the new selection; `resource` search parameters retain exact identities. Direct task detail does not depend on a finder page or repository filter.

Reads observe committed state for each request. The atom cache can retain the last valid observation during refresh; its timestamp describes that observation, not current authority. A local resource failure leaves other evidence usable; a refresh failure labels retained content as the last successful observation. The mounted observer handles the server's `abracode.connection` event, labels retained data during native outages and clears that label after a valid snapshot. Older or invalid observation times cannot replace the last valid workspace. Reconnect and the server's bounded fallback recover missed events; mounted work queries share an observation invalidation key, including selected tasks absent from bootstrap/finder pages. Per-task keys still scope explicit refreshes. Form and permission replies still require current native binding checks.

### Planning and task evidence

Task inspection uses the retained workflow policy: full OpenSpec work shows actual implementation-task progress; lightweight and research work shows its captured scope without inventing OpenSpec tasks. Approval, delivery, cleanup and issue closure remain separate outcome fields. Work-control buttons explicitly request an action from Abra.

Active plans use the bounded owned-worktree Markdown reader. Retired plans require both a retained archive path belonging to that change and its delivered commit in the verified registered repository. The archive reader lists at most 100 regular Markdown blobs, with a bounded 128 KiB tree listing and a 64 KiB per-document limit. It excludes Git symbolic links and never substitutes the current checkout's files. Missing references, blobs, repository identity or oversized documents produce local unavailable states; other task evidence stays available. A valid source is labeled with its archive commit.

Inspector navigation remembers the originating control and restores focus on dismissal, falling back to the persistent finder trigger if that control unmounted. An older ownership-resolution response cannot override a newer selection or a changed browser address.

## Components and styling

`components/ui` contains editable shadcn Base UI component source, generated with shadcn 4.23.0 and retaining its MIT notice. Import these components for owned controls instead of adding generic element styling or another primitive library. `components.json` records the Base Nova registry, aliases and theme entry. `lib/utils.ts` combines variant classes with `clsx` and `tailwind-merge`.

`theme.css` owns the shared semantic colors, radii, document typography, light/dark variables and upstream theme bridges. The theme provider resolves system preference and persists the chosen preference. Tailwind utilities style primitives; `style.css` contains class-scoped workspace layout and domain widget styling. Global control resets must not be used to override a component's behavior. CopilotKit styles occupy a named cascade layer. A2UI inherits mapped catalog tokens; Pierre receives the resolved theme and uses its supported component options and inherited sizing variables across Shadow DOM.

Prefer readable metadata (at least 12px), visible keyboard focus, status text alongside color and reduced-motion support. Mobile navigation and narrow-screen inspection use Base UI sheets for focus trapping and dismissal. Inspector tabs use the native Tabs primitive. Reuse the same owned components inside A2UI catalog widgets.

`presentation/work-widgets.tsx` is the navigation-independent work presentation boundary. It takes captured/current work plus an optional typed navigation adapter; frozen binding uses only saved inputs, preserving separate captured live and snapshot values in a mixed layout. Generated tables have semantic columns and rows, with local horizontal scrolling. Boards preserve unavailable observations in their own column. Timelines sort captured progress/decision/wait/closure times and explicitly describe their limited event coverage; missing times do not become render time. Dependency references come from WorkGraph's declared issue IDs, capped at 256 with a retained count. Blocker prose is separately labeled and never interpreted as an edge. Older observations without declared references remain unavailable. Work widgets show up to 100 matching observations and label excess coverage.

The trusted `ResourceLink` catalog component reuses the same closed resource schema as cards and URL navigation. It has a literal label and task/session/decision/changes/artifact target; no arbitrary callbacks or URLs. Native publication resolves ownership before capturing a new revision, and opening it rechecks ownership. Invalid links leave existing immutable revisions intact. Current-app navigation is labeled separately from captured evidence. Shared upstream Row layouts wrap; tables and boards retain container-local scroll at 375/390px.

`ReportEvidence` binds only captured report data and renders summary, findings, checks, lifecycle events, code/diff excerpts, limitations or diagrams. A live work surface without captured report data displays unavailable. It cannot accept authored successful check results as component props. Report findings retain their attribution and expandable references; local filtering changes only the view. Missing times stay unavailable, timed events sort chronologically, and pending checks remain pending. Code and diagram source scroll locally. The same React boundary renders frozen documents without a router, HTTP client, CopilotKit or controller import.

CopilotKit's controlled input and Markdown renderer provide conversation presentation. Submission remains in the native admission adapter rather than the default chat runner: an admission ID and exact text are retained before sending; uncertain submissions require explicit same-ID reconciliation. Queueing while busy and stopping the current native turn are separate controls.

`presentation/cards.tsx` provides navigation-independent task, decision, communication, session, finding and artifact summaries. Evidence/provenance is expandable; full payloads remain lazy inspector reads. `presentation/tools.tsx` registers only CopilotKit's render-only wildcard and consumes existing native calls through `useRenderToolCall`. Native streaming/running/error/completed states remain authoritative, including historical calls. Rendering a card does not register a model tool or execute a handler. Inspection validates the typed target through the existing read-only resource route.

Backend tool projections decode known native output schemas and retain at most 20 summaries and 64 KiB of presentation data per call. Omitted/excerpted rows are labeled. Communication summaries omit native prompts and uncaptured reply evidence; session summaries preserve missing observation times instead of assigning the current time during reload. Unsupported calls show a compact name/state with optional input/output excerpts limited to 4,096/8,192 characters. Ordered text/tool parts retain native call IDs; AG-UI display segments retain their producing native message ID as provenance. Provider replay and hidden reasoning are excluded.

### Decisions and communication

The inspector renders typed decision and wait cards and paginated communication threads, using the same compact summaries as chat cards. Full captured bodies, answers, acknowledgement times, source evidence, native observations and response-recovery/escalation state stay in disclosures. A request admitted to the native inbox is still unanswered until the retained response contract says otherwise. Missing legacy display bodies are labeled; native replay prompts are not substituted as conversation text.

Communication pages use the server-issued `next_offset` and page limit, retain independent total/outstanding counts, and refresh through the existing observation key. Links use the exact retained decision key/generation. An absent referenced decision stays unavailable; navigation creates no replacement question. Activity selections can name the closed `sessions`, `communication`, `checks` or `leads` subsection only with the task's `activity` section. Current communication/check links use their matching inspector views.

Answer is available only when the current observed user decision identifies an active native form. It dismisses the inspector, expands persistent attention and focuses that existing form; submission still uses its original binding and native reply route. A successful form reply does not synthesize an answered decision in browser state. Later committed observations supply its actual disposition.

### Worker transcripts and review evidence

Session cards use native role/model/activity observations, including queued, unknown and unavailable states. They page summary cards eight at a time. Exact session targets select that session's transcript, including retained historical workers. The fixed `/api/work/worker-history` read rechecks native issue/session ownership before every native `message.list` call, accepts only server-issued cursors remembered for that issue/session, and never exposes a generic native proxy. The backend remembers at most 500 cursor bindings; after a frontend backend restart, request the latest page to obtain fresh cursors. Native history stays in OpenCode.

Each transcript page reads at most eight native messages. The shared visible-message projection excludes hidden reasoning/provider replay and retains original message/call identities and ordering. Worker excerpts retain up to eight tools, eight file names and 32 ordered parts per message, with 8 KiB text, 1 KiB input, 2 KiB output and 2 KiB typed-presentation bounds. UTF-8 boundaries are preserved; omissions are labeled and the complete page is capped at 512 KiB. The same render-only tool component displays known cards and bounded tool details. There is no worker composer or execution handler.

Reviews & checks renders typed current/prior findings, retained action dispositions and external validation with their original head/gate/custody observations. Findings/actions use the native 20-entry page; external history uses the same owner's one-run-per-page continuation. An absent or incomplete observation is not successful checks, and a terminal external status alone does not fabricate an adopted result. Inspection and pagination create no work controls or approvals.

The inspector has Overview, Plan, Diff, Activity and Reports. Activity lazily mounts Sessions, Communication, Reviews & checks or Leads & proposals. Previous Workers/Communication/Feedback links select the matching Activity subsection; Decisions opens Overview. Exact resource links canonicalize the matching tab and subsection.

`GET /api/work/leads` accepts exactly one task or registered repository scope. It lists 20 compact lead summaries per page, including disabled leads and retained history after repository scope changes. Selected history independently pages ten requests and five captured proposals; related accepted work is capped at 50 with a total. Requests retain their native acknowledgement/reply/recovery observations but omit replay prompts. Proposal titles, descriptions and dependencies are bounded excerpts with explicit omission labels. Each complete response is capped at 1 MiB. Configured repository scope and retained work/request/proposal ownership govern reads; an unrelated lead/scope pair is refused.

Persistent attention receives only compact lead/repository counts from the existing management observation, at most 20 pairs with total/truncation/diagnostic counts. Opening a lead disclosure fetches its scoped history lazily, including repositories without tasks. No lead management or proposal acceptance authority is added. Native tests cover retained answered requests, pending/accepted proposals, disabled and changed-scope history, foreign-scope refusal and service restart.

### Retained presentation identity

New surface publications use immutable native records indexed by the original message/call identity and exact layout revision. Hashes cover the layout input and captured record. A surface head reserves the next revision and retains one fully validated pending publication. The owner writes publication before revision/receipt/latest indexes and message association; native startup or an identical retry repairs missing indexes without a provider turn or live recapture. Recovery examines at most sixteen current-session heads, with one pending record per head. Invalid recovery records stay preserved and produce local surface diagnostics.

`presentation/associations.ts` stores immutable message/tool/notice-to-resource references. Report publication associates its retained completion-notice ID before notification; receipt loss reuses that notice and artifact, and the existing report monitor repairs missing associations. Source identities never come from parsing prose. Native transcript pages carry up to 200 associations for their at-most-100 messages, with explicit coverage flags. Earlier pages preserve their associations in the mounted reader. Malformed or foreign records become message-local diagnostics rather than hiding valid conversation history. Native compaction can make an old producing message unavailable; it does not fabricate another message or remove retained task reports.

`GET /api/surface` reads an exact surface ID/revision through authenticated native ownership and integrity checks. Newer layout publication does not reinterpret an old card. Legacy latest-only records remain readable without rewriting their storage or inventing earlier revisions/associations; exact older reads state that limit. Other retained views remain reachable in the conversation's disclosure when their producing message is outside loaded history or unproven. Generated layout/history rendering and navigation never execute a model tool or advance work.

Current native workspace feeds carry compact surface ID/revision/time/history references, with layout/data bodies fetched lazily by the exact surface endpoint. The reader still accepts earlier full-record feeds for compatibility. Unassociated retained views load only when their disclosure opens; closed inline report previews likewise fetch metadata without document bodies.

## Native form definitions

OpenCode's Form and Permission schemas are the protocol authority. The exhaustive renderer maps their field types to shared controls; `native-form.ts` handles defaults, ordered conditional activation and definition-specific constraints. `Form.Answer` describes value shapes, not all the constraints of a specific form. Hidden active defaults remain in the answer; inactive branches are omitted. False and zero are valid answers. Changing a form binding remounts field edits and mutation state. Server-side form/checkpoint binding revalidation remains authoritative. No separate form-state library is required.

Overview's current plan/merge approval link focuses the existing native form. Before every reply the backend re-reads that form and controller checkpoint, including the current plan bytes or merge commit and exact decision/finishing identity. A stale target cannot consume the pending form; the browser does not approve a replacement target. Permission replies similarly re-read the native request and compare its binding before sending once/always/reject through the installed permission API.

## Immutable report format and readers

`presentation/report-document.ts` owns the `a2ui-snapshot` format, version 1. Its envelope retains a document/request ID, immutable revision, title/capture time, explicit catalog and renderer versions, issue/execution/generation provenance, optional source commit/research receipt/exact surface reference, a complete A2UI layout, frozen work/evidence and limitations. Source surface references include their original revision and digest. Research Markdown receipts and acceptance remain with the existing research owner.

Layout bytes are capped at 64 KiB, captured data at 512 KiB and the complete UTF-8 JSON document at 1 MiB. Layout work references must resolve within captured data; duplicate work identities or mismatched research/task provenance are invalid. Accepted captured evidence is rejected when oversized rather than silently truncated. Frozen viewing resolves live widgets from saved `work` and snapshot widgets from saved `snapshot_work` (or `work` for earlier documents), and never backfills from current task state. Literal generated explanations are labeled commentary; current-app drill-downs are separately labeled.

Artifact receipts distinguish untagged v1 retained HTML from v2 JSON documents. Existing HTML bytes and retries keep their original identity. JSON receipt catalog/renderer metadata can retain future versions; unsupported documents remain preserved and downloadable with a document-local diagnostic. Malformed documents do not hide unrelated artifacts. A newer viewer must ship an implementation for each supported catalog version, rather than interpreting a schema URL as executable rendering code.

`GET /api/work/artifact-document` reads one exact issue/request/hash through authenticated native ownership, expected-path, regular-file, byte-count and digest checks. `GET /api/report/document/download` uses the same query and returns the original JSON as an attachment. Bodies load only when their exact artifact is opened. Report selections survive Back/reload; legacy HTML remains isolated behind the existing sandbox and verified reader. Retention never automatically deletes old artifacts. Downgrades must preserve unsupported records and refuse incompatible writes.

Artifact listing pages eight retained revisions at a time with native total/offset/limit/continuation. Exact `artifact-summary` queries validate request/hash ownership independently of the page, so old message attachments and bookmarked reports stay reachable off-page. Index failures do not hide the selected document or Markdown report. The inline chat disclosure, inspector and full-width canvas all reuse `ReportDocumentView` and the same immutable atom key; closed previews fetch no body. Canvas selection is a validated local URL preference on an exact artifact, preserving Back/reload and the mounted conversation/draft.

Exact layout and document bodies have a 30-second idle cache and do not subscribe to mutable-work invalidations. Live work bindings and artifact metadata still refresh through committed observations. A successful immutable read needs no repeat fetch during worker progress; body errors remain local and can be explicitly refreshed.

Generated views expose an explicit Save snapshot action for a retained task/execution. `POST /api/report/save-surface` accepts only a task, stable request ID and observed surface ID/revision (plus an optional title). It rechecks the current surface revision, captures separate live/snapshot values and rejects stale layouts. Request identity is retained in browser storage before submission; an uncertain reply requires an explicit same-ID retry, including after reload. A successful retry never recaptures. Save another snapshot creates a new request and immutable revision. The existing authorized `abra_work_report` generation path composes captured evidence as JSON by default (the explicit `format: "a2ui-snapshot"` tag is also accepted); ordinary diagnostic reads cannot generate it.

The report owner reserves captured input in native records, writes a private exclusive staging file and syncs it, retains its digest/byte receipt, then atomically links the final JSON without replacing an occupied path. Published records omit the temporary document body; the canonical file remains the lazy source. Same-request and per-task locks serialize identity/revision allocation. Lost validation/publication responses reconcile retained bytes, while changed inputs, missing output, hash mismatches and symlink/path changes are refused. The existing monitor reconciles at most one pending artifact operation per pass without waiting on occupied slots.

Browser saves attach to the original generated-view message and native call when proven, using the exact saved artifact hash. They never submit a completion prompt or call the provider. A legacy surface without producing-message provenance remains reachable through task Reports. Composed native tool reports attach to their actual producing call; unknown provenance is not invented. Association failure is repaired independently after publication, using the same artifact and source identities. Existing legacy completion notices retain their original identities and behavior.

## Issue diffs

The browser calls the shared `/api/work/diff` endpoint, which reads the visibility RPC's `TicketDiff` projection. Git calculates tracked patches; `diff` synthesizes bounded untracked patches. All changes compare the retained execution base against the worktree; uncommitted changes compare HEAD against the worktree. Completed work compares retained base and delivered commits from the registered repository, even after worktree retirement. OpenCode's session/VCS APIs do not directly express that full retained comparison contract.

Pierre is lazy-loaded for presentation only. The changes view is a side-by-side Pierre diff collection with its own file headers, counts and hunk controls, including on narrow screens with local scrolling. A shared search input filters file names or rendered diff text; a unique file-name match requests that individual file and preserves its bookmark. There is no separate file list, layout switch or custom metadata toolbar. Existing scope bookmarks still select all execution changes or uncommitted changes.

Without a selected file, the native diff owner returns whole patches within a 64 KiB total preview budget, with explicit omissions for binary, oversized or unavailable files. Searching a unique file name requests its separately bounded preview even when omitted from the collection. The metadata remains capped at 500 files. Neither collection nor individual reads refresh the Git index or run OpenCode model tools. No editing, hunk application or additional context loading is exposed.

## Verification

Run the required repository checks described in [verification](verification/README.md). Focused browser coverage in `web-coherence.test.ts` checks URL history, Pierre rendering, responsive themes, independent form bindings/replies, bootstrap polling and same-ID submission recovery. Native installation tests still prove real OpenCode field replies, stale approval rejection and service lifetime. Unit tests exercise native constraint semantics and Pierre compatibility with real Git/untracked patch fixtures. Browser screenshots are retained outside disposable fixtures when `ABRACODE_TEST_EVIDENCE_DIR` is set.

Portable HTML uses an isolated React entry in `apps/report`, importing the same pure catalog components, shared presentation CSS and design tokens. Live query/router/CopilotKit/controller capabilities remain outside that bundle. Export is an explicit host action, keyed by saved digest and exporter identity; preview/download revalidate owned immutable files. Local feedback has no app capability. The Solid template and its compiler/manual authoring entry are retired. [Report operations and compatibility](reports.md) describe the canonical format, explicit commands, retention and downgrade limits.

The finder exposes complete-population fleet counts and per-project classification/attention counts independently of visible history pages. Native queued prompts, capacity waits and dependencies retain separate labels; task rows show retained wait reasons. Reviews retain preflight refusal/retry evidence and overdue observation times. [Frontend parity](verification/frontend-parity.md) maps the retired terminal scenarios and the active operational-maturity Native Work requirements to browser/native proof.

Workspace state has independent owners under `apps/web/src/workspace-state`:
observation owns ordering/connection/freshness/selective invalidation; admission
owns pending identity, exact receipt reconciliation and submission transports;
draft owns best-effort browser persistence; history owns transcript/association
paging. Navigation owns selection races and focus restoration; viewport owns
scroll/resize/history anchors. The shell composes them and displays errors. Each
transport detaches on unmount without stopping native work. Inspector, captured
reports/generated views and Markdown use retryable React lazy boundaries; hooks
and tool rendering use CopilotKit's supported headless entry. Final byte-graph,
deferred-feature, Back/focus and 375/390px acceptance remains pending.

### Versioned diagram data

Work catalog v2 and `abracode-react/v2` add literal Mermaid components and larger bounded collections. Retained v1 surfaces/documents keep their original IDs, byte limits, eight-diagram evidence contract and source safety policy. Readers check catalog, renderer and surface identity together. No upgrade rewrites saved JSON or interprets an unsupported diagram as a partial successful view.
