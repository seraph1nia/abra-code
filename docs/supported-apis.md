# Supported APIs and environment evidence

Updated on 2026-11-19. AbraCode installs a local pinned runtime rather than upgrading the user's global binary. Dated subsections below retain their original version-specific evidence; the current upgrade is described in [the dependency and adoption report](opencode-update-2026-11-15.md).

| Component          | Supported version             | Verified interface                                                                                                                                                                    |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenCode CLI       | 2.3.0                         | `serve`, `service`, `--server`, `--session`, `pair`, `api`, `auth login`                                                                                                              |
| `@opencode/plugin` | 2.3.0                         | Effect `Plugin.define({ id, effect(ctx) })`; scoped transforms, hooks and RPC registrations                                                                                           |
| `@opencode/client` | 2.3.0                         | Effect `OpenCode.make`, native `Service.ensure/discover/stop/headers`, branded location and form APIs                                                                                 |
| Work graph         | Node built-in SQLite          | `DatabaseSync`, scoped connections, SQL transactions, WAL, foreign keys, guarded ownership and unique request IDs                                                                     |
| OpenSpec           | 2.0.0                         | `init --tools none`, `new change --json`, status, instructions, strict validation, JSON archive                                                                                       |
| Git                | tested 2.56.0                 | `GIT_OPTIONAL_LOCKS=0` and `diff.autoRefreshIndex=false` for observer index refresh, argument-array invocation, detached native worktrees, issue branches, clean retirement, ancestry |
| Node / fs-ext      | tested 26.13.0 / fs-ext 2.1.1 | Runtime and single-host kernel advisory locks                                                                                                                                         |
| GitHub CLI         | tested CLI 2.102.0            | PR JSON, CI/review status, merge head guard                                                                                                                                           |

The pinned visibility RPC exposes `overview({ issue_id })` for ticket status, description, supervision, blockers and outcomes. Its HTTP counterpart is `GET /api/work/overview`. The existing `detail` method also reads planning evidence.

The planning observer uses Git's `rev-parse --verify --end-of-options`, literal-path `ls-tree -r -z` and `cat-file -s/blob` against the retained delivered commit after registered repository validation. Only regular Markdown blobs under the exact retained change archive are admitted; symbolic links and current checkout replacements are excluded. This is a read-only Git projection, not an OpenCode archive API.

## OpenCode contracts

Kernel locks use [`fs-ext` 2.1.1](https://github.com/baudehlo/node-fs-ext)
`flockSync(fd, "shnb" | "exnb")` against a scoped Node file descriptor. Both Linux
and [macOS](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/flock.2.html)
provide the underlying shared/exclusive kernel locks. Only nonblocking syscalls
run synchronously; contended acquisition retries with interruptible Effect sleeps
until the configured deadline. Contention remains `LOCKED`; other native lock
errors remain `LOCK_ERROR`. Closing the descriptor or process death releases
ownership without stale-lock recovery. Lock paths are never unlinked.
Node callers hold the descriptor directly. OpenCode 2.3.0 embeds Bun: a real
native-workspace contention attempt with an in-host binding failed on the missing
`node::ErrnoException` symbol. That host therefore runs the binding in a scoped
Node helper, resolving `node` from PATH or the explicit `ABRACODE_NODE_BINARY`
override. The helper announces ownership over stdout and retains it until stdin
EOF or termination; parent death releases ownership without a lease. It uses the
same nonblocking modes and bounded retries. The util-linux command is unnecessary.
The binding builds through `node-gyp`; the helper's Node ABI must match that build.
Compilation and both host paths are regression-tested locally on Linux with Node
26.13.0; full macOS application acceptance is unverified.

The retained-read boundary uses shared locks for bounded concurrent captures
against the existing exclusive controller lock. Independent-process tests verify
shared coexistence, exclusive writer refusal/release, owner SIGKILL recovery,
bounded waits and cancellation. In-process coordination tests reject read-to-write
upgrades. SQLite's committed work-event sequence validates graph capture without
a writer transaction or schema change; native session observations run afterward.
This adds no native storage CAS or transaction guarantee. See [the refactor
evidence](verification/runtime-refactor.md) for the earlier command-backed results.

The work finder uses Node's supported [`DatabaseSync.function`](https://nodejs.org/api/sqlite.html#databasefunctionname-options-fn)
for Unicode lowercase matching, plus
SQLite `json_each` for parameterized dependency/request batches. Bounded row
selection and counts remain SQL operations inside the read transaction. No
extension loading or arbitrary SQL endpoint is added.

### A2UI and AG-UI web boundary

The web integration pins `@a2ui/web_core` and `@a2ui/react` 0.15.0. Custom props are authored in Effect 4.1.4 and exported through `Schema.toJsonSchemaDocument`; `Catalog.fromJson` derives SDK models from that generated document. Upstream layout/text schemas, `PayloadValidator`, `MessageProcessor` and the React surface renderer own protocol behavior. Application publication remains complete, bounded surface revisions rather than arbitrary renderer functions or interactive forms.

AG-UI 1.0.4 standard types and `@ag-ui/core/schemas` validators own protocol envelopes. Shared Effect contracts validate native web RPC outputs, workspace snapshots and nested surfaces. CopilotKit 1.88.0 remains a mounted Fetch/AG-UI adapter on the Effect server, with automatic A2UI tool injection disabled. `COPILOTKIT_TELEMETRY_DISABLED=true` is set before runtime initialization and included in development/browser configuration. The React renderer's dependency on `@a2ui/markdown-it` 0.2.2 retains an outdated `^0.14.0` core peer range; the narrow workspace peer exception selects the renderer's 0.15.0 core and is covered by browser acceptance.

The worker transcript reader reuses the same supported native `message.list` API with a limit of eight, descending order only for the first page, and the returned cursor for subsequent pages. Every page first resolves the exact session against retained issue ownership through the authenticated web gateway. Cursor bindings are local to the issue/session and bounded to 500; an unknown or foreign cursor is refused. The disposable workspace journey verifies real history after worktree retirement, optional earlier pages, foreign-session refusal and forged-cursor refusal without tool replay.

### Single-session workspace transport

The additive `abracode-web.receipt` RPC takes a validated `session_id` and browser
`request_id`, validates the retained central Abra session, and returns one
validated retained receipt or `null`. The browser-facing typed GET
`/api/admission/receipt` accepts only `request_id`; it cannot select a session or
native operation. Lookup never calls native prompt/admission recovery. The
recent `receipts` operation remains a time/identity-ordered display window of
100 entries. Unit and HTTP tests cover missing, uncertain, conflicting and
unsafe identities. Browser/admission regressions cover receipts beyond the
recent-history window, lost receipt reads, two tabs, replay refusal and foreign
sessions. The disposable native workspace journey keeps one actual admission
and verifies its exact receipt survives restart. See [refactor evidence](verification/runtime-refactor.md).

The frontend uses CopilotKit 1.88.0's **v2** exports (`@copilotkit/react-core/v2`, `@copilotkit/runtime/v2`) with AG-UI 1.0.4. The custom native-backed `AbstractAgent` and `AgentRunner` implement run/connect/isRunning/stop. No default model runner, thread store, Mastra or additional agent harness is used. The pinned OpenCode interrupt API cannot select an expected run ID; run-specific stop is explicitly refused.

Effect **4.1.4** HTTP APIs are pinned with `@effect/platform-node` 4.1.4. Local declaration/source evidence: `effect/http-api` HttpApi, HttpApiEndpoint, HttpApiBuilder, HttpApiClient; `effect/http` HttpRouter and HttpServerResponse.fromWeb; `NodeHttpServer.make` and its request-scope interruption semantics. Shared contracts set Effect HttpApi query/payload parse options explicitly to preserve strict validation. CopilotKit's Fetch handler and AG-UI protocol remain intact behind the fixed route allowlist. Native data continues through `@opencode/client/effect` and the `abracode-web`/existing visibility plugin RPCs. Request cancellation detaches streams; only native admission's durable critical section masks interruption.

Generated work views use **A2UI v1.0**, including inline components on `createSurface`, the flat component-ID adjacency list and a closed local catalog. The [official schema](https://a2ui.org/specification/v1.0/schemas/) is the protocol reference. The renderer implements this bounded catalog directly; CopilotKit's automatic prompt/middleware UI generation is disabled. Schema 0.9 messages and executable/custom remote components are rejected.

Native session.message.get, paginated message.list, inbox observation, current form detail/reply and permission request/reply remain the authority for browser interactions. Form presentation no longer depends on OpenCode's generic web dock or a synthetic MCP tag. Controller exact fingerprints/decision identities are re-read before settlement. Retained visual reports reuse their existing receipt/containment/hash checks.

The fixed read-only visibility `leads` RPC projects native management observations by exactly one task/repository scope. It retains disabled or changed-scope history through request/proposal/accepted-work ownership and omits native replay prompts. Compact lead attention reuses the original management scan, while full bodies remain lazy HTTP reads. Installed `@opencode/client` 2.3.0 exposes `permission.create/list/get/reply`; create returns the request identity and evaluated effect (`ask` for a human decision). The browser sends only once/always/reject after a current request-binding check. No browser permission proxy or worker control is introduced.

The fixed web RPC `saveSurface` publishes an explicitly requested report through the existing report owner after Supervisor and current source-revision checks. Its input grants no form, worker or work-control capability. Exact JSON reads/downloads require task/request/hash and the same owned-path/receipt checks as retained HTML. Native `session.synthetic` can wake the provider: browser saves therefore attach to the original native message/call through plugin presentation records instead of issuing a synthetic completion notice. The disposable workspace journey asserts an unchanged provider-request count across save/open/reload, stale-revision refusal, exact JSON download and reopen after retirement. Composed report tools pass their actual native context identity to the artifact owner; generated props never supply it.

Pinned CopilotKit 1.88.0 v2 `useRenderTool` registers presentation without a frontend handler; `useRenderToolCall` consumes an existing AG-UI call and optional result. Local declaration/source evidence is `dist/v2/headless.mjs` and its shared declarations. Native call state is carried separately from CopilotKit's browser-execution status. OpenCode assistant content is projected as ordered visible text/tool parts, excluding reasoning/native replay. Because standard AG-UI assistant messages place text before calls, a native message is split into stable display segments: the first retains its original ID, and derived segments/results retain explicit original-message metadata. Tool-call IDs are unchanged. `web-transcript.test.ts` validates streamed/failed/history identities and standard envelopes; the disposable native workspace journey verifies a real typed card, read-only inspection without another prompt, CopilotKit rendering and reload under the same identities. No browser tool execution, A2UI middleware or provider replay is involved.

The native web gateway also exposes exact `surface` reads and bounded `presentations` references for requested native message pages. The browser receives these through fixed Effect HTTP routes/history rather than a generic native proxy. New layout publications retain message/call identity, record/input hashes and immutable revision indexes; current-session startup repairs their pending publication metadata without a provider turn. Report completion uses its retained native notice ID and the shared presentation-association owner. Reads isolate malformed associations as message-local diagnostics and preserve unsupported records. Proof: `surface-publications.test.ts` exercises interruption after each storage boundary, conflicting retries, legacy history limits and integrity/ownership refusal; `presentation-associations.test.ts` and `report-artifacts.test.ts` cover scoped references, local diagnostics and notice-response recovery. Browser/native workspace journeys cover exact older/newer layouts in one retained conversation with no tool replay.

See [workspace architecture](web-workspace.md) and [verification](verification/README.md) for the current boundary and proof limits.

The browser-safe observation boundary now shares `visibility/work-summary.ts`, native obligation/communication/feedback schemas, data-only delivery contracts and the native session observation contract. The visibility RPC's bounded `find` method backs `/api/work/find`; search filters precede pagination (1–50 rows), fleet counts remain population-based and attention declares its 100-item coverage. The native web gateway's `resolve` method backs `/api/work/resolve`, checking task/session/decision/artifact ownership without loading bodies or admitting prompts. Resource targets use a closed schema; Standard Schema inputs and HTTP parse options reject unknown fields explicitly. Exact artifact navigation binds request ID plus content hash. Local proof: `web-wire.test.ts`, `web-resources.test.ts`, `work-discovery.test.ts`, `work-attention.test.ts`, `visibility.test.ts` and `web-workspace.test.ts` cover codec limits, ownership, pagination, unresolved attention and origin/path/native-route isolation. These transport tests do not claim completion of the broader chat-primary acceptance journey.

### Scoped communication observation

The adapter's `promptAdmissions` batches existing public inbox/context reads for
retained identities and uses exact-message lookup only outside that context.
It verifies exact text and absence of attachments for every observed identity.
The single-request method uses the same implementation. A native session
observation includes the current inbox IDs so answered history can skip transport
reads while a queued resolved input still receives same-ID reconciliation.
These projections are transient, never persisted as authority. Message
reconciliation invalidates its local observations after prompt/wake/recovery;
the worker's independent execution observation still governs capacity and gates.

### Follow-up outcome and restart reconciliation

Rechecked against the pinned 2.0.28 installed declarations and embedded
`SessionHistory`, `SessionStore.context/messages` and inbox implementations on
2026-10-18. Native context starts at the latest completed compaction, so it is
not a complete admission ledger. The client supports
`session.message.get({sessionID,messageID})` for an exact retained ID and
`message.list({sessionID,limit,order,cursor})` for bounded historical observations.
The server rejects `order` together with a cursor: pass `order:"desc"` only on
the first page, then use the server-issued cursor without `order`. No private
cursor is constructed. The real-server fixture exercises both calls.

The adapter binds a worker assignment's outcome to its native input, rather
than attributing a later follow-up's success to it. Native continuation after
restart can update the outcome without another input. Historical fallback is
bounded to 20 pages of 200 messages and retains no transcript; missing evidence
does not establish success.

The same bounded observation can bind an exact controller request input to its
subsequent native idle marker, exposing only that marker's ID and creation time
as `assignment.completion`. Missing-response classification requires consumed
input, this bound successful completion, no active execution or pending inbox,
and a successful current native outcome. A session-level success alone is
insufficient. `response-recovery.test.ts` exercises the adapter with idle-before-
input, missing history, duplicate idle markers and failed/empty-success ordering.

These APIs are separate reads, not an atomic native snapshot. Context can already
contain a newly consumed input when the earlier active/inbox reads were empty,
or contain its completion when the earlier session outcome was still absent.
The adapter exposes transient `completion_pending` when input/assistant context
after the last idle is not covered by the server-owned `Session.Info.time.idle`.
This preserves capacity and the response obligation without spending diagnostics
or admitting a new reminder. It does not fabricate an active native execution:
explicit stop and an authorized same-ID queued wake still use actual native
activity. A strictly later native idle timestamp also proves a stopped turn when
no idle context message was retained. A newer contextual idle can supersede an
older session snapshot; an adjacent empty success does not erase a failed turn.
The native-adapter race regression and disposable crash-window journey exercise
both observations and stop/restart behavior. This projection is neither stored
nor an authorization source.

The disposable provider-failure trace at
`/tmp/abra-message-recovery-native4-20261018/native-engineering.json` records a
failed idle marker followed five milliseconds later by a succeeded idle marker,
without an intervening input or assistant message. Native `Session.Info.outcome`
then reports succeeded. AbraCode preserves the failed turn in this case: an empty
success marker does not demonstrate recovery. A subsequent input or actual
assistant execution followed by success can establish a later successful turn.
Several inputs before one idle belong to that native turn; a failure cannot be
causally assigned to one of those texts from the native event alone. Original
assignment attribution and correlated unanswered requests remain separate.

Queue reconciliation never wakes failed or interrupted native execution; those
outcomes require the existing explicit recovery policy. A same-ID wake is only
for an otherwise eligible native queue, not permission to retry a failed turn.

A real queued-request restart passed in 97.11 seconds at
`/tmp/abra-queued-restart5-20261018` with cleaned disposable resources and retained
`native-engineering.json`. An idle native session with a verified queued request
needed a wake: resubmitting that **same** native ID and exact retained payload
wakes the native queue without another instruction. AbraCode revalidates current
assignment ownership before this replay. Absent or unavailable admission evidence
never authorizes a replacement ID. See the [messaging recipe](verification/features/messaging.md)
for the broader failure/reply acceptance results.

### Prompt admission and replay audit

Inspected on 2026-10-18 against installed 2.0.28 declarations and the executable.
`@opencode/client/dist/effect/api/api.d.ts` declares prompt ID, text, attachments,
metadata, queue/steer and resume, returning `SessionInbox.User`.
`@opencode/plugin/dist/effect/session.d.ts` declares the prompt hook; inbox
list/cancel/update are client operations absent from plugin SessionDomain.

Installed `@opencode/cli/bin/opencode.exe` SHA-256:
`20d305d0140bfe04df7264a4ecb014402b74b6ac0a0f6456ee07ef3325fb4a85`.
Its embedded `Session.prompt`, `SessionPrompt.prepare`, `SessionInbox.make` and
inbox projection implementations show: reconcile an existing ID first; otherwise
run the prompt hook, materialize attachments and admit; then wake unless
`resume:false`. Reconciliation precedes the hook and does not compare newly
submitted text. A plugin cannot promise rejection of every conflicting native
replay request. The original native payload remains authoritative.

The real-server [steering audit](verification/features/steering.md) observed the
pre-fix controller steering refusal and successful duplicate-ID return of the
original payload with zero provider work for the changed text. The user accepted
native idempotent replay with controller-level conflict refusal. This does not
authorize a new instruction. The first positive focused native journey then
passed in 100.62 seconds with one retained steering instruction despite a retry,
unchanged assignment/session identity and zero forged-prompt provider calls.
Evidence: `/tmp/abra-steering-after-20261018/native-engineering.json` and its
sibling log; cleanup completed. The extended queued-pause/full suite is separate.

Inbox projections delete queued records on delivery/cancellation; cancellation
cannot undo consumption. Changing an item to steer wakes execution. Source
inspection does not establish crash-window guarantees: busy queue consumption,
cancel/consume races, uncertain admission and queued restart require specific
native acceptance evidence before messaging is enabled.

### Existing native integration contracts

The code type-checks against installed published declarations. Official [v2 plugin documentation](https://dev.opencode.ai/v2/docs/build/plugins/) and [migration documentation](https://dev.opencode.ai/v2/docs/build/plugins/migrate-v1) describe the public API. Additional behaviors were verified against the [2.0.28 source tag](https://github.com/anomalyco/opencode/tree/v2.0.28).

- `ctx.storage.get/set/remove/scan` stores JSON under the plugin ID. Scans paginate with `next`/`after`. The source [storage namespace implementation](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/plugin/host.ts) uses the plugin ID, not a repository-specific namespace. There is no public transaction or compare-and-swap method. `fs-ext` kernel locking supplies a small crash-released controller lock and one coordinator leadership lock on Linux and macOS.
- `ctx.worktree.create({ projectID, from, branch, directory, name })` selects the target project's canonical configuration. `directory` is a **parent directory**; `name` is the destination name; `branch` is a **starting ref**, including a full commit SHA. The native end-to-end test verifies SHA provisioning from a managed clone after its remote advances. The [bundled Git implementation](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/git.ts) creates a detached worktree. AbraCode then creates `work/<issue-id>` with Git in that owned worktree. Bare-repository discovery is not part of this verified contract.
- `ctx.worktree.list({ projectID })` returns an array of saved directories. `remove({ projectID, directory, force:false })` uses the recorded native strategy. AbraCode never substitutes force removal or direct Git deletion in production.
- The plugin context does **not** expose location discovery or form APIs. The native client supplies `location.get({location:{directory}})` and `session.form.*` to the same server. This is a native client adapter, not an MCP server or another orchestration framework.
- `ctx.session.create({id, location:{directory}, agent, model, permissions, metadata})` accepts a native generated session ID and returns an existing session for the same ID. This makes uncertain creation retryable. `prompt({sessionID,id,text,delivery:'queue'})` admits a durable inbox item rather than awaiting model completion. The request's cancellation signal is not propagated into this admitted background lifecycle.
- `session.context({sessionID})` provides native assistant/idle structured errors (`type`, `message`, optional `status`), model refs and tool results. The client returns serialized millisecond timestamps; plugin schema DateTime types are not interchangeable with these wire types. Diagnostics summarize this native context and retain failure evidence without reading global log files. `session.switchModel({sessionID,model})` selects the model for subsequent provider turns; the controller uses it before retrying an idle worker. Both contracts are exercised by the real-server provider-failure/retry test.
- Actual interrupt input is `{sessionID,resume:false}`. The published plugin documentation still shows `continue:false` in some examples. The implementation follows the pinned declaration and then waits for native execution to stop.
- `OPENCODE_CONFIG_DIR` selects the native global configuration/discovery directory (confirmed in the installed `@opencode/util/global` implementation). The managed service uses its own directory; the native end-to-end test plants an incompatible plugin in the default global directory and verifies that it is excluded. Native data/auth and the existing Supervisor/session identities are retained.
- Hooks are location-scoped. `OPENCODE_CONFIG` loads the shared plugin at every worker location. Only the exact central directory exposes management tools or runs a monitor/scheduler. Native session permissions plus tool/context hooks prevent inactive or wrong-role native tool calls.
- Native file tools use `path`, and their permission resources are relative inside the session directory. Explore edit permissions use `openspec/changes/<change>/**`; a realpath guard also rejects escaping symlinks and source writes. `write` can create missing parent directories.
- The native editor tool is `patch` with `{patchText}`, not `apply_patch`. The [pinned patch implementation](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/tool/plugin/patch.ts) removes `edit`/`write` for GPT-family models and retains `patch`. AbraCode uses the same pinned `@opencode/util/patch` parser to preflight every affected path and move destination through role, realpath and control-file guards. The native test uses a GPT-family fixture and verifies both scoped planning patches and rejected source edits. Diagnostics retain the post-filter tool names at each worker request.
- Worker events are `session.execution.succeeded`, `.failed`, `.interrupted`, and `session.idle`, with `data.sessionID`. Form replies use `form.replied`. Session `outcome` is execution outcome, not proof of implementation completion.
- The [native form service](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/form.ts) is in-memory. A pending form is recreated on restart with its recorded ID and fingerprint. The plugin persists accepted authorization receipts. A reply lost before receipt persistence must be authorized again.
- In pinned **2.3.0**, `ctx.agent.transform` **can create an absent ID** through `editor.update`. `packages/runtime/tests/integration/native-agent-registration.test.ts` exercises the package adapter against a disposable real service: absent revisioned ID insertion, `system`/description/model/mode/hidden/permissions, no session creation, unrelated-entry preservation and scope disposal. Native appends its browser-deny rules. Native profiles use `system`; legacy host configuration uses `prompt` (not interchangeable fields). Package-owned definitions now register stable central Abra/lead and hidden revisioned workers at worker locations. Session-scoped permissions and runtime guards remain necessary. Legacy captured explicit profiles or implicit `build` selection are not relabeled. Skills use `ctx.skill.transform`; no agent files are copied over repository configuration.

## Terminal observer contracts

The installed `@opencode/plugin@2.0.28` public TUI declarations and [CLI plugin documentation](https://dev.opencode.ai/v2/docs/build/plugins/cli) support `Plugin.define` from `@opencode/plugin/tui`, package export `./tui`, `ui.slot` with `sidebar.content` and `session.panel`, `ui.panel.open`, native session tabs, routing and command layers. `packages/runtime/src/visibility/ui.ts` uses the published OpenTUI JSX runtime with reactive property getters; it requires no custom JSX compiler. The UI uses host theme colors and authenticated `context.client` access, including remote servers.

Issue descriptions and OpenSpec proposals use the installed OpenTUI 0.5.17 `markdown` element with concealed formatting markers and completed (non-streaming) content. `generateSyntax(ctx.theme)` from the pinned `@opencode/theme/tui` supplies host Markdown and code styles. Each mounted document owns its syntax style and releases it on theme changes or unmount. Style changes explicitly request a render because Markdown applies them during its next render pass. The native renderer test checks headings, emphasis, links, lists, code, tables, narrow layouts and live theme updates; it awaits code-renderer highlighting because Tree-sitter runs outside the frame queue.

The pinned OpenTUI `DiffRenderable` supports unified/split views, synchronized scrolling, line numbers, syntax styles and theme diff colors. AbraCode uses this native renderer for ticket-wide patches, with unified fallback below 100 columns. The observer derives comparison identity from the execution's recorded base/worktree or retained delivery commit, rather than a single worker session's diff. Git reads explicitly disable external diff/text conversion, optional locks and index refresh; `--literal-pathspecs` and NUL-delimited statistics preserve filenames. Per-file patches and planning documents are bounded at 64 KiB. Untracked patches use pinned `diff@9.0.0` with a bounded computation time, including files recreated after a staged deletion. Raw Git output preserves trailing whitespace and final newlines. Native renderer tests verify both layouts and narrow fallback; temporary Git fixtures verify committed/local/untracked changes, binary/deleted files, index immutability and retired comparisons.

The read-only `abracode-visibility` RPC uses portable Standard Schema validators and normalizes responses to JSON before returning them: native RPC output rejects explicit `undefined` values. Session activity uses `session.text.delta` and `session.tool.input.started`; creation/execution events trigger snapshot refreshes. The native end-to-end test exercises observer reads in the central location and an owned worker worktree, pending approval, and archived/retired work after server restart.

OpenTUI 0.5.17 native rendering is not supported in this Node 24 runtime. Renderer integration tests reuse the pinned CLI's bundled Bun via `BUN_BE_BUN=1` and `--conditions=browser`, as supported by [Bun's compiled-executable contract](https://bun.sh/docs/bundler/executables#act-as-the-bun-cli). They exercise real terminal layout, clicks, activity updates, read-only worker inspection, unavailable status, proposal selection, narrow widths and cleanup. No separate Bun installation or browser sidebar API is required.

## CLI contracts

The pinned OpenSpec 1.13.2 `update [path]` refreshes configured tool instructions and succeeds without changes when tools are current or none are configured. Its help and installed `dist/core/update.js` confirm that `--json` is unsupported and `--force` is optional. The controller runs plain `update` with the owned worktree as cwd, using the configured pinned executable; it does not upgrade the dependency. Real-CLI integration covers refreshing outdated generated skills before Explore and preserving the registered checkout. Update failures propagate through provisioning recovery. The resulting local preparation commit is retained separately as `openspec_update_commit`; Explore's change-only diff guard uses that baseline, while delivery retains the fetched base and includes the generated changes.

[OpenSpec upstream](https://github.com/Fission-AI/OpenSpec) supplies actual schema discovery. `status` reports `isPlanningComplete`, artifact `status: done`, prerequisites and repository-local action context. `instructions apply` reports task progress and `state: all_done`. Strict validation JSON uses `items[].valid` and `summary.totals.failed`, not a fictional `status: passed` field. `archive --yes --json` moves the active change and updates canonical specs. Canonical specs are validated strictly afterward; new capabilities need a meaningful Purpose (at least 50 characters in the pinned CLI).

Forge automation uses `gh` because the installed `gh-axi` wrapper does not expose JSON output or `--match-head-commit`. Those are needed for machine-checked PR identity and guarded merge. User-facing GitHub operations can still use the wrapper. AbraCode does not invoke production forge operations during tests.

## Effect integration evidence

Effect **4.0.1** matches the pinned OpenCode host. Installed `@opencode/plugin/effect` declarations require an Effect returning `void` with no recoverable setup failure; the entrypoint uses `Effect.orDie` after scoped acquisition. Registrations require the plugin scope and dispose with it. `Layer.build` binds application resources to that host scope; `Effect.provide(layer)` around the finite registration effect would close its database before callbacks run. Native plugin operation errors declared as `unknown` are normalized by the adapter. The Effect client accepts authentication through its supplied `HttpClient`, uses branded schema inputs, and returns decoded `DateTime` values; diagnostics encode transcript schemas to preserve the wire contract. The real native-server test exercises this implementation. See the official [Effect plugin](https://dev.opencode.ai/v2/docs/build/plugins/effect/) and [Effect client](https://dev.opencode.ai/v2/docs/build/client/effect/) documentation.

## Work graph storage

Verified on 2026-10-15 with Node **24.21.0** and the pinned OpenCode CLI’s bundled Bun: `node:sqlite` exposes `DatabaseSync`, prepared queries and `exec` transactions in both runtimes. AbraCode uses this built-in interface without another package. Write transactions use `BEGIN IMMEDIATE`; WAL readers use read transactions. Foreign keys, unique request IDs, full synchronous commits and a busy timeout provide the persistence primitives; Effect scopes own connection cleanup. SQL transactions contain no asynchronous effects. Database schema version 3 upgrades earlier versions transactionally with scoped policy/report references, preserving original request identity, including the early import-receipt table without export evidence, and rejects newer schemas.

The real native-server test exercises issue creation, worker failures, guarded status recovery, dependency closure and restart persistence using this database. See [work graph storage](work-graph.md).

Git observation disables [optional lock-taking sub-operations](https://git-scm.com/docs/git#Documentation/git.txt-codeGITOPTIONALLOCKScode) and [diff index auto-refresh](https://git-scm.com/docs/git-config#Documentation/git-config.txt-diffautoRefreshIndex). Required write locks remain active; the integration test verifies unchanged index bytes after status and fingerprint reads despite changed file timestamps.

## External data contracts

Native worker model references reuse `Model.Ref`; diagnostic error fields derive from `SessionError.Error` while omitting provider response bodies and retaining local refinements. Work intake, normalized creation and saved retry inputs share an owned schema family. `Schema.fromJsonString` combines JSON parsing and consumed-field validation, with synchronous decoding confined to synchronous SQL/normalization boundaries. Independent configuration defaults live in schemas; computed defaults and canonical-path checks remain explicit.

AbraCode timestamps validate UTC instants without rewriting valid historical strings. Generated receipts, work history and fallback observation times use the supplied Effect Clock, including pure constructors invoked from an Effect. Native decoded DateTime values keep their existing wire encoding. JSON normalization deliberately preserves omitted optional keys and additive stored evidence: a direct `toCodecJson` substitution can encode explicit undefined as null and is not compatible with this contract.

CLI JSON enters through `json(runner, schema, ...)`; callers cannot select an unchecked return type. The owning OpenSpec and forge adapters decode consumed identity, readiness and progress fields using Effect 4.0.1 `Schema.decodeUnknownEffect`. Config YAML, local and managed package manifests, generated OpenSpec schema selection and clone intents are decoded before use. Unknown additive upstream fields are accepted; safety fields and count relationships are checked. Malformed JSON/YAML and schema errors identify the source and field with bounded diagnostics, without embedding raw payloads or command environments.

Tool definitions retain each Effect input/result schema and handler type through registration. Native structured `output` and successful JSON content share the schema-defined `{ok:true,result?:...}` envelope. Expected actions fail through native `Tool.Error`, with a safe code and recovery action; guards yield that error rather than throwing it. A no-value success omits `result`. Observer RPC uses portable Standard Schema and JSON normalization. Already decoded native Effect client results retain the upstream schema, branded ID and timestamp contracts. AbraCode aliases native session/message/form/project/provider/model/path brands rather than introducing competing identities. Consumed OpenSpec and forge contracts retain domain brands after decoding; observer responses are JSON-normalized and decoded through their declared schema. No duplicate OpenCode wire schema is introduced.

Plugin record scans now preserve each native storage key and decode each value with its owning schema. The storage adapter exposes unknown input rather than a caller-selected cast. Versioned reads are non-mutating; migrations write originals under the caller's controller coordination lock. `abra_work_list` can explicitly export raw plugin records for backup; the observer exposes only bounded record diagnostics. `pnpm doctor` discovers the existing native service without starting one and reads those diagnostics through the same read-only RPC.

`effect/process/ChildProcess` in 4.0.1 implements the command as a scoped Effect, backed by `ChildProcessSpawner` and `NodeChildProcessSpawner.layer` with Node FileSystem/Path. AbraCode explicitly selects detached process groups, SIGTERM and one-second `forceKillAfter`; it concurrently drains bounded stdout/stderr and waits for exit inside the command scope. This preserves termination-before-return on timeout/interruption in both process-tree tests. Command diagnostics preserve ENOENT compatibility without exposing environments. Thin access/read/realpath operations use Effect FileSystem; Node overloads remain for directory entries and mutations, and only non-cancellable mutations mask interruption until completion.

The native Effect client exposes `session.inbox.list({sessionID})` and `.cancel({sessionID,inboxID})`; plugin `SessionDomain` does not expose inbox methods. Stop confirmation cancels persisted owned assignment and follow-up prompt IDs, uses native `interrupt({resume:false})` and `wait`, and verifies the owned prompts are no longer queued. The finite queued-prompt admission call completes under interruption protection so ownership is not released while local submission is unresolved. The native end-to-end test exercises pause/resume through these APIs before approval and then restarts the service with the same worktree/session/form identities.

Kernel-backed operation locks use an execution-ID hash and nonblocking acquisition outside controller coordination. Short record/claim/reservation commits retain the global lock; native storage still has no CAS/transaction. Independent-process capacity fixtures share atomically published test records and real locks to verify global/repository/role reservation limits. Production keeps native storage as its execution owner.

## GitHub readiness and preservation evidence

[CLI checks](https://cli.github.com/manual/gh_pr_checks) exposes pass/fail/pending/skipping/cancel buckets and documents pending exit 8. Inspection of the tested [CLI 2.102.0 source](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/pr/checks/checks.go) shows JSON export returning before the human-output exit classification; JSON can therefore return zero with pending checks. The adapter decodes buckets, accepts semantic exit 8, and treats transport failures separately. An absent reported-check list is never sufficient to authorize no-check merging.

The [applicable branch-rules endpoint](https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch) returns active rules across repository/organization levels and supports pagination. The adapter combines those rules with [GraphQL branch protection](https://docs.github.com/en/graphql/reference/branches), retaining required context and App database identity. Current-head REST check runs/statuses supply source identities and latest attempts when required contexts or no-check proof need them. `gh pr checks --required` alone cannot enumerate a requirement that never reported. Unknown/inaccessible policy remains unconfirmed. Machine forge commands clear ambient GH_REPO/GH_HOST and verify returned repository identity against configured origin.

[Guarded merge](https://cli.github.com/manual/gh_pr_merge) supports the configured strategy with `--match-head-commit`; no administrator/queue fallback is used. The [merged PR result contract](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request) distinguishes an unmerged test commit from the resulting merged commit, including squash/rebase. AbraCode accepts preservation only for the recorded merged PR/head/target and resulting commit retained by a fresh target fetch; original-head ancestry is required for merge commits. Local bare-remotes and fake forge tests cover each method, deleted source refs, lost responses and rewritten target history.

Native question forms use the pinned Form string field (`type: string`, required, bounded minLength/maxLength). The controller retains form ID/session and decision identity before creation, validates returned answer type/size, and recreates missing pending forms after service restart. This route records a decision answer independently of boolean authorization forms.

Progress observation uses the pinned public `session.text.ended`, `session.tool.success`, `session.tool.failed` and `session.tool.progress` events, then decoded native context. The internal `session.message.content.updated` durable event is absent from the public server manifest and is not subscribed to. A content/tool-state identity advances progress once; busy/idle polling does not. Periodic context observations cover missed public events. Attention uses the same retained native `prompt({id,delivery:queue})` admission contract as workers, separately from synthetic informational notices. The real native fixture covers one failure incident and a retained disposition before normal retry.

Current-head correction evidence uses decoded [submitted PR reviews](https://docs.github.com/en/rest/pulls/reviews), including `commit_id`, reviewer ID, state and body. Later approval/dismissal supersedes an objection; unrelated comments and stale heads do not become correction authority. The controller re-observes exact PR identity/head after reading findings. Policy plus explicit scope classification governs admission, independently of forge prose.

Native session observations include pending durable inbox items when determining busy/quiescent state; a queued writer cannot appear idle merely because it has not begun execution. Attention admission reserves a short coordinated global slot (`attention_capacity`, default 1) until retained disposition. No replacement primary session or background wrapper process is created.

Diagnostic tool authority is bound to native assistant-message provenance: the controller locates the preceding native user prompt and compares its retained attention prompt ID. Diagnostic turns may inspect, resolve declared decisions and invoke the finite correction route; they cannot directly start/resume/steer work, change scope/registration or deliver. Missing provenance fails closed for those actions. A later foreground user turn retains ordinary management authority. Control-generation changes supersede old attention and release its reservation without deleting history. Unit and native fixtures attempt a diagnostic direct retry and verify controller refusal.

### Strict AbraCode tool inputs and progress

The pinned [native tool input-repair hook](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/plugin/tool-input-repair.ts) removes unknown properties from ordinary closed objects before decoding. AbraCode management arguments must retain strict rejection. `tool-definition.ts` uses one portable validator derived from the owning Effect schema and an equivalent composed JSON description (`type: object`, `allOf` containing that schema). The repair hook conservatively leaves this composition intact; the registered validator rejects malformed or extra fields before handler entry. Handlers do not decode again. The real-server test submits invalid model-generated arguments and verifies native failed-tool states and no new issue. Keep this adapter until a pinned native strict-input facility replaces it.

Native `Tool.Context.progress` is captured per call through an Effect Context reference. Setup, verification, delivery, merge and cleanup emit finite milestones; verification additionally emits command counts and throttled stdout/stderr byte counts. Payloads exclude command output, environment and provider content. These ephemeral updates do not alter retained command/worker progress, ownership, heartbeat or authorization. Display failure is best effort and cannot fail a completed mutation; interruption still propagates.

Observer methods declare `not_found`, `resource_unavailable` and `invalid_selection` errors through native RPC factories. Unexpected failures remain internal defects. The `changed` event carries the controller home and optional typed resource scope; its authenticated native event envelope supplies the emitting location. A scoped, coalesced queue receives notifications after SQLite/record commits. Publication waits for the commit lock to release and cannot fail a committed mutation. TUI subscriptions filter by home, reconnect and refresh; periodic reads recover missed events without replay.

Worker preflight reads the assigned worktree's native agent/model inventory before new prompt admission, checking explicit IDs, enabled models, variants and tool capability. The native [agent selection](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/agent.ts) permits an implicit `build` profile without a registry entry, using `Agent.Info.default`; the [session model comparison](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/session/session.ts) treats omitted and `default` variants equivalently. These native defaults remain valid. Missing explicit selections do not cause substitution. Existing inbox/transcript prompt IDs bypass new-inventory validation during admission recovery.

## Report HTML preview

Inspected against the OpenCode **v2.0.28** source tag on 2026-10-16. The [file link handler](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/gui-extensions/src/file/renderer.tsx) resolves agent-referenced file paths and force-reads the selected file into the existing side-panel tab. Eligible desktop HTML can route to the active native browser pane. The [artifact viewer](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/gui-extensions/src/file/artifact-view.tsx) creates a Blob URL and renders HTML in an iframe with `allow-scripts allow-popups allow-forms allow-modals`, without `allow-same-origin`, using a no-referrer policy. This supports a self-contained HTML build without an OpenCode UI dependency or messaging bridge.

The documented handoff format is an absolute-path Markdown file link, using `[Open report](/absolute/exported-report.html)`. Substitute the real installation path. This is a native file preview, not HTML embedded in a chat message. Clients without the graphical viewer can open the file in a browser. `pnpm report:preview` supplies an independent loopback HTTP URL only while the foreground process runs on the serving machine.

Runtime verification: Chrome **155.0.8059.84** successfully opened the built file, the moved offline file, and a Blob iframe reproducing those exact sandbox flags; filtering and disclosures worked with parent access denied. The loopback HTTP route is verified by the build/preview integration test. **No paired OpenCode 2.0.28 graphical session is available to this agent**, so the absolute file link's actual chat click-through and desktop routing have source evidence only, not a passed native GUI acceptance result. No native renderer, host patch, agent transport or controller mutation is added.

## GitHub feedback and controller actions

The GitHub adapter additionally consumes paginated REST PR reviews (`id`, `commit_id`, `state`, `body`, `html_url`, `submitted_at`, `user.login`), issue comments (`id`, `body`, `html_url`, `updated_at`, `user.login`), and GraphQL `reviewThreads` with nested comment pagination. Thread fields are `id`, `isResolved`, `viewerCanResolve`, `path`; published comment fields include `id`, `databaseId`, `body`, `url`, `updatedAt`, `author.login`, `originalCommit.oid` and `pullRequestReview.state`. Both connection levels require `hasNextPage/endCursor`; nested node identity must still equal its selected thread. Source timestamps decode as valid UTC instants. An unpublished `PENDING` review supplies no submitted feedback. PR identity/head/target are checked before and after these reads.

Canonical check observation uses paginated `commits/{head}/check-runs?filter=latest` (`id`, `name`, `head_sha`, `status`, `conclusion`, `app.id`, optional `details_url`) and `commits/{head}/statuses` (`id`, `context`, `state`, optional `target_url`). Run IDs and app bindings select current check attempts; statuses retain their separate source kind and context identity. One assessment supplies readiness and feedback in a delivery operation. Feedback does not join a second `pr checks` summary by display name. Absent source links disclose unavailable supplemental details; same-name advisory applications never inherit blocking authority from a required application. Pagination/head validation still fails closed.

Supplemental Actions evidence reads `actions/runs/{id}` (`id`, `head_sha`, `run_attempt`, `path`, `status`, `conclusion`) and fully paginated attempt jobs (`total_count`, job `id/run_id/name/status/conclusion`, step `name/conclusion`). Failure detail uses `gh run view <run> --attempt <attempt> --job <job> --log-failed`, with a 15-second deadline and a shared 32 KiB output budget across at most four matching jobs. These flags are verified against installed CLI help and the [official run-view contract](https://cli.github.com/manual/gh_run_view). Unavailable jobs/logs retain the independently confirmed run identity and an explicit detail-unavailability reason. Eligibility is distinct from check-policy clearance.

Actions use `pr ready`; REST requested-reviewer reads and POST with validated `reviewers/team_reviewers`; repository collaborator/team permissions; authenticated `api user`; ordinary issue-comment and inline-review reply POSTs (inline reconciliation also consumes `in_reply_to_id` to bind its source comment); GraphQL thread permission/state and `resolveReviewThread`; and `actions/runs/{id}/rerun-failed-jobs` POST. Review requests validate the exact PR author/head/base and never request self-review. Suggested recent authors use bounded commit reads with `sha/author.login`. Read operations require repository/PR/Actions access; writes require corresponding pull-request, discussion/thread or Actions write permissions. Read-only permission/identity/source failures before submission retain a definitely unsubmitted preflight result. A permanent eligibility denial is refused; transient reads can be retried under unchanged authority. Submission admission is committed immediately before the mutating command; failures after that point remain potentially submitted and are reconciled without automatic resend. An unavailable read or successful process exit never fabricates a remote receipt. No endpoint dismisses a review, approves a fork workflow, enables debug logging or bypasses branch protection.

## no-mistakes v1.84.0 protocol

The optional adapter is pinned to [no-mistakes v1.84.0](https://github.com/kunchenguid/no-mistakes/tree/v1.84.0), source commit `4822244`. TOON decoding uses maintained `@toon-format/toon` 4.4.0 in strict mode. Preflight checks `--version`, supported launch flags and the read-only `axi` home fields `repo/current_branch/daemon`. Finite `auto_fix` configuration is read from the selected `NM_HOME/config.yaml` and repository `.no-mistakes.yaml`; the retained receipt records resolved limits and configuration digest. Native-only projects never invoke this adapter.

Launch uses `axi run --intent … --base-branch … --skip rebase,push,pr,ci --no-publish-intent --launch-nonce … --validation-generation … --wait 30s`. The daemon-authored `launch_receipt` supplies `run_id/disposition/launch_nonce/validation_generation/branch/head_sha/submitted_head_sha/intent_digest`. Status reads use `axi status --run <id>`; current-branch status is rechecked before `axi respond --action approve|fix|skip --step … --findings … --instructions … --wait 30s`. No blanket `--yes` is passed.

Consumed machine records include full run identity/head/status and per-step status, bounded gate findings, explicit outcome/errors, automatic skips/test overrides, and `branch_sync` local/pipeline/target/remote/recovery/next-action evidence. Expected exclusions are exactly rebase, push, PR and CI; all other steps must complete. A successful exit, shortened head or unknown outcome cannot prove success. Active waits remain attached. Truncated gate descriptions are disclosed and refused for decisions.

Custody inspection uses `axi sync --check`. Only offered exact `no-mistakes axi sync`, `no-mistakes axi sync --recover`, and `no-mistakes axi sync --adopt-published` commands translate to fixed argv; output command strings are never executed. Local branch/head/cleanliness, exact run/submitted head, unpublished target identity and preserved ancestry must agree before adoption. Explicit abort uses `axi abort --run <id>` and still requires terminal/custody confirmation. Explicit approved setup alone may invoke `init`, whose pinned source installs gate metadata/hooks/remotes, may install user skills and may start its configured daemon. Tests use recording fake processes and isolated state, never a shared daemon or live run.

The public native `shell.create.before` hook supplies `cwd/command/env` without a session ID. The plugin resolves that directory and rejects native shell creation inside an execution whose external custody remains reserved, active or uncertain; subprocesses owned by the external adapter use the separate bounded process seam. Historic correction sessions remain assigned to their execution, and native tool guards compare the current role session ID before permitting a writer.

## Worker context and capability admission

The pinned public declarations expose `AgentEditor.update` (existing profiles only), `SkillApi.list({location})` returning `Skill.Info` with ID/path/content, `SessionContext.tools`, and `ToolHooks.execute.before`. AbraCode derives central profile/session permissions and tool checks from `packages/runtime/src/opencode/role-policy.ts`; frontmatter injected as role text is not native configuration. Required skills use the worker-location skill inventory. No foreign agent files or new registry entries are generated.

Validation has two stages. Before queue admission, native agent/model and required skills are resolved and tool requirements are checked against role policy. The context hook validates actual model-visible tools after native shaping and role filtering before a provider call. `ctx.tool.list()` describes the location registry, not a preview of a foreign session's shaped tool set. Request-time rejection can follow successful queue admission and must not be reported as definitely unsubmitted. Native inbox/transcript proof is checked before inventory drift during recovery; captured context is never evidence of admission by itself.

Cold-location registry reads are not an activation barrier: the pinned [skill handler](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/server/src/handlers/skill.ts) reads the current registry directly, while the native [plugin service](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/plugin/service.ts) documents asynchronous location activation and a barrier used by session entry points. Preflight therefore makes bounded reads of the public worker-location plugin inventory until AbraCode is active before reading skills/models/agents. A failed or unsettled activation remains a specific blocker; no session is created just to initialize skills.

The installed `SessionApi` and plugin session domain also expose `switchAgent({sessionID,agent})`. After idle confirmation and fresh inventory validation, a deliberate new turn selects its effective agent before its model, preserving the native session identity. This prevents a reused session from retaining an old agent while its new context claims the configured replacement. Retained uncertain admissions do not switch profiles.

## Agent-browser CLI and native command permissions

The central dependency pins **agent-browser 0.39.1**. Its reviewed package postinstall prepares the platform-specific native executable; Chrome provisioning is separate. The installed `skills get core` provides version-matched command guidance. The service's existing `<home>/node_modules/.bin` PATH supplies the executable to foreign worker locations, without global installation or managed-repository dependencies.

The pinned [native shell executor](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/tool/plugin/shell.ts) scans command resources and checks each through native permissions before spawning. Browser-only roles allow `agent-browser` and `agent-browser *` under default deny; Apply retains development shell access. The [native skill tool](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/tool/plugin/skill.ts) loads registered skills by ID. Skills do not grant authority. The [native read tool](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/tool/plugin/read.ts) supports screenshot image content after external-directory authorization.

Runtime acceptance on 2026-10-17 used OpenCode **2.0.28**, agent-browser **0.39.1** and Chrome for Testing **155.0.8059.84**. In the real native-server E2E, Explore, Apply, Review and Research each loaded `abra-browser`, fetched upstream core guidance, executed the pinned CLI against a loopback HTTP fixture, inspected a snapshot, clicked an element reference, observed the changed counter, captured and natively read a PNG, and closed their assigned browser. Explore/Review/Research were denied unrelated shell commands and an unrelated command chained after a browser invocation. Existing native edit, inactive-session and management guards remain independently covered.

Two browser instances using actual worker-session-derived names were also opened concurrently by the test driver: navigation and local storage stayed separate, fresh state returned after close, and closing one left the other usable. This is CLI/browser isolation evidence, not a claim that two writing roles may run together in an execution. Browser CLI arguments and shell redirections remain trusted same-user execution, not a filesystem sandbox. No custom browser tool, parser, MCP service or native extension is introduced.

The public pinned `SessionApi.update({sessionID, permissions})` supports permission replacement. AbraCode uses it only on deliberate new admissions into an existing idle worker session, after preflight; uncertain admission reconciliation keeps its original permissions and context. Native acceptance simulates an old session with default-deny permissions, then explicitly retries the same ID and verifies the browser workflow succeeds with the refreshed policy.

## Abra-only conversation and generated bootstrap

The pinned public `ctx.session.hook("prompt", handler)` runs before **new** native prompt admission, including queued prompts; existing-ID reconciliation can return before the hook (see the replay audit above). AbraCode resolves initial assignment and follow-up intents against active role, session, control generation and exact immutable text/delivery. It rejects unowned new IDs and added files/agents/skills before provider work. The hook reads retained records without acquiring the execution lock; native admission runs outside short controller coordination, so hook callbacks do not deadlock. Existing request/context/tool guards remain independent. `packages/runtime/tests/e2e/native.test.ts` counts provider-visible denied/owned markers and native instruction identities; a provider may see the same one instruction on multiple subsequent model requests.

Generated `.abracode/config/opencode/opencode.json` uses public `plugins`, `default_agent` and `agent.abra` settings. Its paths point to tracked absolute plugin/prompt assets. The pinned `Service.ensure/discover/stop` contract owns a dedicated service registration; native auth uses that same endpoint. Fresh-install acceptance checks service/session reuse and the auth command's native argument route without writing provider credentials. `model.list` supplies enabled model/variant readiness to doctor; authentication is reported unverified until a request succeeds. Static schema/config validation makes no native calls.

The pinned `Plugin.Info` inventory permits a failed local import without `id`; bootstrap identifies that source by its configured absolute path, fails immediately on `state.status: failed`, and retains `state.error/ref` in the startup error. Unsettled activation still has a 15-second bound. Failed-plugin stop uses `Service.Info` and `server.info()` PID/version plus Linux `/proc/<pid>/cmdline` and `/proc/<pid>/environ` to verify the installed `@opencode/cli` package's declared `bin/opencode.exe`, `serve --service` arguments and exact launch configuration before calling `Service.stop`. It never logs the process environment. Healthy stop keeps its native controller RPC. `integration/service-recovery.test.ts` exercises an actual failed-import service, wrong-config/foreign-registration refusal and stop before Supervisor creation; `fast/plugin-activation.test.ts` covers immediate failure, unrelated failure isolation and bounded cold activation.

Worker inspection uses the declared read-only `abracode-visibility.worker` RPC and a bounded native session observation. Selection never calls `session.prompt` or creates worker tabs. Supported `home.footer.status` and `prompt.footer.status` TUI slots display AbraCode using the host theme; they do not replace OpenCode's logo or graphical-client branding. Native terminal tests cover inspection clicks, retained focus, narrow layout, pending state and disposal.

## Portable engineering guidance

The five `abra-codebase-design`, `abra-domain-modeling`, `abra-diagnosing-bugs`, `abra-verification` and `abra-blast-radius` IDs use the existing pinned `ctx.skill.transform` registration and native `skill({id})` loading path. `packages/runtime/tests/unit/engineering-skills.test.ts` checks central/foreign registration without replacing local skills. The real-server engineering journey in `packages/runtime/tests/e2e/native.test.ts` lists the suite at both locations, loads each role's applicable IDs through native tool calls and observes their returned content. Post-loading source-edit, Review shell, management and delegation attempts retain their native refusals. No new registry API, permission, report endpoint or worker-location control file is introduced.

`packages/runtime/tests/unit/engineering-recovery.test.ts` exercises the actual NativeRuntime adapter with missing new defaults in a retained inventory, preserving exact captured groups/provenance and original context/prompt identity. `packages/runtime/tests/e2e/engineering-recovery.ts` serializes a seeded pre-suite capture before the fixture service restarts, then validates it through NativeRuntime against the restarted server's actual inbox/context/plugin/agent/model/skill APIs. It does not submit a historical prompt; fresh preflight selects current defaults. Existing lost-response controller tests independently assert no duplicate admission, and incompatible current permission policy remains a blocker. Native availability still records digests and `loading: unobserved`; a scripted invocation test is separate evidence of loading, not behavioral quality or authorization.

## Typed finishing forms and completion notices

The pinned public Form primitives support a required string action with fixed `options`, `custom:false` and a conservative defer default; conditional `multiselect` fields use `when:[{key:"action",op:"eq",value:...}]`, exact path options and bounded item counts. `session.form.create/get/reply` retain the same native Form.ID. Metadata binds the decision identity and SHA-256 of the exact typed target. The adapter verifies both before accepting an action and decodes only its matching selection field. Free text, an unknown action or an unselected path grants no authority. Cancelled forms defer without disposal; missing pending forms recreate the retained ID after restart. Unit adapter tests cover response loss and target mismatch; the disposable native journey exercises actual replies and restart.

The pinned public `session.synthetic` accepts a caller-supplied message `id`. Completion notices persist that ID first and inspect native inbox/context before resubmission. Matching existing text is accepted as the postcondition; conflicting identity/text is refused. Notice failure leaves graph closure intact. Worktree removal still has no public caller operation ID or definitive in-flight receipt: uncertain submitted removal with a present resource is not automatically replayed.

### Consumed turns interrupted by service restart

The parallel native fixture observed a consumed assignment followed by an empty,
unfinished assistant message after server termination during a provider request.
Replaying the same prompt ID woke the native loop but could emit a successful idle
without another provider request or any reporting tool call. Queue wakeup evidence
must not be generalized into automatic recovery of every consumed turn. AbraCode
continues to require the retained report/verification evidence and keeps explicit
pause/resume recovery authoritative. That recovery preserves session/worktree
identity, supersedes the old generation and captures a new assignment ID. It is
not an admission retry after response loss. See the fair-admission recipe for the
parallel test and the retained interrupted-turn diagnostics.

### Static project-lead sessions

OpenCode 2.0.28 installed `@opencode/schema/dist/config/agent.js` exposes agent
model/system/mode/hidden/permissions, and the Effect client SessionCreateInput
accepts explicit ID, parentID, agent, complete model, location, metadata and native
permission rules. The agents package registers the stable hidden `project-lead`
definition through the pinned agent transform, with its existing inline guidance
and deny-by-default one-tool policy. The bounded 2.3.0 registration regression
above proves insertion; the lead journey remains the lifecycle proof. Session creation
adds the same explicit session-level rules. The actual provider-visible tool set
contains only the scoped lead endpoint. A known restricted session cannot become
Abra by changing its agent label.

The same real journey observes native normalization of a model selection with no
variant into a context selection with variant `default`. Equality uses explicit
provider/model and normalized variant fields. Native queue/inbox/prompt IDs and
interrupt/wait semantics are the same verified worker transport; no lead daemon,
filesystem inbox, additional scheduler or transcript store is introduced.

The two graphical preview files above were fetched and re-inspected at the pinned
v2.0.28 tag on 2026-10-18. Controller-generated artifacts now use that same native
file-link handoff; the actual Research/terminal-render/restart journey verifies the
retained link and artifact without a hosted application. Offline and opaque-Blob
browser tests execute the exact HTML sandbox flags. The lack of a paired graphical
session still makes chat click-through/desktop routing source evidence only.

## Dependency update on 2026-11-15

The current pins are OpenCode 2.3.0, OpenTUI 0.8.4, Effect/platform-node 4.1.4,
OpenSpec 2.0.0, agent-browser 0.43.0, TypeScript 7.0.2, Effect tsgo 0.69.0,
Oxlint 1.93.0/tsgolint 7.0.2007, Vite+ 1.6.0 and Vitest 5.1.0. Node 26.13.0
and pnpm 12.21.0 are pinned in mise; OpenTUI requires Node >=26.4.0.

Installed declarations require a native resource owner for `generateSyntax`;
the Markdown and diff views pass `ctx.renderer.nativeScene` and retain scoped
style destruction. The 2.3.0 [prompt footer implementation](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/tui/src/feature-plugins/prompt/footer.tsx)
no longer renders `prompt.footer.status`; AbraCode appends to `prompt.footer`.
The home status slot remains unchanged. Terminal rendering and actual installed
CLI startup are distinct acceptance cases.

The 2.2.7 [activation change](https://github.com/anomalyco/opencode/releases/tag/v2.2.7)
means location discovery alone cannot establish RPC readiness. Worker preflight
and service bootstrap retain their explicit plugin barriers. The disposable
native fixture also observes AbraCode and its probe active after every restart
before calling their RPCs; failed activation is reported directly.

OpenSpec 2 writes generated skills under `.agents/skills`. Its real refresh test
still proves worktree-only regeneration before planning, preserving the fetched
base and the source checkout's old instructions. Adapted tracked AbraCode skills
retain their original upstream attribution and are not regenerated wholesale.

The refreshed license inventory covers both documents of the pnpm 12 lockfile,
including package-manager dependencies. Effect's regenerated JSON schema adds
safe-integer bounds and normalizes existing constraints; it introduces no new
configuration setting. This update does not explicitly enable optional OpenCode experiments; the
role allowlists still filter newly registered native tools. The report distinguishes available APIs from recommended follow-ups.

The v2.3.0 graphical [file renderer](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/gui-plugins/src/file/renderer.tsx)
and [artifact viewer](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/gui-plugins/src/file/artifact-view.tsx)
were inspected at their new paths. HTML retains the opaque iframe sandbox and
no-referrer policy. Actual paired desktop click-through is still unverified.
A database containing historical native 2.0.28 sessions was not upgraded in this
run; old AbraCode record compatibility is covered separately by the unit/restart
fixtures. Remote CI and real-provider/forge execution are not local acceptance.

Final acceptance on 2026-11-15 passed `pnpm check` (including zero Effect
warnings/errors), `pnpm test` (487 tests in 75 files), `pnpm test:e2e` (3 tests
in 2 files), `pnpm build`, `pnpm config:schema`, `pnpm format:check`,
`pnpm licenses:check` (3 fixtures; 761 locked components and 24 distributed
source files), and `git diff --check`. `pnpm peers check` reports no issues;
`pnpm outdated -r --format json` returns `{}` for the direct workspace packages.
Commands ran under `mise exec --` with Node 26.13.0 and pnpm 12.21.0.

The full native run retained evidence in
`/tmp/abra-dependency-update-20261115-verified`. Its `native-engineering.json`
records `result: pass`, `cleanup_complete: true` and 24 observations after
teardown. `resources.json` records the fixture as removed. Full E2E completed
in 373.83 seconds; unit/integration completed in 277.27 seconds. The same suite
includes the separate reply-recovery and fresh-installation cases. Sibling log
files preserve the command outcomes; this is local acceptance, not remote CI.

### OpenSpec 2 shared instruction migration

The six generated workflow skills now use OpenSpec 2.0.0 templates and have one
shared copy in `.agents/skills`. The target marker names Codex and OpenCode;
the twelve former command/skill copies under `.opencode` have been removed.
Generated workflows use skill-name handoffs and retain their exact CLI bytes;
formatting excludes only those six supplier-generated files.

AbraCode-specific procedures remain in separate project-owned skills, including
`openspec-execution`, whose registered native ID, source path and body are
unchanged. No restoration wrapper, generated prompt patch or new worker authority
is added. The real CLI integration test copies the repository's instruction tree,
marks all six generated skills stale, and runs `openspec update` twice under
isolated configuration. It requires the first refresh to restore the expected
generated content while preserving custom skills and role profiles, and the
second to leave the tree byte-for-byte unchanged with no legacy directories
recreated. The controller provisioning test also requires the
custom worker procedure to survive a stale generated-skill refresh before Explore.
See [ownership and verification](openspec.md).

Migration acceptance on 2026-11-15 passed `pnpm check`, `pnpm test` (492 tests in
76 files), `pnpm test:e2e` (3 tests in 2 files, 371.15 seconds), build, schema,
license and diff checks. The strengthened regeneration/preservation cases passed
again with the 5 existing refresh unit cases (7 tests total). A final isolated
`openspec update --dry-run` reports no changes. The license inventory now records
761 locked components and 12 distributed source files.

Evidence survives at `/tmp/abra-openspec2-final-verified`: main and reply-recovery
native JSON record a pass and completed cleanup, and both fixture roots are
removed. The lead fixture also now proves its intended actor answers: it selects
the current lead request, excludes sentence punctuation from the key and reserves
that one routing question for the lead responder. Production controller logic is
unchanged. Concurrent web-client work was present in this checkout and exercised
by the full native/install suite. This evidence does not extend the live-provider,
historical-database or remote-CI claims above.

New report HTML exports are explicit derived artifacts: native `abracode-web.exportDocument` accepts an owned issue/request/document hash; `readExport` additionally requires the retained exporter hash. Browser POST `/api/report/export` returns only verified metadata. GET `/api/report/export/preview` uses the opaque HTML CSP and GET `/api/report/export/download` returns an attachment. Both read the exact canonical document ownership before export access. They expose no arbitrary file paths or controller action. The export bundle is built from trusted installed React/A2UI components and captured JSON; the build rejects live router/query/native capabilities. `scripts/report.ts` provides explicit local export and foreground preview without connecting to OpenCode. See [report contracts and compatibility](reports.md).

### OpenSpec 2 schema resolution and binding

The pinned 2.0.0 `schema which <name> --json` returns `{name,source,path,shadows}`, where source is `project`, `user` or `package`. `schema validate <name> --json` returns `{name,path,valid,issues}`; a missing/invalid schema exits nonzero. Experimental-command notices go to stderr, so controller failures preserve the requested name and explicit restore/retry action instead of depending on the CLI error JSON surviving process diagnostics. `new change <change> --schema <name> --json` reports the selected name as `change.schema`; existing changes are checked through native `status.schemaName`, never adopted under another schema.

Source evidence is installed `dist/commands/schema.js`, `commands/workflow/new-change.js`, `core/project-config.js`, and `core/artifact-graph/{resolver,instruction-loader}.js`. Native precedence is explicit name, target `openspec/config.yaml` (then `.yml`), then `spec-driven`. Resolution runs in the owned worktree after instruction refresh. No compact schema is installed into foreign repositories. Template paths resolve beneath the selected schema’s `templates/` directory.

New full-spec executions retain a pending then content-bound schema record: selection source, actual name/source/root, bounded definition/template file digests and a combined identity. Inputs must be real contained regular files, at most 256 KiB each and 1 MiB together, with at most 128 artifact templates. A source switch, unavailable input, metadata mismatch or changed bytes blocks new role admission and dependent planning/check/archive gates. Existing captured native prompt identities reconcile independently; schema checks do not allocate replay prompts. Legacy records without this evidence are readable and are not backfilled from today’s files.

`openspec-schema.test.ts` uses the actual pinned CLI to prove a target-only schema, unavailable explicit selection, changed defaults, mismatched metadata, template drift, package-to-project shadow refusal, immutable retained bindings and unavailable legacy provenance. These are integration contracts, not a schema registry or a claim of arbitrary workflow-engine compatibility.

Native 2.0 status includes each artifact’s `requires` array even when it is already done or natively skipped (`core/artifact-graph/instruction-loader.js`). Planning traverses `applyRequires` transitively and requires only that closure to be done/skipped; missing IDs, missing dependency lists, duplicates and cycles are refused. Strict native validation and nonempty consistent task tracking still run afterward. Global `isPlanningComplete` is not an Apply gate. Real-CLI coverage leaves an unrelated artifact ready while valid `skip_specs` planning proceeds, rejects prematurely written tasks and conflicting skip/delta declarations, and preserves unfinished-task refusal. Custom schemas must keep tracking in `tasks.md` for the existing checkbox fingerprint normalization; arbitrary task filenames are not newly supported.

Correction and finishing revisions explicitly reuse the bound name while retaining the original policy, rounds and approval ownership. Legacy revisions without a binding recover only the original name from the retained round/synchronization commit's archived `.openspec.yaml`: bounded read-only `git --literal-pathspecs ls-tree -z <commit> -- <path>` must identify exactly one regular blob, then `git cat-file blob <oid>` supplies the metadata. Current archive edits or a new project default cannot supply historical authority. Missing original metadata blocks creation rather than selecting a fallback; no historical content digest is invented. Real-CLI archive/revision tests preserve the original archive and prove both bound and legacy selection; controller correction/finishing restart and lost-response tests retain the stronger plan gate, binding and consumed budgets.

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

### Headless workspace composition

CopilotKit 1.88.0 exposes `CopilotKitCoreReact`, `CopilotKitContext` and
`CopilotKitAgentIdContext` through the public `v2/context` entry. Its context type
explicitly supports custom providers. Core's `deferInitialConnection`/`connect()`
contract starts the runtime probe during the React commit phase and coalesces
StrictMode calls; hook subscriptions retain their documented unsubscribe owner.
The application adapter initializes only the existing REST Abra connection and
render-only hooks. It does not register browser tools or model execution.
The pinned AG-UI client publicly exposes `HttpAgentConfig.fetch` and
`HttpAgent.fetch`; the private session proxy inherits that HTTP agent. The web
observation owner composes that request's SDK signal with its own abort signal,
restores the prior fetch function on cleanup, and retains the SDK's ordinary
`detachActiveRun()`. SDK observer detachment alone can leave its HTTP body open
across development effect replay. Owned request cancellation releases that body
without calling `abortRun()`, native Stop or any admission endpoint. Focused signal
tests and the disposable development/HMR journey verify independent fresh setup,
one settled current-document observer and unchanged pending native forms.
The [official import-surface reference](https://docs.copilotkit.ai/reference/v2)
documents the headless hook boundary; installed context/core declarations establish
the custom-provider and connection details. The pinned UI provider's optional web
renderers remain available upstream but are outside this native-authoritative UI.

The existing Streamdown 1.6.11 dependency is declared directly by the web consumer
and used through its public `Streamdown`/`StreamdownProps` export. Its original
Markdown/code/table/math/diagram rendering is deferred together; no private deep
imports, copied renderer or excluded language/theme features are used.

## Batched Git fingerprint reads

`Git.fingerprint` uses bounded `git hash-object -- <files...>` batches instead
of launching Git once per untracked regular file. Git still owns clean filters
and object format; symlinks retain their raw target bytes. Sorted filename/hash
concatenation, HEAD and separate staged/unstaged diffs retain the previous
persisted fingerprint format. `git-fingerprint.test.ts` compares the old and new
algorithms through actual Git with CRLF attributes, mixed index/worktree edits,
symlinks, leading hyphens, whitespace, Unicode and newline filenames across a
batch boundary. The 100-file, five-fingerprint probe changed from 500 object
processes/1471ms to ten/87ms on the development host.

### Generated work binding summary read

The additive visibility `binding` RPC and typed GET `/api/work/binding` accept
`issue_ids` (at most 100 validated IDs, deduplicated before reads) and optional
`include_population`. They return bounded summaries, classified requested results,
observation time/work revision and explicit returned/total/unavailable/truncation
coverage. Missing IDs expose no foreign records. Malformed, oversized and excess
inputs are rejected before the handler. This fixed read cannot choose a session,
execute a native operation or submit input.

Explicit references use `Queries.observeTask`, independently of the workspace's
50-row closed-history page. Optional unfiltered population uses two bounded
50-row WorkGraph finder reads and its total, reserves explicit IDs and reads only
those selected tasks. It does not call fleet readiness, worker inspection or
OpenSpec body readers. Publication uses the same read and shared selection rules;
a sibling navigation link cannot narrow an unfiltered table. Visibility and typed
HTTP regressions cover these limits and zero unrelated reads/admissions.

The backend-owned adapter lives in `packages/runtime/src/opencode/agui/` and
continues using the existing CopilotKit v2 AgentRunner HTTP routes. Standard
`HttpAgent` input supplies the fixed thread, a user text message, empty tools,
context and state, and `forwardedProps: {request_id, delivery?}`. Run ID is transport
correlation only; the stable request remains the durable admission identity.
Unsupported native session selection, tools/context/state and forwarded callback
properties are refused. Connect begins with a valid `RUN_STARTED` and attaches to
native observations; canceling/detaching its HTTP stream never invokes native
interrupt. Current-turn Stop stays explicit; historical run Stop is refused.

Pinned `@ag-ui/client` 1.0.4 `AbstractAgent.clone` preserves middleware and standard
configuration but does not copy subclass fields. `AbraAgent.clone` retains that
base behavior and restores its runner reference. The shared native reader uses
OpenCode 2.3.0 `message.list` with descending first-page order and issued cursors
for subsequent pages, independently of finder/report queries. HTTP tests use the
installed standard AG-UI client/reducer and the production endpoint rather than
synthetic run wrappers.

### Native incremental event evidence (OpenCode 2.3.0)

Installed `@opencode/schema/dist/session-event.js` and `.d.ts` define
`SessionEvent.Text.Started/Delta/Ended`, `Tool.Input.Started/Delta/Ended`,
`Tool.Called/Progress/Success/Failed`, `Step.Started` and execution terminal events.
Text uses `assistantMessageID` plus native ordinal; tools use that message plus
original `id`. Delta fragments are ephemeral; Text.Ended/Input.Ended carry complete
values. The pinned [2.3.0 native publisher](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/runner/publish-llm-event.ts)
provides a delta callback for text but none for tool-input fragments. Consequently
that server emits tool start and complete input boundaries, with no partial
argument events. The adapter maps schema-valid input deltas when supplied; it does
not synthesize missing fragments. The real-native provider gate proves tool start
and partial text arrive before the provider can finish; controlled event tests
cover mid-argument delta and recovery behavior. Durable envelopes carry aggregate
sequence/version; timestamps establish freshness, not causal order. Hidden reasoning and provider-native replay fields
are excluded from projection.

`SessionMessage.Idle` explicitly groups every step since the preceding idle marker,
including steered inputs, and records succeeded/failed/interrupted outcomes. Native
run completion uses delivered input membership in this turn evidence. Global idle,
transport run ID and a failed tool alone cannot establish that a submission finished.
A shutdown does not create a completed turn. Uncertain admission stays uncertain.

AG-UI 1.0.4 declarations and the real reducer verify standard text/tool events,
native call IDs and stable display-segment provenance. Its tool result event has
no native `ToolMessage.error` field; complete message baselines preserve that
native failure field and native status metadata after the standard result event.
Argument rewrites, bounded/unavailable arguments and incompatible structure also
use complete baselines. Truncated completed arguments are represented by a valid
empty object with explicit unavailable/limited metadata, never invalid JSON marked
as complete. Text observations are bounded to 64 Ki characters per native text part
with an explicit limit marker; tool arguments/results retain 4096/8192 character
limits. See `native-agui-stream.test.ts`, `web-transcript.test.ts` and the
[AG-UI event contract](https://docs.ag-ui.com/concepts/events).

### Server-side Express compilation

The runtime pins `@a2ui/agent` 0.1.0 and shares `@a2ui/web_core` 0.15.0 with the work catalog. Its public `ExpressParser(catalog, surfaceId, "v1.0").compile(source, true)` consumes an untagged complete body and emits wire messages. Abra accepts one matching work-catalog creation and validates the complete message with its surface decoder. The SDK reports syntax locations and component-property corrections on compiler errors.

The work v5 catalog shares the pinned SDK’s 18 basic component definitions and renderer functions. The work host supplies local icons, a frozen-media policy and HTTP(S)-only, user-activated URL opening. V1–v4 discovery documents retain their original definitions. [Basic catalog guide](https://a2ui.org/specification/v1.0-basic-catalog-implementation-guide/) and [catalog contracts](https://a2ui.org/concepts/catalogs/).

### Custom A2UI publication contract

AbraCode supports the fixed native `abra_render_ui` publication tool, complete
validated A2UI 1.0 revisions and immutable producing message/call associations.
Live tool results and historical projection retain the exact surface revision;
reload/restart never substitutes the latest layout for an older reference. Typed
task/session/decision/changes/artifact navigation remains a read-only owned-resource
read. Approval and permission actions remain native bound forms.

Generic `a2ui_operations` envelopes, `forwardedProps.a2uiAction`, automatic middleware
tool injection and arbitrary generated callbacks are unsupported. The adapter
rejects unsupported forwarded options before admission. Surface validation rejects
arbitrary action/component props; navigation resolves ownership again when opened.
The existing runtime stays `a2ui.enabled: false`; its custom catalog renderer and
native publication owner supply this explicit contract without a second model loop.

OpenCode 2.3.0 RPC method failures expose `type`, `message` and typed `data`; AbraCode's declared observer/gateway failures carry the domain error code in `data.code`. The web adapter decodes those declared failure envelopes before converting to `CrewError`. Expected `REPORT_REQUIRED` becomes a `not_published` Markdown report observation; `EXECUTION_MISSING` becomes `not_started` only after confirming the task still exists. Native report RPC output remains `{content}`. HTTP report output additionally supports these explicit unavailable states. Integrity failures and unknown tasks retain their error codes. The disposable native workspace journey and focused web HTTP/browser tests exercise this boundary.

Native call IDs may repeat in different assistant messages. Their original IDs and
message provenance remain intact; a changed call whose ID collides with earlier
history uses a full message projection. This avoids the pinned client's global
incremental lookup rewriting an older tool name or arguments. The real reducer
regression covers two different tools sharing `call_0`.

### Mermaid diagnostic tool and exact prepared views

Pinned OpenCode 2.3.0 `ToolEditor.add`, strict Standard Schema inputs and the existing `abra` namespace register `abra_mermaid_verify`. Its input is literal identified source data, not paths or compiler configuration. Output contains diagnostic metadata only, never supplied SVG or publication/check authority. The authoritative role policy permits it for Supervisor and current Explore/Apply/Review/Research assignments, preserving captured custom agent selection and generation checks.

`POST /api/diagrams/prepare` uses a closed selection union: `{kind:"surface",surface_id,revision,hash}` or `{kind:"report",issue_id,request_id,hash}`. Surface hashes cover canonical sorted source-surface JSON; report hashes are retained document receipts. The fixed `abracode-web.prepareDiagrams` RPC rechecks central Supervisor ownership and exact source identity before returning bounded trusted assets/results. No generic RPC/path/configuration proxy is exposed, and the existing origin/session middleware remains required. Historical immutable revisions can be prepared by their exact identity; a missing or mismatched selection never resolves to latest. Reads do not admit provider turns.

## Interactive document reviews

The additive `abracode-web` methods `reviewList`, `review`, `reviewAsset`,
`reviewSubmit` and `reviewReceipt` share Effect schemas with fixed `/api/reviews`,
`/api/review`, `/api/review/asset`, `/api/review/submit` and `/api/review/receipt`
HTTP operations. Existing loopback Host/Origin middleware and central Supervisor
identity checks apply; no arbitrary native proxy, path or executable callback is
introduced. Receipt lookup is read-only and verifies the retained response's exact
review/revision/hash and generated admission text.

`abra_review_ui` uses the existing registered native tool/authorization boundary,
with `source`, `publish` and `read` actions. It is unavailable to managed worker
roles. Plan reading uses the existing bounded owned/archive document reader;
source content hashes and control generation are rechecked before a new response
reservation. Surface and report selections use their exact immutable owners.
Raster capture uses bounded Node file handles, realpath containment, no symlinks,
regular-file checks, content signatures and SHA-256. Retained native storage keeps
preview bytes independent of worktree retirement. The pinned A2UI 0.15.0 catalog
loader, MessageProcessor v1.0 and React component implementations render the
separate review catalog; its controls never enter the saved evidence catalog.

## GitHub inbox

The native inbox uses the configured `gh` executable. A local `gh auth token --hostname HOST` lookup partitions cached responses by active credential. Only its digest enters the partition key. Inventory and detail use `gh api --hostname HOST graphql` with fixed queries, repository variables and returned repository/item identity checks. The issue and pull-request connections each page 50 summaries ordered by update time. A selected item adds its body and ten recent comments. Label and discussion truncation are reported. Review reads the REST changed-files endpoint in pages of 100, bounded by 3,000 files and 64 KiB of patch evidence, between matching PR base and head reads. [GitHub repository connections](https://docs.github.com/en/graphql/reference/repos#repository) · [GitHub changed files](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files)

## Open Code Review delegation

Coding Review uses the centrally pinned `@alibaba-group/open-code-review@1.13.13` executable. The controller invokes `delegate preview --format json` for the workspace and, when needed, the pinned base-to-HEAD range. The final worktree supplies `delegate rule --format json -- <paths...>`. Both boundaries decode schema version 1. The OpenCode worker supplies the model and its credentials. [Pinned CLI implementation](https://github.com/alibaba/open-code-review/blob/445ad9dea3057346986197385858a1a281253cc9/cmd/opencodereview/delegate_cmd.go)

The `abra_review_changes` worker tool binds paged patches to the assigned session, generation and verified fingerprint. The controller reconciles OCR selection against the net Git comparison, includes unclassified paths, and discloses OCR exclusions. Pass `file` for a supplemental changed-file patch. Each ordinary page returns up to 32 entries and 64 KiB of patch text. The shared comparison inventories up to 500 files. A new coding Review needs complete page coverage to pass. Explicit private PR review uses the registered inbox's revision-bound GitHub patch reader and the resolved Review model.

## Memos 26.11.1

On 2026-11-21 a disposable `neosmemo/memos:26.11.1` SQLite instance with a temporary account exercised both APIs. A personal access token authenticated via the Bearer header. `GET /api/auth/me` returned the account in `user.name`, such as `users/thought-probe`. The local Streamable HTTP endpoint `POST /mcp` accepted the JSON-RPC `initialize` handshake with protocol `2025-11-25`, JSON and event-stream Accept types, and returned server `memos` version `26.11.1` and the tools capability. [Pinned MCP adapter](https://github.com/usememos/memos/tree/26.11.1/server/mcp)

The local development bootstrap checks `needsSetup` on `GET /api/instance/profile`, creates the first user with `POST /api/users`, then signs in via `POST /api/auth/signin` with `passwordCredentials`. The session bearer can issue a token with `POST /api/users/abra/personalAccessTokens`. The creation response supplies `token` and `personalAccessToken.name`. The disposable Compose restart test verifies that the cached token still authenticates on the recreated container and that the Abra workspace can read the notebook. [Pinned user API](https://github.com/usememos/memos/blob/26.11.1/proto/api/user_service.proto) · [Pinned sign-in API](https://github.com/usememos/memos/blob/26.11.1/proto/api/auth_service.proto)

| MCP tool           | Arguments exercised                                                   | Equivalent HTTP request                                |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------ |
| `memo_create_memo` | `{memoId: "abra-probe", body: {content, visibility: "PRIVATE"}}`      | `POST /api/memos?memoId=abra-probe` with the memo body |
| `memo_list_memos`  | `{filter, orderBy}`; also advertises `pageSize`, `pageToken`, `state` | `GET /api/memos` with the same query fields            |
| `memo_get_memo`    | `{memo: "abra-probe"}` (ID segment only)                              | `GET /api/memos/abra-probe`                            |

Success returns the memo in MCP `structuredContent`, or `{memos, nextPageToken}` for list. HTTP detail returned the same resource name, creator, tags, timestamps, visibility, snippet and exact multiline content. The private personal memo had no `space` field. Listing accepted `creator == "users/thought-probe" && visibility == "PRIVATE" && space == null`, `create_time desc, name desc` and an absolute `timestamp(...)` creation bound. A duplicate ID returned an MCP tool result with `isError: true` and a text block reporting HTTP 409. Anonymous HTTP detail returned 401. The signed-in Memos browser at `/memos/abra-probe` displayed the original two lines. [Pinned memo API](https://github.com/usememos/memos/blob/26.11.1/proto/api/memo_service.proto)

**Resource name reuse.** Create a private memo with a chosen ID, delete it, then create a different private memo with the same ID using the same account. In the probe the intermediate GET returned 404. The next GET on the original path returned the replacement body with the same creator, name, createTime and updateTime. Both operations occurred within one second. The public detail response exposes no separate creation-generation identifier. A previously saved resource name can therefore resolve to a replacement after deletion.

## Basic Memory 1.0.0

On 2026-11-22 the local provider probe used `basic-memory==1.0.0` installed with `uv pip install --prerelease=allow` in a disposable CPython 3.12.16 environment on x86-64 Linux. Every MCP run, including the first startup and the restart, ran under `unshare -Urn` with external networking unavailable. The client launched the installed executable as `bm mcp --transport stdio`, with a disposable home, dedicated `BASIC_MEMORY_CONFIG_DIR`, `BASIC_MEMORY_PROJECT_ROOT`, `BASIC_MEMORY_FORCE_LOCAL=true` and `HF_HUB_OFFLINE=1`. The initial default project was under the disposable home, independently of the configured project root. Keep both isolated. [Pinned release](https://github.com/basicmachines-co/basic-memory/releases/tag/v1.0.0)

`bm --version` identified 1.0.0. MCP initialization negotiated `2025-11-25` and reported server name `Basic Memory` and version `4.1.3` (FastMCP). Discovery returned `bm_context`, `bm_delete`, `bm_edit`, `bm_find`, `bm_list`, `bm_man`, `bm_move`, `bm_project`, `bm_read`, `bm_schema`, `bm_search` and `bm_write`.

| Probe with `output_format="json"`                                                                        | Observed MCP result                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bm_project(command="create", name="repo-a", path=<absolute vault subdirectory>)`, then `command="list"` | Create returned name, path, external UUID, creation flags and indexing state in `structuredContent.result`. List included the same UUID, source `local`, path and local path.                                                      |
| `bm_write(project="repo-a", identifier="lesson.md", content=…, overwrite=false)`                         | The wrapped result contained action, relative path, permalink, title and checksum. A second create returned `isError=true` and a text block containing JSON with `error="ALREADY_EXISTS"`.                                         |
| `bm_read(project="repo-a", identifier="lesson.md")`                                                      | Direct fields in `structuredContent` included file path, checksum, frontmatter and Markdown with generated frontmatter. `include_content=false` returned metadata. A missing path returned `NOT_FOUND` in a JSON error text block. |
| `bm_search(project="repo-a", query="zebrakey", search_type="text")`                                      | `structuredContent.result` contained results, current page, page size, total, exactness and `has_more`. Hits included project external UUID, file path, title and matching content.                                                |
| `bm_write` with the last read's `expected_checksum`                                                      | Returned `action="updated"` and a new checksum. Reusing the old checksum after that accepted update returned `REVISION_CONFLICT`.                                                                                                  |

**Human deletion during an update.** Create a note, wait for the Markdown file to exist, read its checksum, unlink it in the filesystem and immediately call `bm_write` on the same project and path with that checksum and new content. The call reported `updated`. The file was still absent at the first check after the response, then appeared with the replacement text. A fresh process read that replacement. The provider accepts a revision in its database before writing the file. Its materialization guard treats an absent file as writable. A separate existence check in the caller leaves a race between the check and materialization. [Pinned materializer](https://github.com/basicmachines-co/basic-memory/blob/v1.0.0/src/basic_memory/runtime/note_materialization.py) · [Pinned file guard](https://github.com/basicmachines-co/basic-memory/blob/v1.0.0/src/basic_memory/runtime/note_file_guards.py)

**Indexing and offline operation.** With `BASIC_MEMORY_WATCH_PROJECT_RELOAD_INTERVAL=2`, replacing a distinctive word on disk made that word searchable and changed the read checksum. After restart a second note remained searchable by exact text with an empty model cache. Under the same conditions hybrid search returned a tool error with plain-text model-load failure. For an offline hybrid probe, stage the default FastEmbed `BAAI/bge-small-en-v1.5` model online into the installation's `fastembed_cache` (tested Hugging Face snapshot `aa8f8b060edb00e03bfdd08813a2949946c8ba55`). With networking isolated again, `bm reindex --embeddings --project repo-a` embedded two entities at 384 dimensions with zero errors. A fresh stdio process returned the expected note and a matched chunk for `search_type="hybrid"`. Reranking was disabled. Exact-text retrieval required no staged model.

**Host prerequisites.** The package requires Python 3.12 or later. The tested Linux environment loaded sqlite-vec 0.1.10a4 in SQLite 3.53.1 and ran FastEmbed 0.9.1 with ONNX Runtime 1.32.0. On macOS, hybrid search requires a Python SQLite build that can load extensions, architecture-compatible sqlite-vec and ONNX Runtime, and the staged model. For this exact CPython 3.12 dependency set, the ONNX Runtime macOS wheel targets macOS 14+ on Apple Silicon. The upstream runtime probes SQLite extension loading and falls back to keyword-only on unsupported builds. macOS prerequisites were checked against source and wheel metadata; execution was verified on Linux. [Package metadata](https://pypi.org/project/basic-memory/1.0.0/) · [Runtime capability probe](https://github.com/basicmachines-co/basic-memory/blob/v1.0.0/src/basic_memory/repository/semantic_runtime.py) · [ONNX Runtime wheels](https://pypi.org/project/onnxruntime/1.32.0/#files)
