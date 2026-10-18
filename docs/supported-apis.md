# Supported APIs and environment evidence

Inspected on 2026-10-14. AbraCode installs a local pinned runtime rather than upgrading the user's global binary.

| Component          | Supported version                  | Verified interface                                                                                                                                                                    |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenCode CLI       | 2.0.28                             | `serve`, `service`, `--server`, `--session`, `pair`, `api`, `auth login`                                                                                                              |
| `@opencode/plugin` | 2.0.28                             | Effect `Plugin.define({ id, effect(ctx) })`; scoped transforms, hooks and RPC registrations                                                                                           |
| `@opencode/client` | 2.0.28                             | Effect `OpenCode.make`, native `Service.ensure/discover/stop/headers`, branded location and form APIs                                                                                 |
| Work graph         | Node built-in SQLite               | `DatabaseSync`, scoped connections, SQL transactions, WAL, foreign keys, guarded ownership and unique request IDs                                                                     |
| OpenSpec           | 1.13.2                             | `init --tools none`, `new change --json`, status, instructions, strict validation, JSON archive                                                                                       |
| Git                | tested 2.56.0                      | `GIT_OPTIONAL_LOCKS=0` and `diff.autoRefreshIndex=false` for observer index refresh, argument-array invocation, detached native worktrees, issue branches, clean retirement, ancestry |
| Node / flock       | tested 24.21.0 / util-linux 2.42.4 | Runtime and single-host kernel advisory locks                                                                                                                                         |
| GitHub CLI         | tested CLI 2.102.0                 | PR JSON, CI/review status, merge head guard                                                                                                                                           |

## OpenCode contracts

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

- `ctx.storage.get/set/remove/scan` stores JSON under the plugin ID. Scans paginate with `next`/`after`. The source [storage namespace implementation](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/plugin/host.ts) uses the plugin ID, not a repository-specific namespace. There is no public transaction or compare-and-swap method. Linux `flock` supplies a small crash-released controller lock and one coordinator leadership lock.
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
- Agent registry transforms can update/remove existing agents but cannot add one. Central `.opencode/agents/` defines the roles; cross-repository workers use the native `build` agent by default, with role instructions injected by their location's session hook and session-scoped permissions. No agent files are copied over project configuration. The portable OpenSpec workflow is registered through `ctx.skill.transform` at worker locations; registered repository roots are permitted for relevant reads, with edits confined to the owned worktree.

## Terminal observer contracts

The installed `@opencode/plugin@2.0.28` public TUI declarations and [CLI plugin documentation](https://dev.opencode.ai/v2/docs/build/plugins/cli) support `Plugin.define` from `@opencode/plugin/tui`, package export `./tui`, `ui.slot` with `sidebar.content` and `session.panel`, `ui.panel.open`, native session tabs, routing and command layers. `src/visibility/ui.ts` uses the published OpenTUI JSX runtime with reactive property getters; it requires no custom JSX compiler. The UI uses host theme colors and authenticated `context.client` access, including remote servers.

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

Observer methods declare `not_found`, `resource_unavailable` and `invalid_selection` errors through native RPC factories. Unexpected failures remain internal defects. The `changed` event carries only the controller home; its authenticated native event envelope supplies the emitting location. A scoped, coalesced queue receives notifications after SQLite/record commits. Publication waits for the commit lock to release and cannot fail a committed mutation. TUI subscriptions filter by home, reconnect and refresh; periodic reads recover missed events without replay.

Worker preflight reads the assigned worktree's native agent/model inventory before new prompt admission, checking explicit IDs, enabled models, variants and tool capability. The native [agent selection](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/agent.ts) permits an implicit `build` profile without a registry entry, using `Agent.Info.default`; the [session model comparison](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/session/session.ts) treats omitted and `default` variants equivalently. These native defaults remain valid. Missing explicit selections do not cause substitution. Existing inbox/transcript prompt IDs bypass new-inventory validation during admission recovery.

## Report HTML preview

Inspected against the OpenCode **v2.0.28** source tag on 2026-10-16. The [file link handler](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/gui-extensions/src/file/renderer.tsx) resolves agent-referenced file paths and force-reads the selected file into the existing side-panel tab. Eligible desktop HTML can route to the active native browser pane. The [artifact viewer](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/gui-extensions/src/file/artifact-view.tsx) creates a Blob URL and renders HTML in an iframe with `allow-scripts allow-popups allow-forms allow-modals`, without `allow-same-origin`, using a no-referrer policy. This supports a self-contained HTML build without an OpenCode UI dependency or messaging bridge.

The documented handoff format is an absolute-path Markdown file link, using `[Open report](/absolute/installation/templates/reporter/dist/index.html)`. Substitute the real installation path. This is a native file preview, not HTML embedded in a chat message. Clients without the graphical viewer can open the file in a browser. `pnpm report:preview` supplies an independent loopback HTTP URL only while the foreground process runs on the serving machine.

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

The pinned public declarations expose `AgentEditor.update` (existing profiles only), `SkillApi.list({location})` returning `Skill.Info` with ID/path/content, `SessionContext.tools`, and `ToolHooks.execute.before`. AbraCode derives central profile/session permissions and tool checks from `src/opencode/role-policy.ts`; frontmatter injected as role text is not native configuration. Required skills use the worker-location skill inventory. No foreign agent files or new registry entries are generated.

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

The pinned public `ctx.session.hook("prompt", handler)` runs before **new** native prompt admission, including queued prompts; existing-ID reconciliation can return before the hook (see the replay audit above). AbraCode resolves initial assignment and follow-up intents against active role, session, control generation and exact immutable text/delivery. It rejects unowned new IDs and added files/agents/skills before provider work. The hook reads retained records without acquiring the execution lock; native admission runs outside short controller coordination, so hook callbacks do not deadlock. Existing request/context/tool guards remain independent. `tests/e2e/native.test.ts` counts provider-visible denied/owned markers and native instruction identities; a provider may see the same one instruction on multiple subsequent model requests.

Generated `.abracode/config/opencode/opencode.json` uses public `plugins`, `default_agent` and `agent.abra` settings. Its paths point to tracked absolute plugin/prompt assets. The pinned `Service.ensure/discover/stop` contract owns a dedicated service registration; native auth uses that same endpoint. Fresh-install acceptance checks service/session reuse and the auth command's native argument route without writing provider credentials. `model.list` supplies enabled model/variant readiness to doctor; authentication is reported unverified until a request succeeds. Static schema/config validation makes no native calls.

Worker inspection uses the declared read-only `abracode-visibility.worker` RPC and a bounded native session observation. Selection never calls `session.prompt` or creates worker tabs. Supported `home.footer.status` and `prompt.footer.status` TUI slots display AbraCode using the host theme; they do not replace OpenCode's logo or graphical-client branding. Native terminal tests cover inspection clicks, retained focus, narrow layout, pending state and disposal.

## Portable engineering guidance

The five `abra-codebase-design`, `abra-domain-modeling`, `abra-diagnosing-bugs`, `abra-verification` and `abra-blast-radius` IDs use the existing pinned `ctx.skill.transform` registration and native `skill({id})` loading path. `tests/unit/engineering-skills.test.ts` checks central/foreign registration without replacing local skills. The real-server engineering journey in `tests/e2e/native.test.ts` lists the suite at both locations, loads each role's applicable IDs through native tool calls and observes their returned content. Post-loading source-edit, Review shell, management and delegation attempts retain their native refusals. No new registry API, permission, report endpoint or worker-location control file is introduced.

`tests/unit/engineering-recovery.test.ts` exercises the actual NativeRuntime adapter with missing new defaults in a retained inventory, preserving exact captured groups/provenance and original context/prompt identity. `tests/e2e/engineering-recovery.ts` serializes a seeded pre-suite capture before the fixture service restarts, then validates it through NativeRuntime against the restarted server's actual inbox/context/plugin/agent/model/skill APIs. It does not submit a historical prompt; fresh preflight selects current defaults. Existing lost-response controller tests independently assert no duplicate admission, and incompatible current permission policy remains a blocker. Native availability still records digests and `loading: unobserved`; a scripted invocation test is separate evidence of loading, not behavioral quality or authorization.

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
permission rules. AbraCode generates a static hidden `project-lead` definition in
its existing host `agent`/`prompt` configuration format; the real native lead
journey verifies these legacy aliases are still accepted by the pinned loader.
`installRoleProfiles` updates this existing definition's deny-by-default rules;
it does not dynamically add an agent through registry transforms. Session creation
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
