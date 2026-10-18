# Implementation evidence

## P0.1 audit refresh — 2026-10-18

Implementation started at `d38274bb72697a92cd0fdd52bab4cd065a3688dd`, the same
production revision inspected in [the planning audit](audit.md). Only the new
change directory was untracked. The audit's source findings still apply:
required responses block completion without a finite reminder, and resolved
current-assignment history receives recurring native transport reads. Lead
authority remains proposal-only. Work visibility and notification ownership have
not changed. No production fix was inferred solely from those observations.

The messaging runbook now maps dispositions, authority, immutable identities,
restart behavior and transitions to named executable regressions. Additional
tests cover failure/interruption immediately after admission, exact lookup after
compaction, bounded missing-history pagination, and duplicate/reordered native
events preserving prompt-bound failure and the unanswered request.

| Executed command                                                                                                                                                                                                                                                | Result                                                                                                                                                                                                                        | Retained evidence                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `REPORT_CHROMIUM_PATH=/tmp/opencrew-report-browser/chrome/linux-155.0.8059.84/chrome-linux64/chrome pnpm test`                                                                                                                                                  | Exit 0; 445 tests, 71 files, 247.57 s. The planning-time SIGSEGV did not recur. Four newly added unit cases were loaded during this run; the later event integration case has separate evidence.                              | [Baseline suite](evidence/apply-baseline-test.log) |
| `pnpm exec vp test run --project unit tests/unit/messages.test.ts tests/unit/native-message-admission.test.ts tests/unit/attention.test.ts tests/unit/obligations.test.ts tests/unit/leads.test.ts tests/unit/supervision.test.ts tests/unit/scheduler.test.ts` | Exit 0; 59 tests, 7 files, 20.63 s. Existing assertions unchanged.                                                                                                                                                            | [Focused suites](evidence/apply-focused.log)       |
| `pnpm exec vp test run --project integration tests/integration/effect.test.ts --project unit tests/unit/native-message-admission.test.ts`                                                                                                                       | Exit 0; 15 tests, 2 files, 6.90 s, including the later bounded-history and reordered-event regressions.                                                                                                                       | [Event/history suites](evidence/apply-events.log)  |
| `pnpm check`                                                                                                                                                                                                                                                    | Exit 0; formatting, lint, TypeScript, Effect diagnostics and reporter checks passed; zero reported diagnostic errors/warnings. The last integration test was added after this invocation began; final checks must include it. | [Checks](evidence/apply-check.log)                 |

The first new event-test attempt failed its setup assertion: the fake native
observation lacked an error, so it did not create `worker_failure`. Supplying a
prompt-bound native error and timestamp made the fixture express the intended
case. No production behavior or expected assertion was weakened. This is a test
fixture correction, not a demonstrated application defect.

The isolated native baseline passed `pnpm test:e2e`: both tests/files, 415.18 s,
exit 0. [Its log](evidence/apply-e2e.log) is retained here; the external receipt
`/tmp/abra-operational-apply-native/native-engineering.json` records `result:
pass`, `cleanup_complete: true`, observed at `2026-10-18T08:20:28.833Z`, with 24
observations after teardown. It exercises queued restart, withdrawn queued
instructions, unanswered failure/restart, accepted answers, forwarded
acknowledgements, direct/forged prompt refusal, captured models and lead scope.
The installed source predates the following recovery-contract edits; it proves
the existing audit paths, not automatic missing-response recovery.

## P0.2 contract and causal observation

`RequestSchema` now has optional single-slot `response_recovery` metadata. Its
absence confers no new authority. The reservation binds exact reminder text/ID,
creation time, verified idle ID/time and monotonic transport state. Request
history checks forbid removing/replacing the slot or reversing its state;
ordinary immutable request/reply checks remain intact. Lead saves now use the
same request-history validator. Worker/lead schemas reject conflicting native
prompt identities.

The native adapter exposes the bound idle ID/time on the existing assignment
observation. `responseState` classifies required response state without effects:
only exact consumed input and a bound successful turn while definitely idle can
establish `missing`. Absent uncertain admission, missing/older idle evidence,
failure/interruption, queued/busy state and unavailable observations cannot.

New and existing message/lead/response/native-admission unit suites passed: 41
tests in four files, 14.27 s ([log](evidence/apply-contracts.log)). The narrower
causality/native-admission run passed seven tests in 2.97 s
([log](evidence/apply-response-causality.log)). TypeScript also passed after the
adapter/classifier change. Automatic reminder admission, guard recognition,
escalation, native omitted-reply proof and the P0 checkpoint are still pending.
No paid provider, live service, user remote or production worktree was used.

## P0.2 finite worker and lead recovery — 2026-10-18

The original request owns one optional immutable reminder reservation. Its ID is
saved before submission, and ambiguous admission never permits a replacement.
Only verified consumed input plus a bound successful native idle marker allows
response-only recovery. Queued/busy/unavailable/failed/interrupted observations
retain the obligation. Pause, revision, revocation, native location and original
session/generation/role checks remain controller-owned. Shared captured diagnostic
budgets and existing worker/management capacity apply. There is no new retry
configuration, process, task, broker or database.

Worker escalations reuse Attention incidents. A lead request can predate an
execution: its bounded immutable synthetic-notice receipt stays on the request,
without fabricating an execution or a supervisor model turn. Accepted historical
answers remain readable after revision. Original and reminder transport identities
are included in explicit cancellation. An early response can suppress an unused
pending reminder; an uncertain reminder is suppressible only when the native
new-prompt guard itself proves refusal before admission. Business completion
cannot erase uncertain transport.

Two deterministic races were reproduced: inferred unanswered Attention consumed
the only diagnostic before Messages could classify recovery, and a routine reply
notice consumed the diagnostic needed by another unresolved response. Messages
now owns missing-response classification; routine notices stay pending until
unattempted business responses have priority. No diagnostic budget is refunded.
The latter [red regression](evidence/routine-reply-budget-red.log) and
[green focused run](evidence/routine-reply-budget-green.log) are retained: 71 tests
in four files passed in 26.19 seconds. Earlier red/green audit evidence also
records a moved lead session receiving admission before its location check;
location is now verified before admission and freshly inside the native guard.

The [isolated native journey](evidence/reply-native.log) passed in 22.19 seconds.
Its [post-teardown receipt](evidence/reply-native.json) reports pass and confirmed
cleanup at 2026-10-18T09:22:14.882Z. Two worker requests and a lead request each
produced exactly one original input and one reminder. Two original requests were
answered; one acknowledgement obligation exhausted its sole attempt and retained
one actionable incident. Native restarts preserved IDs, responses, escalation and
the single lead-parent notice. Explicit worker pause and lead disable left empty
inboxes; the lead source issue had no execution. The deterministic loopback
provider proves controller/native behavior, not real-model quality or paid usage.

A preceding native run reached the lead answer but failed a new fixture assertion
that expected work status to return an absent execution. The actual controller
correctly returns EXECUTION_MISSING. The assertion now checks that contract;
[failed-run evidence](evidence/reply-native-fixture-failure.json) confirms cleanup.
An earlier worker-stage timeout had no retained state snapshot; its cause is
unknown and is not attributed to the independently reproduced budget race. The
fixture now captures bounded request/incident/native-event summaries on timeout.
A subsequent launch left only a runner-start log and no receipt; it is unverified.

These are targeted P0.2 receipts. Full current-content gates, performance and
multi-cycle operational verification are still pending; no P2 delegation is enabled.

## P0.3 measured reconciliation work

The permanent [benchmark](../../../tests/benchmarks/reconciliation.ts) uses the
real native adapter with counted public API stubs, 35 distributions/sizes, one
warmup and five samples with repeat-count assertions. The [comparison](evidence/reconciliation-comparison.md)
retains raw pre/post samples and the intermediate source patch/fingerprints.
At 200 answered requests, session reads fell from 201 to 2 and inbox/context
reads from 401 each to 2 each (including independent assignment observation).
Three unanswered requests among terminal history need two session reads and
three inbox/context reads each, independent of history count. Fixture duration
and memory are reported separately from unmeasured native latency, coordination
occupancy and scheduler delay.

No persistent state was added for this optimization. A transient session inbox-ID
projection preserves same-ID queue wake for an already answered input. Indexed
per-tick active identities share a session observation and batched exact native
admission reads. Mutation invalidates these local observations; current guards
still authorize every prompt. A failed native worker remains failed even with
all messages resolved. Compacted/uncertain inputs still use bounded native
fallbacks; required answers remain active after acknowledgement.

The [focused run](evidence/p0-reconciliation-focused.log) passed 52 tests in
three files, 17.74 seconds. The subsequent [full unit/integration run](evidence/p0-reconciliation-test.log)
passed 475 tests in 72 files, 279.69 seconds. [Checks](evidence/p0-reconciliation-check.log)
passed formatting/lint/TypeScript/Effect/report checks. These receipts predate the
later soak-only instrumentation. The full native run remains pending: its first
attempt correctly refused the newly appended scenario because eight intentional
stopped fixture executions filled retention; the next correctly refused a worker
profile intentionally left unavailable by an earlier capability test. Their
receipts confirm failure and cleanup. The omitted-response scenario was subsequently extracted as an independent native
test using the same harness and a fresh installation. The main journey keeps its
earlier capacity/refusal assertions, settings and ownership records unchanged.
The opt-in full soak also runs a separate injected-crash fixture.

## P0.4 operational tooling in progress

`pnpm test:soak` reuses the existing isolated native installation/provider/forge
and existing asserted journeys. It declares finite cycles/concurrency/deadline,
seeded mixed-profile order and exact fault-profile coverage. It requires a fresh
external output directory and checks exit, scenario receipts, cleanup, recorded
native child PIDs and fixture-root absence. Deadline/cancellation signal only the
newly owned child process group. Normal CI does not invoke this runner. Paid
provider tests are not run.

Two communication cycles passed before measurement instrumentation, followed by
two more with instrumented isolated copies. The first measurement implementation
was found to undercount because separate plugin-module exit hooks overwrote a
shared snapshot. It is superseded by independent append-only bounded metric
segments aggregated by the runner. A calibration cycle now records all seven
expected native prompt submissions (one assignment, two originals, two worker
reminders, lead original and reminder), three native process IDs and five module
segments. This is a test-only measurement fix, not a production authority change.
Final multi-cycle/fault/idle/resource coverage is still in progress; this is not
the P0 gate and P2 remains disabled.

## P0 operational failures and current completion projection

The complete native gate passed three tests in two files, 484.26 seconds, at
`/tmp/abra-operational-p0-native-final`; both native receipts report pass and
cleanup. The concurrent unit/integration gate passed 475 tests in 72 files,
311.53 seconds (`/tmp/abra-operational-p0-unit-final.log`). These runs preceded
an additional native-observation correction found by the soak; they are not
current-content final gates for that correction.

The first complete multi-cycle soak passed cycle 1 and failed cycle 2. The
[failed summary](evidence/soak-first-full-failed.json) remains failed. Cycle 2
retained a report restart failure whose detailed build error was not captured,
and [one missing-response case](evidence/native-reply-budget-failure.json)
spent a diagnostic on provisional native uncertainty before the second reminder.
The original report cause remains unknown; current probes retain its bounded,
redacted error without dumping the captured report snapshot. This has not been
reclassified as a pass or assumed fixed from unrelated results.

A [red native-adapter regression](evidence/native-observation-race-red.log)
proved that separate session/active/inbox/context reads can observe a consumed
input after an earlier empty active snapshot. Completion uncertainty is now an
explicit **transient projection**, `SessionState.completion_pending`. It adds no
controller/database state. Native `busy` and `executing` still describe active
execution/inbox evidence. Worker advancement and reminder admission wait on the
completion projection; an existing queued identity can still receive the same-ID
native wake, and explicit native interrupt/wait can still confirm stop. The
native idle timestamp covers interruption without an idle message; a genuinely
newer contextual idle can supersede an older session outcome. UI native activity
shows unknown when completion is unconfirmed, preserving observation accuracy.

Early revisions of this fix overloaded `busy` or `executing` and blocked a native
stop/queued restart. The targeted crash journey caught those regressions before
the P0 gate. The explicit projection replaced both revisions. [Current focused
proof](evidence/native-completion-projection-test.log) passed 70 tests in five
files, 28.51 seconds; [checks](evidence/native-completion-projection-check.log)
passed, and [the current native crash receipt](evidence/native-completion-crash.json)
reports pass/cleanup for original admission loss, parent notice loss, event
loss/duplication/reordering and HTML publication before its controller receipt.
An additional unit case proves unconfirmed completion holds capacity and spends
no reminder, then admits the sole reminder once actual completion is verified.

Six native omitted-response cycles after the initial snapshot correction all
reached the communication assertions. One then failed a new fixture assertion
expecting an immediate pause result: pause can correctly return requested while
an operation is quiescing. The fixture now waits for confirmed stop before
asserting cancellation and inbox absence. The other five cycles passed. Four
probes that verified the owned compiler process before restart and two earlier
report-only cycles passed; a stronger probe now waits for actual compiler output
to target the remaining report interruption window.

A [120-second quiet native sample](evidence/native-long-idle-runner.json) passed
with zero provider requests added, 9180 ms CPU (7.65% of one core) and RSS changing
from 608824 to 508580 KiB. This used the fixture's aggressive one-second monitor
interval and excludes tool/flock/browser child CPU. It does not prove production
idle CPU, a memory-leak absence or real-model token efficiency. Three tasks were
verified/delivered and the root plus every recorded native child was absent.

The bounded CLI passed eight argument/schedule/evidence-directory checks with
zero native services launched ([receipt](evidence/soak-cli.json)). A deliberate
30-second deadline probe failed and retained ownership/measurement evidence;
its native PIDs and owned process group were absent before the agent removed
only its recorded disposable root, with a separate cleanup receipt. A second
older soak was cancelled because a test helper import changed while its fixture
installer was already loaded; its failed receipts were preserved and its exact
owned root was cleaned after the same identity checks. Neither is a successful
soak result.

The 35 pre-optimization API/storage counts were reproduced from the retained
fingerprinted source snapshots using the already-installed `tsx` binary and an
isolated source copy ([replay](evidence/reconciliation-before-replayed.json)).
The first copy omitted the reporter schema import. A subsequent pnpm execution
attempted dependency verification, which refused to alter the shared dependency
directory. Direct `tsx` replay avoids that path; the workspace lockfiles stayed
unchanged and its installed dependency/tsx timestamps remained 2026-10-17.

The operational and comparison procedures are in `docs/verification/operational.md`
and `comparison.md`. The public Firstmate reference was read and pinned to
`1aa2a21ec35e2d0644ac836b7b5d3cb36669ef33`; no Firstmate, paid provider or production
repository task was executed. P0 gate remains open pending current full repeated
verification; P1 and P2 implementation have not started.

## P0 checkpoint follow-up and native visibility work

The completion-observation source passed 477 unit/integration tests in 72 files
(`/tmp/abra-p0-completion-unit.log`, 303.22 seconds). Its first fresh two-cycle
full soak failed overall: cycle one refused a lead request with LEAD_CAPACITY;
cycle two passed the complete native, omitted-response and crash-window journeys.
Both cycles confirmed cleanup. The separate default native run also hit
LEAD_CAPACITY. Their receipts remain under `/tmp/abra-p0-completion-full` and
`/tmp/abra-p0-completion-native`; they are not passes. A fresh default native run
with bounded lead-boundary incident capture passed all three tests in 453.51
seconds at `/tmp/abra-p0-lead-slot-evidence`, with cleanup confirmed. The refusal
was not reproduced there, so its exact occupied incident remains unknown.

A deterministic attention regression independently established a concrete slot
leak: a stall admitted during Explore remained admitted after successful worker
completion and the controller's plan-approval checkpoint. The red run is
`/tmp/abra-stall-checkpoint-red.log`. Attention now supersedes active old stalls
at that confirmed checkpoint without refunding diagnostics, admitting another
turn or changing plan approval. Exhausted historical stalls remain retained. This
fix does not establish the cause of the earlier native capacity refusals.

P1.1/P1.2 now extend existing read-only visibility with all-ticket fleet and
repository counts, explicit observation coverage, event-derived host-local
completed-today, attention navigation, lead summaries and lazy paginated
communication. Work events gain one lookup index; no fleet record/table is
created. A shared lead scanner isolates corrupt records in the observer while
authority readers still reject any invalid/conflicting registration. Replies,
reminders and admission remain separate; existing worker Decisions are projected
without a second question record. Bodies expand explicitly and only Abra has
a conversation link.

The focused service/graph tests passed 85 tests in seven files
(`/tmp/abra-ui-focused-test.log`). The actual OpenTUI fixture passed
(`/tmp/abra-ui-sidebar-2.log`, 2.70 seconds), with retained frames at
`/tmp/abra-fleet-tui-frames`. It covers fleet/lead expansion, attention selection,
collapsed message bodies, recovery status and pagination, alongside existing
theme/focus/remapping/offline/navigation checks. `pnpm check` passed at
`/tmp/abra-ui-check-3.log` (273 Effect files, zero warnings/errors). Later
projection refinements are included in fresh full gates now running under
`/tmp/abra-p01-*`; no result is claimed until those finish. The 320-file
production/test/template fingerprint is [source-p01.json](evidence/source-p01.json).

Default operational evidence now removes native/provider payload fields even
inside encoded structured receipts, while preserving bounded identities, counts
and source proof. A privacy regression covers nested payload omission. Legacy
external receipts retain their original provenance; new runs use the redactor.
P2 grants remain absent. The P0 gate is still unchecked pending clean repeated
full native evidence and current-content gates.

## Operator scope boundary and final checkpoint

The operator stopped expansion on 2026-10-18. [checkpoint.md](checkpoint.md) supersedes earlier “now running” statements with actual final results, reverted last fixture edits, failure receipts, scope disposition and remaining risks. The latest unit/integration run passed 485 tests; default native and focused lead runs failed. The requested two-cycle full soak is incomplete/not passed. No new full test cycle or implementation package starts after this boundary. P2 and unimplemented outcome digests moved into the separate unapplied `expand-management-autonomy` change. Full acceptance and independent Review remain open.
