# Everyday launch

After installation/configuration/authentication, `pnpm start` starts/discovers the service and opens Abra interactively. `pnpm service:start` is the service-only command used below. `pnpm attach`, `pnpm auth`, `pnpm pair`, `pnpm service:restart` and `pnpm service:stop` remain operator commands. The root [README](../README.md) is the installation contract.

Abra is the only conversational agent. Worker selections open read-only inspection with recent bounded evidence; no worker chat tabs are opened by discovery. Ask questions and give instructions through Abra. Managed worker prompts require retained controller admission. Human approval forms remain mandatory where configured.

# Operations

## Persistent service and Supervisor

`pnpm service:start` uses the pinned native `Service.ensure()` API to start/discover an OpenCode 2.0.28 background process, activate the central location, verify plugin activation, and create/reuse a session tagged with the orchestration home. The process remains active after the command and every UI client exit. The dedicated registration is `.abracode/state/opencode/service.json`; this avoids replacing another default OpenCode service. Execution/session data lives in OpenCode's native data location, not in a new AbraCode database. The managed service sets `OPENCODE_CONFIG_DIR` to `<home>/.abracode/config/opencode`, so globally installed plugins under `~/.config/opencode/plugins` are not inherited by its pinned v2 runtime. Provider authentication remains in the native data location. AbraCode generates `.abracode/config/opencode/opencode.json` from the selected personal YAML; do not edit generated settings directly; the managed service does not inherit another OpenCode installation's global config or agents. Existing global files are not deleted.

```sh
pnpm service:start
pnpm auth
pnpm start
pnpm attach
pnpm pair
```

Configure a real provider/model before starting paid work. The deterministic model used by tests is test-only and never appears in production configuration. The Supervisor session ID is printed by `pnpm service:start`; a second client can attach through `pnpm attach` to the same conversation. Worker sessions retain their IDs and titles (`<issue> · <role>`) and are inspected read-only through Workers.

The controller invokes the pinned OpenSpec CLI by absolute paths under `<home>/node_modules/.bin`, including when their working directory is a managed repository or worktree. `pnpm service:start` checks the configured workflow executables before starting/discovering the service; `pnpm run doctor` checks the same configuration. CLI overrides in `abracode.yaml` take precedence; prefer absolute paths, since bare names still depend on the server's PATH. The Supervisor uses controller tools for issue mutations, preserving lifecycle gates.

Mise prepares Node/pnpm and the launch environment; no interactive shell needs to remain active. Without shell activation, launch with `mise exec -- pnpm start`. The server inherits that environment once, so later activation in an attached client cannot repair an already running server. After adopting these defaults, reload the central plugin or restart when workers are idle, then use `abra_work_reconcile` and the appropriate controller resume/retry action for preserved work. Git, flock, forge and repository verification tools still need to be available in the server environment.

```sh
pnpm service:restart
pnpm service:stop
```

Restart reactivates the coordinator without an attached UI. Stop retains durable records/history and interrupts native execution; resume through reconciliation and controller tools. `pnpm serve` is an alias for service-only startup; use the same generated configuration and selected personal file for all operator commands.

A location reload can unload the plugin's monitor; it does not delete sessions or worktrees. The leadership lock is released, and the replacement plugin reconciles existing resources.

## Terminal work view

The native TUI loads the plugin's `./tui` entrypoint on `pnpm attach`. Its sidebar retains the current worker's ticket, prioritizes items needing attention and shows up to three tickets within a terminal-height budget. **Work home** opens the grouped list. Its sections are **Needs you**, **Working**, **Blocked**, **Queued**, **Done**, and an **Other** fallback for unknown states. Approvals/recovery need attention; dependency/setup/policy blockers are separate from temporary capacity waits. Done requires a closed work-graph issue without a conflicting execution, and loads in pages of 50. Search and repository filters apply to loaded tickets.

Work home includes an all-ticket fleet summary, per-repository states and a
**Needs attention** selector for decisions, recovery, unanswered requests and lead
proposals. These totals are independent of search, repository filters and the
50-ticket closed page. Ready, capacity waiting, native queued, dependency waiting,
human/supervisor waiting and unknown native state remain distinct. Native
observation coverage is explicit: the bounded supervision scan prioritizes open
tasks with assigned workers. Completed today counts authoritative work-graph
closure events between host-local midnights; the displayed timezone and day
boundary include daylight-saving changes. A conflicting live execution is not
counted as completed.

Project leads expand in Work home to show scope, enabled/stopped/available state,
current session, unanswered requests, pending proposals, latest retained outcome
and links to scoped work. Malformed registrations produce separate diagnostics;
other valid leads remain inspectable. Authority readers still reject malformed
or conflicting registrations. The only conversation link returns to parent Abra.

Ticket tabs are **Overview / Plan / Diff / Workers / Feedback / Communication**. Overview labels ticket status, workflow phase and worker activity separately. Plan shows schema artifact status, implementation progress and a selectable Markdown document from the owned change. Document reads are limited to 64 KiB and the first 100 Markdown paths within eight directory levels; escaping symlinks are rejected. Archived tickets retain their archive path without reading a retired worktree.

Communication loads lazily in pages of 20 from the existing retained history.
Sender, recipient, kind, time and business response status stay visible; expand
for the original request identity, body, reply and evidence references. Native
lookup, explicit acknowledgement and correlated answer are separate observations.
The view shows the original response requirement, zero/one recovery reservation,
reminder transport, observed native activity/outcome and the original escalation.
Admission alone never resolves a response. A linked worker question is the existing
Decision, with its owner and next action; reading it does not answer it. Inspect
worker opens read-only evidence, and questions/authorized retries return to Abra.
No worker or lead composer is added.

Diff defaults to **All ticket changes**, comparing the recorded base commit with the ticket's current worktree, including committed, staged, unstaged and untracked content. **Uncommitted only** compares HEAD with current files. A file selector loads one patch at a time. Unified view is used in narrow panels; split view is available at 100 columns, with the host panel's full-screen control providing more space. Binary and oversized files show explicit messages. Patches are limited to 64 KiB, file lists to 500, and command output to the existing runner's 8 MiB limit; unavailable counts are labeled. Renames appear as additions/deletions. Retired tickets compare retained base/delivery Git objects in their registered repository; if those objects are missing, the diff is unavailable. Reads never fetch, stage, revert or merge.

Commands: `/abra` opens Home, `/abra-find` finds a ticket, `/abra-session` inspects a worker, `/abra-spec` opens Plan, `/abra-refresh` refreshes the observer, and `/abra-sidebar` focuses sidebar controls. They also appear in the command palette. Home and Back remain outside scrolling content, preserving filters, selected documents and files, and scroll positions. Esc goes back; H opens Home only within the work surface, and input fields retain text entry. Tab / Shift+Tab and arrows move focus; Enter / Space activate buttons. Full-page views offer a separate **OpenCode home** destination and return to the originating session. Conversation links return to Abra when its retained session is available.

Snapshots refresh every five seconds and after session creation/execution events; selected details refresh while the work panel is open. Text/tool activity updates from native events. An open patch stays fixed until **Reload diff** or a new file/scope is selected, so background refreshes do not replace code under review. Diff responses carry their read timestamp. Disconnects retain the last snapshot with an unavailable indicator. Plugin unload aborts requests and removes timers/listeners. Newly discovered workers synchronize native activity without opening conversation tabs. Select Inspect worker for read-only evidence; Talk to Abra opens the central conversation.

All reads use the authenticated native `abracode-visibility` RPC at central and worker locations. Management tools remain central-only. Display grouping and navigation never approve, advance, deliver, clean up or mutate issues.

After updating an already running service, use native configuration reload against AbraCode's dedicated server (not an unrelated default service), then reattach the terminal client to load the new TUI entrypoint. If a restart is needed, `pnpm service:restart` retains history but interrupts active execution, so do it when workers are idle. The browser client does not load TUI sidebar widgets.

## Tool workflow

| Tool                     | Input and result                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `abra_project_onboard`   | ID plus remote URL or existing checkout path; inspect or register, including pending setup                                |
| `abra_project_list`      | Registry with identity, checks, policies, setup blockers and saved setup checkpoints                                      |
| `abra_project_setup`     | ID and prepare/deliver/approve/finish; authorized initialization in a native worktree                                     |
| `abra_work_create`       | Repository ID, title, goal description; optional priority/dependencies/request ID; issue and readiness                    |
| `abra_work_create_batch` | Stable batch request ID, 1–32 keyed work definitions and tagged local/existing dependencies; atomic mapping and readiness |
| `abra_work_list`         | Central issues and durable execution summaries                                                                            |
| `abra_work_ready`        | Priority-sorted work with dependency/registration/policy/capacity blockers                                                |
| `abra_work_start`        | `issue_id`; claim/create or recover the existing execution                                                                |
| `abra_work_diagnostics`  | Issue ID and optional role; native errors, worker models, bounded recent messages and tool failures                       |
| `abra_work_status`       | `issue_id`; Issue status/history, OpenSpec, Git and session outcomes                                                      |
| `abra_work_control`      | `issue_id`, `action`, optional `text`/`request_id`; steer/pause/interrupt/resume/retry/replan/advance                     |
| `abra_work_approve`      | `issue_id`, `kind: plan` or `merge`; native form or accepted receipt                                                      |
| `abra_work_finish`       | Verify preservation, authorized merge, native cleanup and issue closure                                                   |
| `abra_work_reconcile`    | Optional `issue_id`; reconcile one or all incomplete records                                                              |

Explore/Apply have `abra_spec` for read-only CLI status/instructions; Review has `abra_review_report`. Management tools are not exposed at worker locations. Errors return `ok:false` with a stable code, message and next action, preserving resources.

For a full coding issue:

1. Ask the Supervisor for the desired work. It uses `abra_work_create` to record your goal in the work graph with repository association and optional dependencies/priority, then starts the returned issue when requested. Explore investigates implementation details; the human plan form approves its resulting scope. Issues have an explicit typed `repository_id`.
2. Start a ready issue. The unique execution actor atomically claims it. The controller fetches the remote target, saves its SHA and delivery branch, and the native API creates its worktree from that SHA; the controller creates its issue branch. For full OpenSpec work, it runs `openspec update` in that owned worktree before creating the change or launching Explore. Generated instruction changes are committed as a controller preparation baseline; the fetched base remains unchanged. Successful refresh is retained across provisioning retries and restarts. Update failure blocks worker launch and retains resources; partial changes must be inspected and resolved to a clean worktree before retry. Failed fetches block provisioning. Resuming preserves the recorded base.
3. Explore reads project instructions and writes the configured OpenSpec artifacts. Source edits and unrelated shell commands are denied; agent-browser is the browser exception.
4. The controller validates/stages planning artifacts and waits for a native human form. Calling an approval tool alone grants no authorization.
5. Apply implements the approved change and marks real tasks complete. Review is a separate read-only session in the same worktree. Full-spec Review includes OpenSpec completeness, correctness and coherence verification with concrete evidence and unresolved conflict references; a generic pass without this evidence is rejected. Lightweight Review uses its short contract.
6. Successful tests, unchanged reviewed content and strict validation permit archive and delivery. Canonical specs are updated and checked on the work branch.
7. The controller pushes its exact branch and rediscovers a matching PR before creating one. CI/review and human merge authorization gate merge; the CLI also guards the reviewed head commit.
8. Verified target ancestry or explicit remote-branch preservation permits non-force native cleanup. The issue is closed only after directory retirement is confirmed.

Use `replan` while idle before archival if scope needs revision; pause an active writer first. Failed review `retry` returns findings to the same Apply session. A rejected plan `retry` returns to the same Explore session. Automatic scheduling only runs when configured, without repeatedly waking the Supervisor model.

`auto_schedule` remains `false` by default, including upgrades. When enabled,
the existing scheduler requires a retained Abra session in the central checkout.
It admits the highest-priority eligible issues first (lower number wins), rotating
between repositories at equal priority. A small retained rotation cursor records
the last repository with a retained controller execution intent; it is policy
state, never an issue claim. A crash before cursor commit can affect one tie-break.
Every attempt rechecks controller
readiness and capacity, and a failed attempt does not prevent other eligible work.
Each tick makes at most as many attempts as there were open issues at its start. The existing single scheduler-leader lock
owns the cursor across processes.

`abra_work_ready` distinguishes dependency, active-worker, retained-execution,
role-capacity and missing-supervisor-authority blockers. Uncertain native
admissions keep their reservation; paused executions require explicit resume.
Read-only worker inspection includes native activity and an observation time:
`queued` means pending input without native execution, while unavailable execution
observation remains `unknown`. These observations do not prove acknowledgement
or completion.

To steer an existing active worker, Abra can call:

```json
{
  "issue_id": "abra-example",
  "action": "steer",
  "request_id": "clarify-checks-1",
  "text": "Use the repository's documented consumer check within the accepted scope."
}
```

Reuse `request_id` after an uncertain response. A changed instruction requires a
new identity; conflicting content under the old identity is refused. If omitted,
the native tool call's session/message/call identity and generation supply the
retry key. Programmatic controller callers must provide the key and trusted
sender explicitly. Steering retains its own native prompt ID and exact payload;
it preserves the original assignment capture, session, model and role policy.
It grants no scope revision or checkpoint approval.

`execution.messages` distinguishes pending, uncertain, admitted and superseded
instructions. Native admission is not worker acknowledgement. If admission is
uncertain, the controller inspects the original ID in inbox and context; missing
or unavailable evidence keeps the instruction unresolved and capacity held. It
does not issue a replacement ID. Pause withdraws all owned queued inputs before
interrupting and confirming stop; consumed instructions remain historical.

Review, skills and CI provide evidence rather than permission to change approved requirements. Fix clear implementation defects within scope. Correct demonstrably obsolete tests or instructions only when accepted requirements already establish the intended behavior, retaining meaningful checks. Record advisory preferences as suggestions. Unresolved contradictions retain both sources and a durable decision; even an `in_scope` label cannot admit automatic repair when a full-spec report lists conflicts. Failed Review with an open scope decision cannot retry into Apply. Resolve the decision first: unchanged behavior can receive explicit correction, while changed requirements use `replan` and configured plan approval (or `abra_work_scope` for lightweight work). A decision answer does not grant plan or merge authorization. See [Review verification](../.agents/skills/openspec-execution/SKILL.md#review-verification) for assessment and conflict reporting.

## Batch intake

Use one batch when independent scopes or a distinct investigation deliverable
provide useful parallelism. Abra recommends policies and dependencies; the
controller validates the definitions and project policy. For example:

```json
{
  "request_id": "auth-performance-tests-1",
  "tasks": [
    {
      "client_key": "auth",
      "repository_id": "api",
      "title": "Refactor authentication",
      "description": "Refactor authentication while preserving the accepted behavior",
      "workflow_policy": "full-openspec"
    },
    {
      "client_key": "performance",
      "repository_id": "api",
      "title": "Investigate database performance",
      "description": "Identify the slow query paths",
      "workflow_policy": "research-only",
      "scope": {
        "goal": "Explain database latency",
        "acceptance": ["Retain evidence and limitations"],
        "constraints": ["Read only"]
      }
    },
    {
      "client_key": "tests",
      "repository_id": "api",
      "title": "Fix flaky login tests",
      "description": "Remove the reproduced login test race",
      "workflow_policy": "lightweight-fix",
      "scope": {
        "goal": "Fix the reproduced race",
        "acceptance": ["Original flaky-test reproduction passes"],
        "constraints": ["Preserve authentication behavior"]
      }
    }
  ]
}
```

Submit this to `abra_work_create_batch`. The result contains `request_id` and
`tasks: [{client_key, issue, readiness}]`. A dependency uses
`{"type":"local","client_key":"auth"}` for another task in this batch, or
`{"type":"existing","issue_id":"abra-existing"}` for retained work. Local
references may point forward. Unknown references, cycles, duplicate keys,
missing short scopes or disallowed policy choices reject the whole batch.

All issues, dependencies, creation events and the retry receipt commit in one
SQLite transaction. Reuse the same batch ID and normalized keyed definitions
after response loss or restart; ordering alone does not change identity. Goal,
policy, membership or dependency changes require a new request ID. Ordinary and
batch intake cannot rebind each other's request identities. Intake launches no
worker; existing explicit start or configured automatic scheduling still owns
admission, dependencies, capacity and human checkpoints.

## Correlated messages

Abra uses `abra_work_message` for a request that needs an explicit response:

```json
{
  "issue_id": "abra-example",
  "role": "apply",
  "request_id": "verification-question-1",
  "kind": "question",
  "delivery": "queue",
  "response": "answer",
  "body": "Which documented consumer check applies?"
}
```

The role must be the execution's current eligible worker. An optional `session_id`
must match it. Queue is the default; steer uses the same retained authorization.
Requests are keyed within their issue execution. Identical retries reuse the
native prompt ID; changed routing, content, delivery, source or response contract
under that key is refused. A message cannot start a missing role, resume a pause,
replace scope or grant approval. Generic messaging remains denied to automated
diagnostic turns.

The assigned worker uses `abra_worker_reply`:

```json
{
  "action": "answer",
  "request_id": "verification-question-1",
  "generation": 0,
  "body": "The repository documents the consumer check in its verification recipe."
}
```

Use the actual captured generation. `action:"acknowledge"` needs only identity
and generation; it does not answer an answer-required request. An identical reply
retry returns the retained result. Wrong senders, stale generations and conflicting
answers fail. Native completion alone resolves neither acknowledgement nor answer.
Required responses block the applicable checkpoint; native quiescence releases
worker capacity so unrelated tasks can continue.

When native history proves the exact request was consumed and its relevant turn
completed successfully without the required response, the controller can reserve
one response-only reminder. It uses the original request ID, captured diagnostic
budget and ordinary worker capacity. Manual posture and zero remaining diagnostic
budget admit no reminder. Queued, busy, failed, interrupted or ambiguous native
state does not authorize a speculative reminder. Capacity waits retain the request
and its budget until a slot is available.

`record.response_recovery` exposes the sole reserved attempt, its exact native
identity, original completion evidence and pending/uncertain/admitted/suppressed
transport disposition. A correlated reply still resolves the original request.
An unanswered reminder produces one actionable `message_pending` incident. Native
admission alone never resolves it. A lost receipt preserves the same reminder ID;
repeated reconciliation cannot allocate another automatic attempt. A response
accepted at the native guard suppresses the unused reminder without refunding its
reservation. An admitted reminder with unavailable transport evidence remains
inspectable even if the business answer has arrived.

Workers can instead submit `action:"finding"` with a stable `request_id`,
generation, body and optional bounded base/path/line or URL evidence. An optional
`destination:{issue_id,role}` nominates a current worker without prompting it.
Abra forwards retained evidence using `abra_work_message` with
`source:{type:"finding",issue_id,request_id}`, `kind:"finding"` and an appropriate
response requirement. The controller quotes the retained finding as untrusted
data. It does not grant the source worker management tools or scope authority.

`abra_work_messages` reads `{issue_id,offset?,limit?}` (default 20, maximum 50).
It returns paged request/finding records, native queued/consumed/unavailable
observations, outstanding required-response totals and observation time. It makes
no prompts or workflow mutations. Inspect `record.status` and `record.reply`
separately from `native` admission evidence. Findings and resolved answers survive
retirement and generation changes.

Existing worker questions, progress, waits and decisions retain their tools and
owners. A retained decision answer is delivered as a follow-up referencing that
one decision; delivery does not create a second question or replace the captured
assignment. Legacy records without a retained supervisor keep their prior
assignment-based answer route rather than inventing a sender identity.

Bodies/replies are limited to 8 KiB, evidence to 16 references of at most 2 KiB
each, rendered wrappers to 32 KiB, and retained communications to 256 per execution.
Limits fail explicitly without evicting unresolved requests. Previously captured
worker policies remain authoritative on upgrade; incompatible captures require
the existing explicit retry/new-turn route, not silent permission changes.

## Create work from a request

The Supervisor can create a goal before it is fully specified. For example, “Start an OpenSpec flow to refactor agent-plugins to Agent Package Manager” should become an associated issue, followed by Explore when ready. An existing APM configuration is context for exploration; it does not require the user to author an issue manually.

`abra_work_create` requires `repository_id`, `title` and `description`. Optional `priority` is 0–4 (default 2); `dependencies` names existing issues. Use a stable `request_id` and identical input when retrying. Omitted request IDs deduplicate identical inputs within the same Supervisor session; an intentionally separate request uses a new key. Creation returns the authoritative issue and readiness. Missing project setup, dependency and capacity blockers prevent start, but do not prevent recording work for a registered repository.

The work graph stores the normalized request and issue in one SQLite transaction. Retrying the same `request_id` returns the existing issue; rebinding it to a different goal is rejected. Workers cannot create work or invoke management tools.

## Remote attachment

Use supported v2 client/server access; v1's `attach` command is not the v2 interface. Install the matching 2.0.28 client on the other machine. SSH forwarding keeps the service loopback-only:

```sh
# On the client machine, use the current port printed by pnpm start:
ssh -N -L 4096:127.0.0.1:<server-port> <user>@<host>
# Configure OPENCODE_PASSWORD securely with the native service credential,
# then attach the pinned v2 client:
opencode --server http://127.0.0.1:4096 --session <supervisor-session-id>
```

For a browser, run `pnpm pair --url http://127.0.0.1:4096` on the server and open the returned one-time pairing link on the forwarded client. Treat pairing links as credentials. Alternatively use OpenCode's supported native remote pairing (`pair --remote`) only when you choose to expose that service. No remote agents or multi-host scheduling are introduced.

## Start after host reboot

A Linux user service can invoke the native bootstrap. Adjust placeholder paths and executable locations; do not install this example unchanged:

```ini
[Unit]
Description=AbraCode native OpenCode coordinator
After=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/absolute/path/to/abracode
Environment=PATH=/absolute/path/to/node/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/absolute/path/to/pnpm start
ExecStop=/absolute/path/to/pnpm service:stop
TimeoutStartSec=90
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

Run `systemctl --user enable --now abracode.service` after installing an adapted unit. If the host must keep it alive after logout, configure user lingering through the host's normal administration. This unit bootstraps a native background service; it does not automatically restart a crashed daemon. Run `pnpm service:start`/restart to recover, or use a host service supervising a foreground native server with a central bootstrap. No service manager replaces OpenCode's execution lifecycle.

## Backups

Back up OpenCode's native data directory (reported by the pinned CLI's `debug paths`) together with `abracode.yaml`, registered checkouts, managed clone storage (`repository_root`), native worktrees, and the SQLite `work_database`. Stop the service before copying SQLite, or use SQLite’s online backup API; copying only the main file while WAL writes are active is unsafe. `.abracode` contains a private native service registration and lock/worktree paths; do not publish it. See [work graph storage and migration](work-graph.md).

## Delivery observations

Pending CI and required forge review keep an authorized ticket in `awaiting_merge`. `abra_work_status` exposes `execution.delivery_wait` with its category, reason, owner, exact delivered fingerprint and `next_check_at` (Unix milliseconds). Reconciliation rechecks after 30 seconds, backing off to five minutes for unchanged conditions. It retains matching human or standing authorization; it does not create model turns. Temporary forge observation failures use the same schedule with category `retryable`. Failed checks or requested changes are verification feedback; changed heads/targets remain recovery conditions. A manual pause suppresses these observations.

Records already stranded in `recovery_required` by an older runtime are not automatically resumed. Inspect `abra_work_status` and the exact PR head/target and existing authorization first, then explicitly retry after resolving ambiguous evidence. Do not rewrite a phase to manufacture authorization.

Verification defaults to 15 minutes per check and accepts explicit per-command deadlines (see configuration). A running command retains its process scope until exit or confirmed TERM/KILL cleanup, including timeout. Stream overflow is an explicit command failure; recent diagnostics remain bounded. Do not increase deadlines as a substitute for inspecting stalled progress. File reads are interruptible; filesystem mutations finish before their ownership can be released.

Slow verification, fetch/delivery and retirement use individual execution locks. Approval, pause and retry for another ticket can proceed during them. Pause reports requested versus confirmed stop, and replacement writers require confirmation. `abra_work_ready` reports separate active, role and retained-capacity blockers with consuming execution IDs. Idle PRs free active capacity while preserving issue ownership; raise the explicit global/project retained limits when that behavior is desired.

GitHub readiness now exposes `forge_observation`: exact head, CI policy, required contexts/app identities, check buckets and advisory failures. The default remains conservative across all reported checks. Explicit required-only policy can permit advisory failures while absent required contexts remain waiting. Drafts, unknown mergeability, unsupported queues/methods and unreadable policy remain explicit blockers. PR titles describe issue intent and summaries include actual check/Review/archive evidence; subsequent updates preserve user-authored text outside the owned markers.

Merged-delivery receipts retain both source and resulting commits for merge/squash/rebase. Before removing an existing worktree, cleanup fetches and confirms the resulting commit on the recorded target. Source branch deletion is supported; target history loss retains the worktree for recovery.

Generated-directory retirement requires an explicit `generated_paths` registration policy retained at admission. After preservation and worker quiescence, the controller validates and removes only those exact directories, checks all remaining tracked/untracked/ignored state, then requests non-force native removal. Unapproved ignored notes block retirement. `retirement` records show removal progress; a replaced directory or retained native inventory requires inspection.

Worker questions/progress/waits use assignment-checked `abra_worker_question`, `abra_worker_progress` and `abra_worker_wait`, including the current control generation from the prompt. Stable question/wait keys cannot be rebound. Status retains complete bounded history independently of progress. Supervisor decisions use `abra_work_decision`; user-owned answers use a retained native string form via `collect`. Reconciliation recreates pending forms and collects answers. Answers do not create approval receipts or authorize lifecycle changes.

The attention monitor routes open decisions to the retained Abra conversation on its next scan, including questions already waiting when the service starts. Each decision key/generation retains one `decision_pending` incident and durable prompt identity. Question routing uses the shared attention capacity but does not consume the optional diagnostic-turn budget or wait for a stall timeout. Abra answers Supervisor-owned questions from available evidence or collects user-owned questions through native forms and brings needed input to the conversation. Unavailable delivery uses the same explicit bounded retry as other attention incidents; pauses suppress routing.

Declared waits name their owner, condition, reference and expiry (at most seven days). Dependency closure, a matching answered decision or a completed owned command supplies clearing evidence. Invalid/expired waits remain visible until inspected and explicitly superseded through `abra_work_wait_disposition`. A pause or changed generation rejects stale worker reports and answers.

The independent attention monitor can observe an operation while reconciliation is occupied by a long check. Suspected stalls retain last meaningful progress, operation and owner; they do not interrupt workers. `abra_work_status` exposes `attention`, `attention_turns`, `progress` and `command_wait`. A diagnostic prompt uses the retained central Supervisor and stable message ID. Admission is not handling: use `abra_work_attention` with matching `incident_id`/`generation`, `action: handled` or `user_needed`, and `reason`. Unavailable admission is not automatically retried; explicit `retry` reuses identity and has a three-attempt ceiling. An exhausted budget requires user inspection.

## Research and lightweight work

`abra_work_create` accepts `workflow_policy` (`full-openspec`, `research-only`, `lightweight-fix`) and `scope: {goal, acceptance, constraints}`. Omission uses `default_workflow`, shipped as full OpenSpec. Scope and effective policy participate in request identity. A missing/incomplete research/lightweight scope creates a durable user clarification before worker launch. Answer its JSON contract through `abra_work_decision`, or explicitly supply the complete revised contract with `abra_work_scope`. The configured plan approval still applies independently to that scope fingerprint.

Research needs neither OpenSpec nor coding checks. Its Research session has read tools and assigned reporting tools, with no repository edit/patch or management authority. Its native shell permits only agent-browser for in-scope browser investigation. `abra_research_report` publishes a bounded immutable report under `.abracode/reports/<issue>/<report-id>.md`; content, issue, base, scope and worker identities are checked before completion. `abra_work_report` and the observer report RPC verify its hash on every read. Successful native outcome without a valid report does not close the issue. No push or PR occurs. Preserve report storage in backups.

Lightweight work needs configured checks, uses Apply and independent Review, and retains exact-content merge authorization and preservation/retirement gates. It creates no OpenSpec package or archive. `abra_work_scope` explicitly revises a short contract before delivery, retaining scope history and invalidating matching evidence. A stale form cannot approve the new fingerprint.

To implement a research recommendation, explicitly create a new coding issue with a new request key, an implementation policy and `report_reference: {issue_id, report_id, hash}` from the completed research. Intake verifies the retained report and adds a dependency on that research issue. The recommendation itself creates or starts nothing.

## Corrective rounds

Repository `repair_rounds: 0` preserves manual recovery. A positive snapshotted budget permits finite in-scope check failures and Review findings to return to Apply; failed Review must explicitly report `scope_status: in_scope`. Uncertain or scope-changing findings become durable questions. Each round retains immutable source findings, planning identity, starting head and prior archive/approval evidence. Repeated findings do not reset the budget. Checks and independent Review rerun after correction.

`abra_work_findings` reads current-head failed checks and submitted changes-requested reviews. It excludes stale heads, unrelated comments and superseded objections. These are evidence. `abra_work_correct` requires the expected head, selected authoritative finding IDs, bounded instructions and an explicit scope disposition. A disabled/exhausted policy or ambiguous scope creates a decision and launches no repair. For full OpenSpec after archival, correction creates a new revision change in the same worktree: new Explore, configured plan approval, real tasks, checks, independent Review and archive. Prior archives remain immutable. Lightweight corrections reuse the approved short scope. A changed source head requires a fresh matching merge authorization; PR identity is retained.

## Native work views

The existing Overview/Plan/Diff/Workers tabs show workflow policy separately from worker activity. Overview retains question owners, wait conditions/recheck times, capacity consumers, command deadlines and admitted-but-unhandled attention. Routine CI waits show waiting, not recovery. Plan shows OpenSpec artifacts, a short scope, or a research contract/report, with correction history. `Open retained report` loads and verifies report content on demand; `Show scope` returns to the contract. Observer reads cannot answer forms or mutate work. Offline views keep cached evidence with an unavailable-freshness notice; use the Supervisor for decisions and controller actions.

## PR feedback and external validation

An ordinary pending CI/review/approval wait is quiet. The central monitor reads due GitHub evidence even before a merge form is answered and while a known CI/review delivery block remains. Failed source reads retain evidence and back off from 30 seconds to five minutes. New blocking revisions may admit a bounded diagnostic batch; unchanged polls, pending checks and source outages consume no model turns. Diagnostic exhaustion creates a durable user-needed decision. Intentional pause, non-PR delivery, active writing and uncertain ownership suppress background diagnosis and repair.

Use `abra_work_findings` for live forge findings and `abra_work_feedback_status` for retained observations, dispositions, action receipts and paged history. `abra_work_feedback` classifies exact current-head revisions. `abra_work_correct` revalidates selected sources, accepted scope and repair budget before reserving one correction. Full-spec work creates a revision planning cycle after archive; previous archives remain immutable. Every corrective head needs fresh checks and independent Review and invalidates prior head-bound merge authorization.

The ticket's **Feedback** tab loads retained evidence lazily. It shows observation freshness, source/original heads, dispositions, action states, profile provenance and separate budgets. Opening or refreshing the tab does not poll or write GitHub. Buttons for ready, configured reviewers, suggestions, evidence replies, resolution, reruns and external gates queue exact tool arguments in Supervisor. They preserve the central location and native approval gates. Review target selection and classification remain available through the typed tools.

`abra_work_pr_action` prepares or reconciles one concrete outward action. Manual defaults produce no GitHub writes. For automatic replies the controller reports only published verified correction evidence; private instructions and engine findings are not copied into public discussion. Review-thread state and submitted review verdicts remain separate. Prepared replies do not satisfy merge clearance.

`abra_work_validation` inspects prerequisites or drives one selected external run. Gate responses require the current gate digest and explicit native approval. External fix limits, external run count, CI reruns, code-repair rounds and diagnostic turns are separate. A bounded wait attaches to the same external run rather than consuming another run. Pausing stops further controller answers; it does not claim that the external daemon stopped working. The Feedback tab shows the actual custody and answer owner. Abort and adoption are explicit recovery actions; neither silently supplies a successful validation receipt.

## Required PR actions and retryable preparation

The action view distinguishes unsubmitted preparation from an admitted or uncertain write. A temporary read-only preflight failure can recover under the same action identity and approval. A permanent reviewer/permission refusal needs a relevant change or explicit inspection; an ambiguous write is observed rather than sent again. Merely opening or refreshing ticket evidence never starts an action.

Required ready transitions, on-ready reviewer requests, verified replies, separately enabled thread resolution and eligible CI reruns are calculated from current delivered evidence and retained policy. Explicit finish, completion of merge approval and periodic reconciliation enforce the same obligations even before the next automatic-action pass has prepared them. A reply-dependent resolution waits for its confirmed reply; reviewer request receipts do not satisfy required submitted review. Required-action waits retain valid same-head authorization. Disabled automation keeps its manual defaults, and rejection does not waive an enabled policy obligation.

## Inspect worker context

Use `abra_work_diagnostics` with `issue_id` and an optional `role`. Its `contexts` entries remain available when capability validation fails before session creation. They show captured provenance, context/policy identity, effective agent/model selection, scope/instruction references, required skills and tool alternatives, latest tool observation and a concrete blocker/clearing action. Existing `sessions` diagnostics retain their model and provider-error fields.

`captured` describes AbraCode-supplied context, not the complete native prompt or model memory. A skill's `loading: unobserved` means it was available; this does not prove it was consumed. References are historical discoveries or declarations. `current_inventory: not_observed` and observation timestamps prevent stale availability from looking current after a worktree retires. Large collections are limited with an omitted count; internal admission prompt bodies and role guidance are not returned.

A diagnostic read does not resume work, answer a question or authorize a checkpoint. Repair the named requirement in the target native configuration, then use the existing explicit retry flow when needed. Old records without capture display `legacy_unavailable`; damaged evidence displays `invalid` without hiding other roles.

## Browser CLI

Install the central dependencies, then provision a browser explicitly as the user running the service:

```sh
pnpm install --frozen-lockfile --prod=false
pnpm browser:install
```

On Ubuntu, `pnpm browser:install --with-deps` also installs browser libraries and can require sudo. The upstream dependency helper supports apt/dnf/yum, **not pacman**. On CachyOS/Arch, the operator can install distribution Chromium and its dependencies with `sudo pacman -S chromium`, then set `AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium` in the service launch environment. Alternatively download Chrome with the script and supply its required libraries using the distribution packages. Workers do not install host packages. Restart the service while workers are idle after environment changes.

`pnpm doctor` reports CLI execution failures with central install/build repair instructions. It intentionally avoids upstream `agent-browser doctor`, which may clean stale daemon sidecars. Browser launch is an explicit smoke check; with a reachable local app, use a fresh name and close that exact name:

```sh
pnpm exec agent-browser --session abracode-operator-smoke open http://127.0.0.1:3000
pnpm exec agent-browser --session abracode-operator-smoke snapshot -i
pnpm exec agent-browser --session abracode-operator-smoke close
```

All four worker roles discover `abra-browser`. Their captured assignment supplies `abracode-<native-session-id>` and `<home>/.abracode/browser/<native-session-id>/`. The skill loads `agent-browser --session <assigned-name> skills get core` and uses named CLI commands for browsing and screenshots. Concurrent names have separate browser navigation and state. Do not share a default `AGENT_BROWSER_SESSION` across workers or automatically attach to personal profiles. Close only the assigned browser, including manual recovery after a crash; closing a browser does not retire an execution.

Screenshots live outside managed repositories and native read access adds only the assigned session directory. These files are scratch evidence, not retained report attachments or automatically backed-up reports. Research reports must preserve findings, URLs and limitations independently of a local image path. No browser cleanup daemon or preview manager is added. Apply can start its scoped development server; other roles inspect an existing URL or report the missing prerequisite through worker reporting.

### Reading approval and finish outcomes

`abra_work_approve({issue_id, kind:"merge"})` requests or collects the native form. Pending responses retain `approval_required` and `form_id`; an accepted response reports the persisted approval without running merge/cleanup inline. Reconciliation continues authorized delivery automatically. Observe `abra_work_status` for its independent `outcome` stages and observation time. Existing execution fields remain available; synchronous callers must no longer assume approval completes finalization.

`abra_work_finish({issue_id})` reports verified delivery separately from cleanup and issue closure. Ordinary retained files return a successful classified observation with `outcome.cleanup.state: "blocked"`, phase `cleaning`, quoted relative path samples, truncation, captured generated directories and a disposition action. For example: “Delivery verified; cleanup blocked by retained files; issue open.” Answer the current exact-action finishing form: authorize selected generated directories, preserve items elsewhere for fresh absence inspection, or defer. Matching answers resume eligible work automatically; an explicit finish is only a request for immediate inspection. This observation grants no deletion authority.

If either request returns `category: "operation_in_progress"` and `performed: false`, say “An operation is in progress; this request did not run or queue.” Read status again; recollect only a still-missing approval. An unconfirmed external result must not be described as a failed or definitively pending merge. A busy result does not identify another server. Rejected forms, stale content, unsafe ownership and uncertain effects still use native failed tools; status retains any earlier committed approval/delivery evidence.

### Automatic finishing

Merge readiness includes the owned local branch, exact remote PR head and read-only retirement preflight. Late existing edits pass fresh verification and independent Review before the controller fast-forwards the same open PR. The execution retains two automatic synchronization admissions across restart; further input requires a single-use exact-content form. This allowance is independent of `diagnostic_turns` and `repair_rounds`. Failed revalidation cannot grant new coding authority. Full-spec revision planning preserves previous archives and uses configured planning approval; the controller skips Apply for existing edits.

Unknown files receive mandatory native forms at detection, independently of optional diagnostics and capacity. Generated-directory answers are execution-specific and never change `generated_paths` defaults. Inclusion selects exact file hashes before publication. Preservation means moving files outside the owned worktree and awaiting a fresh scan. Defer leaves the work quiet; reconsider deliberately opens a new form for the current decision. A pending/undelivered question remains visible in status and native detail. Approval collection remains receipt-only; ordinary reconciliation handles merge, authorized disposal, native retirement and graph closure after matching answers. Pause, external custody and unresolved decisions remain authoritative.

Observe `outcome.finishing` for allowance use, synchronization stage, preflight age and current decision routing. These are observations, not authorization. Already merged PRs are inspected before selecting republication; late unpublished edits require follow-on authorization. Uncertain destructive submission, resource replacement or missing preservation stays in recovery. Completion notification retries independently after verified closure. See [recovery](recovery.md#finishing-existing-work) for exact crash-window behavior.

### Operational supervision modes

Omit `supervision_mode` to retain existing settings. Explicit `manual` disables
new automatic dispatch and optional diagnostic/repair admission, while existing
observation, exact-action forms and authorized deterministic reconciliation
continue. `attended-automatic` enables scheduling and meaningful attention turns.
`unattended` enables the same bounded scheduling/diagnostics and retains
human-owned questions as pending incidents for later attention instead of waking
Abra to collect them. Native forms remain available. Both automatic modes use
existing per-execution budgets; neither grants repair rounds or approval.

An explicit contradictory `auto_schedule` is rejected. Operational settings take
effect after service restart. `pnpm config:show` displays the resolved mode,
scheduling and optional-reasoning behavior. Pauses, accepted scope, Review,
verification and exact plan/merge authorizations retain their existing owners.

`abra_work_list` includes a bounded `supervision` aggregate (at most 128 tasks,
open tasks first, assigned workers first within that group, then priority and ID). Counts cover the returned task summaries;
`total` and `truncated` disclose the bound. `abra_work_status` and the native work
RPC expose the same read-only projection. The primary classification uses this
precedence: completed, recovery, paused, human decision, supervisor decision,
provider failure, review failure, validation failure, delivery wait, dependency
wait, suspected stall, pending admission/capacity, running, idle, unknown. Other
blockers and independent delivery/cleanup/closure evidence remain in detail.
Each summary includes an observation time and native activity availability.
Unavailable evidence does not imply idle or successful completion.

### Task model selections and profiles

`abra_config` with `action: status` includes the loaded model defaults, complete
role overrides and up to 32 configured profiles. The catalog labels native
inventory as unobserved; availability is verified by the existing OpenCode
worker-location preflight. Static `pnpm config:show` also lists profiles and
repository dispatch declarations.

```yaml
profiles:
  fast-research:
    role: research
    model: { providerID: your-provider, id: your-research-model }
repositories:
  - id: api
    path: /absolute/path/to/api
    dispatch:
      research: { profile: fast-research }
```

A task or batch task can include `dispatch`, for example
`"dispatch": {"research": {"profile": "fast-research"}}` or
`"dispatch": {"apply": {"model": {"providerID": "your-provider", "id": "your-model"}}}`.
Each role selects one model or one profile. Profiles contain only a worker role
and complete native model selection; they cannot change agents, tools, skills,
permissions, quality policy or approvals. A complete selection owns its variant:
omitting it uses that model's default instead of inheriting another model's variant.

Precedence for each role is task model/profile, repository model/profile, role
override, then default. An explicit repository `dispatch: {}` clears its defaults;
omission during registration preserves retained settings. Task dispatch must
contain a selection. Dispatch is part of immutable task/batch request identity.

Every new execution captures all resolved role choices and provenance before
provisioning. Status, diagnostics and worker inspection expose that captured
source. Profile edits and restarts affect future executions. Unknown/mismatched
profiles are refused before intake. Unavailable native models/variants retain a
concrete blocker, release the unused active slot and never select a fallback.
Restore the captured native selection and explicitly retry, or create a new task
with a different selection; retained claims/resources are not silently discarded.
Process model/profile configuration changes require service restart.

### Optional project leads

Abra can register a persistent, bounded project context with `abra_lead_control`:

```json
{
  "action": "register",
  "id": "backend",
  "expected_revision": 0,
  "repositories": ["api"],
  "model": { "providerID": "example", "id": "strong-model" },
  "enabled": true
}
```

The registration owns a native session intent before creation. It selects the
static hidden `project-lead` agent and a complete model, with no provider fallback.
This is a management principal, separate from Explore/Apply/Review/Research.
It has one endpoint, `abra_lead_action`: scoped issue snapshots, correlated
replies, bounded batch proposals, supervisor-owned routine answers and forwarding
of retained findings. File/search/shell/delegation tools and global configuration,
installation, project-list and work-list tools are omitted. Leads use controller
snapshots for evidence. Abra remains the conversational entry point.

Use `status` to inspect current revisions, requests and proposals. Send a scoped
request with `action:message`, `id`, `revision`, `issue_id`, a stable `request_id`
and `body`. An identical retry keeps its native ID; changing content is refused.
A native queued/consumed instruction does not constitute an answer. Replies and
proposals produce idempotent native synthetic details in their parent Abra
conversation without starting a new diagnostic turn. Abra accepts a retained
proposal with `action:accept`, `id`, `revision`, `request_id`; existing atomic batch
intake owns creation, policy validation, dependencies and retries. Acceptance is
not dispatch, plan approval or merge approval.

Enabled leads observe scoped completed/failed/recovery work and supervisor-owned
questions through the existing monitor. Each requested lead turn consumes the
source issue's existing finite diagnostic budget, shared with Abra diagnostics,
and one existing attention-capacity slot while native admission/execution is
active or uncertain. Manual posture suppresses new lead turns. Exhausted budgets
leave source decisions and retained work visible; lead registration grants no
additional repair or approval budget. Human questions/forms remain Abra-owned.

A verified omitted lead reply follows the same one-reminder rule. Its original
request and its reminder each consume one source-issue diagnostic turn. Recovery
uses the existing management-capacity slot and current enabled registration;
disable, scope/model revision and stop cannot be bypassed. Requests can exist
before an execution, so a lead's `request.response_escalation` retains its bounded
problem description and idempotent parent synthetic-notice receipt on the original
request. Inspect it through `abra_lead_control status`. The notice starts no model
turn and does not supply a reply. A subsequent accepted answer retains separate
reply evidence and its own existing parent-notice identity.

To disable, repeat `register` with the observed `expected_revision`, unchanged
repositories/model and `enabled:false`. Revocation persists before native queue
cancellation and interruption. `stop_pending:true` retains the reservation; retry
the same declaration until stop is confirmed. Re-enable only after confirmation.
Changing scope/model requires a disabled, quiescent registration and explicitly
creates a fresh native context. The old session identity remains revoked. This
prevents earlier project history leaking into a narrower scope. An ordinary
service restart or unchanged declaration keeps its original native session.
There is one lead level and one shared controller/work graph. These permissions
are same-user application boundaries, not OS isolation.

### Portable visual reports

`abra_work_report` keeps its default read-only Markdown response. Use
`{"issue_id":"abra-example","action":"artifacts"}` for bounded visual-revision
summaries. Explicit generation is separate from diagnostic read authority:

```json
{
  "issue_id": "abra-example",
  "action": "generate",
  "request_id": "architecture-r1",
  "title": "Architecture and retained evidence"
}
```

A Research worker can include `render: {request_id: "architecture-r1"}` in its
ordinary `abra_research_report` submission. Optional `diagrams` on that report
are plain Mermaid data with titles and sources, retained in its Markdown input.
This does not grant template editing, shell, management or delivery tools. Abra
can render completed retained work without reopening it or creating another
worker session. A new visual request may supply constrained `diagrams` annotations
or an empty array to replace earlier diagram presentation; it changes no accepted
research evidence, scope, check or approval. Request identity binds these inputs.

OpenCode owns the existing file preview. The Reports owner captures read-only
work/receipt/report inputs, validates them, and builds only the installed trusted
Vite/Solid renderer. It never imports repository TSX/JavaScript, executes report
text, or accepts a build command/template path. Generated diagrams forbid HTML,
links, config directives, escapes and external resources; the strict build-time
compiler also inspects SVG resources. Unsafe evidence links remain inert text.
Reported findings and actual controller check receipts are labelled separately.
Every page states its observation time and is a static snapshot.

Outputs live under `.abracode/reports/generated/<issue-id>/<request-id>/index.html`.
The retained request captures the snapshot, template/input hashes and source
receipt. Builds use fresh owned scratch directories, independent source/cache/
output paths, two shared compiler reservations and a 45-second deadline. Native
Node config loading avoids shared temporary config bundles; license and Mermaid
inputs are parameterized. No shared `report.tsx` or `dist/index.html` is edited.
The existing monitor recovers authorized pending work without model polling.
Restart retains a compiler reservation until its recorded deadline before retrying
that same captured request. Failed builds require an explicit retry; changed
trusted template/data needs a new request. A superseded source is not silently
recaptured under the previous identity.

Only validated single-file HTML receives a published receipt. Same-filesystem
hard-link publication is atomic and refuses replacement of an occupied file.
Recovery checks staged/published bytes against the retained digest before any
rebuild. Earlier revisions and unrelated files are preserved. Cleanup removes
only the current scratch directory after checking its identity, and its retained
staging file after checking its digest. Orphaned scratch from a hard crash is
preserved for inspection. Published artifacts survive worker/worktree retirement.
Ready/failure details use stable native synthetic message IDs; they do not start
supervisor-model turns. Only `status:published` is a ready report.

Return a published path as `[Open report](</absolute/path/index.html>)` for native
HTML preview or open that same file in an ordinary browser. It needs no server,
network or storage privileges. Local feedback exports review input only; it never
approves work or silently submits a prompt. Graphical-client click-through is an
environment-specific handoff: current verification includes the exact sandbox's
browser behavior and pinned client source, but no paired native GUI session.
