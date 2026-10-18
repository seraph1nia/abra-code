# Stateful ownership and retry ledger

Implementation audit at the reduced reliability/visibility checkpoint. Future
delegation/digests belong to `expand-management-autonomy`; this is not a completed
P2 maintenance claim. SQLite owns graph mutation, plugin records own controller intent, and
native OpenCode owns admission/context/execution. None substitutes for another.

| Owner                    | Retained writes                                                                                                                        | Native/external effects                                                                                                                               | Serialization and caller validation                                                                                                                                                                                                         | Retry / crash rule                                                                                                                                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Messages                 | Execution communications, immutable reply evidence, single recovery reservation and source diagnostic charge; Attention owns incidents | Exact native admission/read/wake/cancel and parent notices                                                                                            | Execution operation ownership; short controller commits merge fresh records. Current session, role, generation, assignment, location and exact trusted prompt are checked before new admission and in the native guard                      | Reserve uncertainty before submission. Observe/replay the same identity; uncertain absence never creates a replacement. Reserve one reminder durably before admission. Accepted historical replies survive control changes                                           |
| Leads                    | `lead/<id>` registration/revision, retired identities, requests/proposals, correlated replies and notification/escalation receipts     | Idempotent session creation, captured native model/permissions, prompt/cancel/interrupt, synthetic parent notices; ordinary intake on Abra acceptance | Per-lead lock then short reentrant controller coordination. Parent Abra and current enabled lead principals are separate. Project scope is checked at each mutation. Native admission/stop occurs outside global coordination               | Native identities are retained before effects. Lost receipts reuse identity and exact intent. Revision/disable supersedes future requests, not accepted history or committed work. Authority scans fail closed on any malformed/conflicting registration             |
| Attention                | Execution incidents, prompt IDs, diagnostic charges and explicit dispositions                                                          | Existing native supervisor prompts and read-only observations                                                                                         | Per-execution attention lock then short controller coordination. Current generation, posture, finite budget, captured supervisor and shared management capacity gate new prompts. Diagnostic tools cannot start/resume/approve/deliver work | Persist admission uncertainty first, at most three existing admission reconciliation attempts; no new budget from restart. Business responses remain Messages-owned. A confirmed plan checkpoint supersedes an active old stall without refund or approval           |
| WorkerSessions / Runtime | WorkerSessions updates execution ownership/capacity and failure observations; Runtime owns no parallel execution store                 | Native sessions/inbox/context/exact/history, agent/model selection, permissions, prompt/interrupt/forms/worktrees                                     | Existing execution ownership and native role guards; runtime observations never confer authority. Per-tick batching/caches are discarded after mutation                                                                                     | Input-bound outcome and idle identity prevent unrelated success attribution. Separate reads can be inconsistent: transient unconfirmed completion preserves capacity/obligations while actual executing/inbox state remains available for explicit stop/same-ID wake |
| Advancement / Operations | Execution lifecycle, operation intent/fingerprints, reservations/checkpoint receipts, graph claims/closure                             | Existing repository/worktree/spec/check/review/delivery adapters                                                                                      | Per-execution operation lock, short controller coordination and atomic SQLite ownership. Caller tools enforce role and approval boundaries; native/build work stays outside the global commit section                                       | Retain intent before external effects; uncertain operation stays recoverable. Current-content gates, captured policies and independent Review remain mandatory. Native worker success alone is not task verification                                                 |
| VisualReports / Reports  | Existing execution report intents, build state, hashes, publication and native-notice receipts                                         | Isolated Vite build, atomic artifact publication, exact native file-link notice                                                                       | Owned report lock and two existing build slots; source execution/generation/report identity and owned paths/hashes are verified. No compiler wait belongs to global controller coordination                                                 | Same request/snapshot/hash across retry. Lost file-link or publication receipt reconciles the retained identity. Missing/tampered/stale output fails visibly; interrupted build reservations remain finite and do not authorize a new source                         |
| Visibility / Queries     | No lifecycle, message or fleet writes; TUI selection/scroll state is ephemeral                                                         | Bounded read-only native activity and existing paginated history/owned artifact reads                                                                 | Authenticated existing observer RPC, no management action handler. Corrupt lead records are isolated for display; the authority reader remains deny-first                                                                                   | Offline UI retains an explicitly stale snapshot. Completed-today uses graph closure events, not mutable execution timestamps or the visible closed page. Unknown native evidence stays unknown                                                                       |

## Demonstrated simplifications

- `requestHistoryError` gives worker/lead request histories one immutable-intent,
  monotonic-recovery validator. Their ownership/budget/native-permission paths
  remain separate because they are different authorities.
- One `responseState` classifies exact consumed/completed evidence for worker and
  lead recovery. A shared prompt-ID helper covers original and reminder stop
  semantics without a broker or a second message history.
- Native admission batching indexes one inbox/context observation for relevant
  IDs. A single reconciliation tick reuses observations until a mutation. Terminal
  history does not drive recurring transport reads; worker outcome observation
  remains independent.
- One lead decoder/scanner supports best-effort visibility and fail-closed
  authority. Display logic cannot promote a malformed registration into Abra.
- Existing work events supply a read-only completion aggregate and one index.
  No fleet table, status mirror or background UI process is introduced.

## Measurements and remaining work

[Complexity snapshot](evidence/complexity-p01.json) counts comments and blank lines
consistently in production source, plugin/scripts and shipped reporter code. At
this intermediate checkpoint: 31,500 to 33,517 lines, 181 to 184 files. Two
optional shared request containers have ten nested fields; there is one new
closure-event index, zero new stores/tables, zero production background processes
and zero external dependencies. A positive LOC delta is not a maintainability
claim: the justified changes are bounded recovery and explicit native-observation
semantics, shared transition checks and simpler recurring I/O.

The first fresh full soak cycle at `/tmp/abra-p01-soak/cycle-1/runner.json` measured
10,718 completed controller critical sections, 55.56 ms maximum held time and
723.68 ms maximum acquisition wait. Message reconciliation had 172 observations,
23.33 ms mean and 918.90 ms maximum. Scheduler ticks reached 5,679.46 ms; that is
whole-tick work, not eligibility wait. Five report builds reached 3,920.36 ms.
These concurrent disposable fixtures are not a production latency guarantee and
do not alone prove every long-build/scheduler interleaving. Final P2 tests must
still exercise that boundary explicitly.

Unresolved-history caps currently refuse new entries rather than evict authority:
256 execution communications/incidents, 128 lead requests, 32 proposals and 32
retired lead sessions. Array caps are not full-history archival. Pressure,
stop/revoke races, new grant transactions and digest crash windows remain explicit
P2 verification work. The earlier intermittent native LEAD_CAPACITY refusal has
no captured occupied-incident identity; the independently reproduced stale-stall
fix must not be presented as proof of that failure's cause.

The final [checkpoint](checkpoint.md) records later native failures and higher lock/wait maxima; the earlier cycle measurements above remain historical. Independent Review and full repeated acceptance remain open. No new P2 implementation is included.
