# AbraCode workspace

For development, run:

```sh
pnpm dev
```

Open `http://127.0.0.1:5173`. Vite serves the TanStack Router frontend and React Fast Refresh preserves component state. `tsx watch` restarts the Effect HTTP adapter when backend source changes. The native OpenCode service and its work stay independently owned; ordinary HTTP reloads reuse its existing Abra session. Changes to code loaded inside the native plugin require its normal controlled service restart.

Use `pnpm dev --port 5174 --backend-port 4099` to change the frontend/backend ports. The Vite proxy validates the browser's exact origin before translating it to the private backend origin. Ctrl+C stops both development servers and preserves native work. No work-item path was added: the current workspace is the TanStack Router index route.

Build and open the single-session frontend from the installation root:

```sh
pnpm web:build
pnpm web
```

The default URL is `http://127.0.0.1:4097`. `pnpm web --port 4098 --no-open` selects another port and prints its URL. Keep the foreground process open. Closing a tab detaches its observer; stopping this process closes its listener and streams. Native Abra, workers, worktrees and work history continue in the existing background service. Provider login remains `pnpm auth`. The frontend uses the existing session's model and existing worker configuration, with no additional model configuration or CopilotKit account.

The workspace contains one Abra conversation, project/work navigation, attention forms and permissions, generated work views, and a read-only work inspector. All instructions, including worker instructions and work-control requests, go through Abra. Work-control buttons fill a request in the main composer; sending it queues a normal native input. Stop current Abra turn is distinct from Pause work. Native OpenCode cannot stop an arbitrarily selected historical run, so the adapter refuses that operation.

## State and transport

`apps/web` uses the CopilotKit **v2** React API. `src/web/agent.ts` implements its custom `AbstractAgent` and `AgentRunner`; `src/web/server.ts` preserves CopilotKit's v2 Fetch handler and AG-UI wire protocol. The only advertised runtime agent is `abra`; its thread is the installation's retained native supervisor ID. Run input contributes one text message, never a replayed transcript or client-supplied model, tools, role or location.

The loopback server uses pinned **Effect 4.1.4** `NodeHttpServer`, `HttpRouter`, `HttpApiBuilder` and shared `HttpApi` contracts. The browser uses `HttpApiClient` behind the small Promise adapter in `apps/web/src/api.ts`. Payload/query schemas, responses and typed operation errors are shared. `src/web/wire.ts` owns browser data projections and imports no controller or Node adapters. Native reads and submissions still cross the existing authenticated OpenCode plugin RPC boundary; this adds no browser RPC protocol.

Observers are scoped Effect streams, coalesced through bounded PubSubs with a five-second snapshot fallback. Unsubscribing AG-UI interrupts the observer fiber. HTTP request scopes abort the Fetch/response stream on disconnect. Native admission masks interruption only inside the short locked persist/admit/persist operation; observing a turn never owns that turn's lifetime.

A stable browser submission ID binds exact text and queue/steer mode. Plugin storage retains its native message ID before admission. Identical retries reuse that receipt; changed input under the same ID fails. A lost response is reconciled against native inbox/history, including exact message lookup across compaction. Absence remains uncertain and does not cause automatic replay. Admission is separate from native execution and controller work completion. The frontend persists only an outstanding submission identity/input for recovery, not a second conversation database.

History is paginated using native identities. The backend accepts only cursors it issued for this session. Existing native text/tool observations are projected explicitly; provider replay blobs and hidden reasoning never enter the browser. Terminal/controller-originated turns appear through the same observation path.

## Boundaries and decisions

Exact Host and Origin checks precede routing. Safe GETs can omit Origin; mutations require the exact frontend Origin. Other local ports, cross-origin requests, encoded paths, raw native APIs, generic proxying and WebSocket forwarding are excluded. Credentials remain in the native client on the server. This is a local single-operator interface, not a remotely authenticated service.

The attention dock renders native string, choice, numeric, integer, boolean, multiselect and external fields, including conditions, required fields, defaults and hidden defaults. A reply carries the observed form binding. The server re-reads the form and controller checkpoint, checks exact approval fingerprints or decision/finishing identities and rejects stale/cancelled/conflicting input. Native/controller checks remain authoritative. Permission choices remain separate: once, always or reject. Generated views cannot create approvals.

## A2UI v1 catalog

The supervisor-only `abra_render_ui` tool publishes **A2UI 1.0** `createSurface` messages with inline components and `id: "root"`, using catalog ID `https://abracode.local/catalog/v1`. This is a closed custom catalog, following the [v1 protocol](https://a2ui.org/specification/v1.0/schemas/); catalog identifiers are identifiers, not fetched URLs.

The catalog supports Column, Row, Text, WorkTable, StatusSummary, Kanban, DependencyGraph, Timeline, DecisionSummary and ReportLink. Layout references use the v1 flat component adjacency list. Work references bind existing issue IDs. Views use live read-model data or a clearly labelled retained snapshot. Selection and report links open the inspector. Complete revisions replace a prior retained surface atomically after validation. Catalog IDs, size, depth, component identities, cycles and work references are bounded; HTML, executable callbacks, arbitrary URLs and approval components are rejected. The model receives the tool's concrete schema/catalog instructions; no browser component is injected into its native tool loop.

Reports reuse existing retained Markdown and visual-artifact receipts. Visual reads validate the existing owned path, regular-file/containment rules, digest and byte count. HTML previews use an opaque iframe and a CSP that disallows network access, form submission, embedding and app-origin access. Downloads are explicit attachments. There is no general file-serving or artifact-editing API.

The built frontend carries supplier attributions and full retained terms in `THIRD_PARTY_NOTICES.txt`. Build scripts produce this file from the frozen license inventory.

## Verification

Use `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, `pnpm config:schema` and `pnpm licenses:check`. The source-install journey builds the frontend offline, opens it in Chromium, tests native form types, controller-binding rejection, reload and native-service restart, and proves frontend shutdown preserves native service/session ownership. Focused transport tests cover typed clients/errors, origin/path isolation, AG-UI identity/retries, disconnect interruption, and report sandbox/download headers. Admission tests cover simultaneous tabs and response-loss recovery.

See [the verification recipe](verification/README.md). Browser fixtures and native deterministic-provider journeys prove their stated behavior, not autonomous model quality or live remote delivery.

## Recorded acceptance

Local acceptance on 2026-11-15 passed `pnpm check`, `pnpm test` (500 tests in 79 files), `pnpm test:e2e` (5 tests in 3 files, 433.54 seconds), build, schema generation, dependency-peer validation, license checks and diff checks. The browser coding journey registered a project, created work, rendered A2UI v1, answered plan approval and completed implementation, independent Review and preserved branch delivery through the main interface. The development journey observed React HMR preserving a draft, an Effect backend reload and the same native session after development-server shutdown.

Retained evidence is under `/tmp/abra-copilotkit-verified`, outside disposable installations. Native, workspace and reply-recovery JSON record a pass and completed cleanup; `development.json` records both reload paths and session preservation. Screenshots and command logs survive teardown. A read-only browser check also loaded the operator's existing Abra session and current model without browser errors.

Initial full runs exposed timing assumptions in the existing native fixture. Pause now waits for confirmed native quiescence. Lead routing waits for earlier management attention to settle and uses the supported finite five-turn allowance for three lead requests plus concurrent central attention. The final run recorded three lead turns and four shared management turns within that allowance. Production defaults and controller gates are unchanged; earlier failed logs are retained alongside final proof.
