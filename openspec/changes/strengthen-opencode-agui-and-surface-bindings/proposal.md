# Proposal

## Why

Generated work views can silently omit tasks: one task-specific link narrows unrelated snapshot widgets, and live widgets cannot resolve valid tasks outside the workspace's loaded history page. Across report publication and observation, protocol knowledge is also scattered across small modules and their callers; this change concentrates complete outcome/recovery sequences behind smaller interfaces while retaining existing execution and authority owners.

## What Changes

- First deepen immutable report files: consolidate owned-path checks, bounded verified reads, digest/byte checks, staging, occupied-destination reconciliation, exclusive publication and safe staging cleanup for JSON reports and HTML exports. Publication owners keep authorization, locks, execution generation and receipt rules.
- Compute surface data requirements per widget and binding mode. Unfiltered widgets retain their bounded population even when another widget names one task; capture includes explicit references and reports coverage limits.
- Resolve explicitly selected live tasks independently of finder/history pages through bounded, read-only summary reads. Render missing, failed, stale and truncated observations explicitly rather than reporting an authoritative empty table or zero count.
- Use the same binding selection and coverage semantics when publishing surfaces, saving immutable reports, rendering in the app and exporting offline.
- Extract a backend-owned OpenCode AG-UI adapter inside the existing runtime. Separate native session/admission/transcript semantics from workspace state and CopilotKit hosting, then translate supported native text/tool events incrementally with baseline recovery.
- Deepen browser workspace observation so validation, ordering, retired epochs, baseline recovery, invalidation and scoped transport lifecycle form one testable interface. React adapts subscription state and display; server observation and browser admission retain their own ownership.
- Preserve durable request identity, queue/steer behavior, reconnect without replay, explicit native Stop, hidden-reasoning exclusion and controller authorization. Document the supported A2UI publication/navigation contract and verify it through a standard AG-UI consumer and the real native workspace journey.

## Capabilities

### New Capabilities

- `native-agent-transport`: Standard AG-UI observation and admission of an existing native session, including streaming identity, failure, reconnect, cancellation and bounded presentation references.

### Modified Capabilities

- `work-visibility`: Correct per-widget snapshot selection, page-independent live references, explicit binding coverage, scoped refresh and complete browser recovery sequences.
- `report-template`: Freeze exact live/snapshot bindings and coverage; preserve immutable file identity, occupied destinations and crash recovery through shared file mechanics while retaining publication authority.

## Impact

- Runtime: `src/web/{agent,backend,transcript,change-scopes,render-tool,surface-publications,protocol,server}.ts`, native admission integration, visibility summary reads and `src/workflow/{report-files,report-documents,report-exports,visual-reports}.ts`.
- Shared contracts and presentation: surface/report coverage codecs, `packages/presentation/src/{surfaces,work-widgets,report-document}.tsx`, and app attachment/query bindings.
- Browser observation: `apps/web/src/workspace-state/observation.ts`, a host-independent observation module beside it, and `packages/contracts/src/web/observation.ts` ordering rules.
- Tests: existing fast projection/agent/catalog suites, publication/report unit suites, HTTP integration, A2UI browser rendering and disposable native workspace/report journeys. Update workspace/API/report/verification documentation alongside each change.
- Retain pinned OpenCode 2.3.0, AG-UI 1.0.4, CopilotKit 1.88.0 and A2UI 0.15.0 unless implementation proves a specific incompatible upstream contract. No new service, package or upstream OpenCode fork is needed.

## Scope and Choices

### Concentrate complete protocols, starting with report files

The supplied architecture report (`/tmp/architecture-review-20261116-163029.html`) surveyed all five workspaces and ranked immutable report files Strong, followed by assignment discovery, response-only reminder recovery and workspace observation as Worth exploring. Its tests were inspected, not run, and these rankings are design evidence rather than newly demonstrated production defects. The relevant source paths below retain the evidence even if that temporary report is removed.

`workflow/report-files.ts` currently exposes only exclusive staging writes and linking; `ReportDocuments.content/publish` and `ReportExports.verified/create` still repeat the sequence of containment, regular-file/symlink checks, bounded reads, hash/byte verification, occupied-path handling and staging cleanup. Deepen that existing internal module first. A caller supplies an owned destination, expected content identity and content or retained staging evidence; the module owns the filesystem sequence and returns verified file facts. Avoid requiring callers to separately call path validation, hashing, linking and verification in a particular order.

Keep the live filesystem adapter and use owned temporary directories to exercise the same interface as production callers. Reconcile an occupied destination only when its validated bytes match the expected identity; preserve conflicting bytes, symlinks, unrelated resources and uncertain retained evidence. Handle interrupted staging and publication inside this protocol. JSON and HTML owners still choose their authorized destination and format/size policy, hold existing locks, validate document/export meaning, enforce current generation and persist their own receipts. File success is not permission to publish a domain receipt. Export HTML and its receipt file retain their existing ordered recovery semantics; do not imply a new atomic multi-file transaction. Compatibility support must accept existing retained staging evidence without rewriting records or changing cleanup ordering relative to the owner's durable receipt.

Share physical file facts, not publication policy: no generic workflow engine, new store, authority cache or second report lifecycle. Start with canonical JSON and derived HTML export files (including export receipt-file mechanics); legacy research Markdown and legacy HTML remain on their existing paths unless separate evidence establishes compatible semantics.

### Acceptance criteria for useful depth

Every in-scope refactor must demonstrate: (1) less caller knowledge, by recording and removing duplicated ordering rules and retained-field interpretation from its real callers; (2) more locality, by concentrating each shared invariant in one implementation; and (3) behavioral tests crossing the same interface callers use for success, conflict and recovery. A new wrapper around the old steps, shorter files or extra mocks do not establish these gains. Replace duplicated low-level tests only where stronger shared-interface coverage subsumes them; retain distinct JSON/HTML receipt and controller scenarios. After the report-file refactor, record the before/after caller responsibilities and test evidence before proceeding to the broader extraction.

### Binding selection and coverage

Introduce one shared binding-requirements calculation, grouping work widgets by live/snapshot mode, explicit IDs and unfiltered selection. Navigation references validate ownership but never narrow another widget. Within each existing 100-row binding budget, reserve rows for explicitly selected tasks, then fill remaining capacity deterministically from the bounded unfiltered population. Every widget filters its own input; total/returned/unavailable/truncated coverage remains distinct. Over-budget explicit requirements are refused before publication rather than silently dropped. Unfiltered coverage includes the documented population even when only a closed-history page is loaded.

Retained surface coverage belongs to captured data. Current live coverage belongs to a transient read result. Add a fixed batch summary read for at most 100 deduplicated issue IDs, using task-scoped retained reads rather than fleet readiness, worker transcripts or full planning details. The app shares that read across mounted references, invalidates affected IDs and rejects late responses from an obsolete surface/selection. Presentation remains data-only; saved/offline viewers never fetch. On refresh failure preserve last valid rows and label them stale; an unresolved explicit reference is unavailable, not a successful zero.

New surface/document records carry additive optional coverage evidence with explicit readers. Existing immutable records and hashes are never rewritten. Legacy records without coverage say coverage is unknown; they cannot acquire missing historical tasks from current work. Saving resolves current live bindings independently and keeps original snapshot bindings separate. A save that cannot resolve a required explicit task fails without publishing a misleading report or replacing an earlier artifact. A saved unfiltered binding may be bounded only with an explicit limitation.

### Native adapter ownership and streaming

Extract the native session source and AG-UI projection into `packages/runtime/src/opencode/agui/` (an internal module, not a separately published package). Its caller supplies the authorized session, durable admission/receipt/Stop operations and scoped native observations. It must be usable without a workspace snapshot, router, task finder or report exporter. The existing web module composes application state and presentation references; the existing CopilotKit runtime continues hosting the same fixed routes. Do not add another network hop or history store.

Map the installed `@opencode/schema/session-event` text start/delta/end and tool input/called/success/failed events to standard AG-UI events. Retain native call IDs and the stable derived display-segment provenance needed for text/tool interleaving. Validate bounded observable arguments/results; limited or structurally incompatible history uses an explicit complete projection rather than malformed argument deltas. Baseline reads repair gaps/restart; a baseline replacing an in-flight stream resets its projection cursor so updates are neither duplicated nor lost. Hidden reasoning and provider replay remain excluded.

One scoped native subscription and one bounded fallback coordinator serve observation consumers. Separate native message events from application state updates so the same transcript is not emitted by both owners. Transport run IDs correlate requests; they do not replace native message/admission identities. Completion/error must be correlated to the admitted native input, not an unrelated session idle transition. Known native failure produces a bounded run error; failed tool observations remain tool failures when native execution continues. Uncertain admission remains uncertain and never automatically resends. Disconnect releases only observer resources; current-turn Stop stays explicit and historical-run Stop remains refused. Preserve middleware/configuration across agent cloning.

### Browser observation owns ordering and recovery together

The current `observationDecision` comparator handles pairwise order while `apps/web/src/workspace-state/observation.ts` coordinates latest state, retired epochs, refresh/recovery, invalidation, reconnect and teardown. Deepen this browser module around the complete observation lifetime. Its small caller interface accepts transport/baseline and invalidation adapters, exposes current observation/connection state, supports explicit refresh and subscription, and disposes owned work. Validation, epoch/order acceptance, stale/retired input handling, coalesced recovery, selective invalidation and cancellation remain internal. Reuse existing contracts and Effect/query integration rather than introducing a second cache or controller truth.

Keep native server fallback and backend event projection independent; browser observation must not start a second polling loop or resubmit inputs. Drafts, admission/receipt reconciliation, transcript history and navigation stay outside this module. One refresh/recovery path handles both explicit refresh and event-driven baseline repair. Use a controlled transport and clock at this internal seam to test complete sequences: epoch replacement followed by an old baseline, overlapping refresh/recovery, missed events, unavailable baselines, selection invalidation and disposal with pending work. Preserve real-browser recovery tests as integration proof; comparator-only tests cannot establish the whole protocol. Land this module before incremental native streaming changes so both sources of ordering complexity have clear owners.

### A2UI contract and compatibility

Keep complete validated A2UI 1.0 surface revisions, immutable native message/call associations and exact revision reads. Typed task/session/decision/changes/artifact navigation stays read-only; approvals and permissions stay on bound native forms. Automatic A2UI tool injection, arbitrary agent callbacks, generated executable code and a second model loop remain out of scope. Document that the custom publication contract does not advertise generic `a2ui_operations` or `forwardedProps.a2uiAction` support. The adapter's standard-consumer proof targets the current authorized AG-UI endpoint and does not expand raw native API access.

### Existing planning and rollout

`make-chat-the-primary-workspace` is implemented but its `chat-workspace` and canonical-document deltas are not yet in main specs. This proposal extends those semantics through focused additions to existing capabilities; it does not reintroduce manual template authoring or rewrite that change. Recheck overlap before sync/archive and retain both sets of requirements. This planning request creates no execution, approval, delivery or issue-lifecycle authority.

Implement and prove immutable report files first, then the binding fixes and exact saved values, browser observation deepening, backend adapter extraction, incremental native streaming and integrated proof. Preserve the existing durability/use-case decisions in `docs/architecture.md`, the uncommitted implementation and controller-owned gates. The main risks are altered retained hashes or staging recovery, policy accidentally moving into shared mechanics, false empty counts, unbounded reads, duplicate streaming output and confusing observer cancellation with native Stop.

### Follow-up candidates informed by the first refactor

Worker assignment discovery is the next candidate to explore after report-file gains are demonstrated. `worker-assignment.ts`, `Queries.assignment`, guard role lookup and obligation/check/report callers repeat current, intended and historical assignment interpretation. Explore a pure discovery/classification interface over fresh retained observations with a matrix for intent, history, changed role and stale generation. Existing controller entry points retain permission, phase and generation decisions; historical membership never grants active-worker authority. Do not create a new assignment index or cached authorization.

Response-only reminder recovery remains a later bounded candidate. `messages.ts` and `leads.ts` repeat classification, reservation, native admission and reconciliation while sharing only fragments. A possible shared protocol owns reminder identity and uncertain admission; worker generation/capacity/stop and lead registration/revision/budget policies stay with their existing owners. An absent prompt after uncertain admission stays uncertain; a reminder cannot retry substantive work or grant approval. These two candidates are recorded follow-ups, not implementation commitments in this change. Use the first refactor's caller-knowledge, locality and behavioral-test evidence to decide whether a separate exploration/change is justified.
