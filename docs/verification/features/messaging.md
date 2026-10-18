# Correlated native messaging

Use the existing [disposable verification prerequisites](../README.md). The
native harness holds Explore, sends a queued answer-required request through
`abra_work_message`, retries its identity, then releases the provider. The worker
invokes actual `abra_worker_reply`; Abra retrieves its exact retained answer
through `abra_work_messages`. The fixture separately submits a Research finding,
retires that read-only worker, forwards the finding to current Apply, and verifies
Apply's explicit acknowledgement without changing the accepted short scope.

```sh
ABRACODE_TEST_JOURNEY=engineering \
ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-messaging-forward-20261018 \
  pnpm exec vp test run --project e2e tests/e2e/native.test.ts \
  > /tmp/abra-messaging-forward-20261018/native.log 2>&1
```

Observed result: one native test passed in 94.97 seconds;
`native-engineering.json` records `result: pass`, `cleanup_complete: true`, the
correlated answer identity/body and the source/destination sessions with
`acknowledgement: acknowledged`. Logs and JSON remain outside the removed
installation. The earlier queue/reply-only run passed in 94.37 seconds at
`/tmp/abra-messaging-native2-20261018`.

The same journey retains original assignment identity, exercises genuine prompt
guards, rejects worker management tools, and preserves full-spec human approval,
independent Review and lightweight correction. It uses only loopback providers
and disposable local remotes. A provider can receive one admitted instruction in
several model requests; the test separately counts native user instructions.

Unit tests in `messages.test.ts` cover generation/sender/recipient validation,
immutable request/reply/finding identity, byte/evidence limits, legacy reads,
admission versus acknowledgement versus answer, response loss, concurrent early
reply, bounded mutation-free inspection and decision-answer delivery referencing
one obligation. `native-message-admission.test.ts` covers exact native payload
reconciliation and cancelling all owned queue entries before one interrupt.

An unchanged retry after phase/generation changes reads the old request without
reviving its recipient. A fresh request still needs an eligible current worker.
Resolved replies survive generation changes; unresolved requests are superseded
on confirmed control transitions without being presented as answered. Missing
or failed native observations never establish non-admission.

The tool slice's full regression passed `pnpm check`, `pnpm test` (371 tests in
62 files) and `pnpm test:e2e` (both tests in 222.83 seconds). Full native evidence
is retained at `/tmp/abra-messaging-full-20261018`; its JSON records pass and
completed cleanup. Queued/interrupted restart acceptance and notification
recovery remain separate gates in group 3 of the OpenSpec tasks. These results
do not claim automatic finding routing, arbitrary model quality or live
provider/GitHub delivery.

## Message transition contract

The controller owns immutable request intent; OpenCode owns queue admission and
execution. The current assigned worker alone can commit an acknowledgement or
answer. These are separate facts: neither inbox admission nor successful native
execution supplies a business response.

| Retained disposition       | Entry evidence and owner                                                              | Permitted successors                                                                    | Reconciliation and restart                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pending`                  | Controller committed exact intent before submission                                   | `admission_uncertain`, explicit cancellation or supersession                            | Validate current assignment, role, generation, location and capacity before submission.                                                                      |
| `admission_uncertain`      | Controller persisted submission intent before the native call; its receipt is missing | `admitted`, authenticated acknowledgement/answer, explicit cancellation or supersession | Inspect the original native ID and exact payload. Absent or unavailable evidence cannot authorize another ID or prove non-admission.                         |
| `admitted`                 | Native inbox or retained user input matches the exact ID and payload                  | `acknowledged`, `answered`, explicit cancellation or supersession                       | Observe queued versus consumed separately. An eligible verified queue wake reuses the exact ID and payload; failure/interruption requires explicit recovery. |
| `acknowledged`             | Expected current worker explicitly acknowledged the original request                  | `answered`, explicit cancellation or supersession                                       | Terminal for acknowledgement-only requests; an answer-required request still blocks completion.                                                              |
| `answered`                 | Expected current worker committed a bounded correlated answer and evidence            | Historical retention; explicit control disposition preserves accepted evidence          | Keep the accepted answer readable after generation/assignment changes. A later native outcome cannot invalidate it.                                          |
| `cancelled` / `superseded` | Explicit controller control transition                                                | No revival                                                                              | Reconcile queue cancellation and stop confirmation. Preserve accepted evidence; cancellation cannot undo consumption.                                        |

Every row retains the original request ID, native prompt ID, sender/recipient and
generation. Worker requests additionally bind assignment and role; lead requests
bind registration revision. New worker replies require the current session,
generation and eligible request. Historical reads confer no new reply or prompt
authority. Identical retries return retained evidence; changed identity/content
is refused. Legacy requests without `response` require no response, but can still
have queued transport work.

The executable transition evidence is mapped below. These names identify tests,
not claims that a future invocation passed:

| Contract                                                                                                   | Existing behavioral proof                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persist-before-call; uncertain admission across restart; absence does not permit replacement               | `messages.test.ts`: lost steering response with native admission true/false; failed admission bookkeeping                                                 |
| Admission, acknowledgement and answer differ; duplicates cannot rebind; history survives generation change | `messages.test.ts`: admission, acknowledgement and answer remain separate with immutable duplicate replies                                                |
| Replies during admission survive fresh record commits                                                      | `messages.test.ts`: a reply committed during native admission is not overwritten                                                                          |
| Exact payload, delivery, attachments, current role/session/generation and location guard authority         | `messages.test.ts`: native prompt hook validates exact steering payload; foreign senders/wrong location; pause cancels every owned prompt                 |
| Successful follow-up does not erase assignment failure; late event does not overwrite stronger observation | `messages.test.ts`: later successful message cannot mask original failure; late native failure event preserves prompt-bound failure                       |
| Exact admission lookup and bounded compaction fallback preserve native evidence                            | `native-message-admission.test.ts`: native admission observation validates payload; assignment outcomes remain bound across later messages and compaction |
| Cancel/consume race does not fabricate a stop                                                              | `native-message-admission.test.ts`: cancel/consume race leaves stop unconfirmed                                                                           |
| Failure/interruption cannot be retried by queue wake                                                       | `messages.test.ts`: queue wake never retries a failed or interrupted native execution                                                                     |
| Notification loss cannot erase a committed response or unanswered obligation                               | `attention.test.ts`: worker results coalesce across admission failure/restart; missing responses stay visible with exhausted diagnostics                  |
| Lead revision/disable preserves history without stale authority                                            | `leads.test.ts`: shared native request recovery; disable confirms stop before revision; retired sessions never regain authority                           |

Native duplicate-ID reconciliation precedes the plugin prompt hook in pinned
OpenCode 2.0.28. A conflicting duplicate returns the original native payload;
the controller refuses changed content and no changed instruction is admitted.
See [API evidence](../../supported-apis.md#prompt-admission-and-replay-audit).

## Restart, failure and notification audit

The queued-request restart journey passed in 97.11 seconds at
`/tmp/abra-queued-restart5-20261018`. It restarts only the disposable child
server while the request remains queued, then observes the same native prompt
and one correlated answer. Native context may start at a compaction boundary;
exact message lookup and server-issued history pagination are exercised too.

The broader run at `/tmp/abra-message-recovery-full-20261018` verified the queued
restart, Research-to-Apply acknowledgement, a provider failure before a required
answer, and another server restart. Its retained observations include
`unanswered_request_restart` with `outstanding: 1`, stable prompt/session/worktree
identities, earlier acknowledged/answered evidence and explicit recovery. The
whole run **failed** later in the separate PR-feedback diagnostic-slot fixture;
these subscenario observations are not a full-suite pass.

The preceding failed trace at
`/tmp/abra-message-recovery-native4-20261018` exposed adjacent native failed and
succeeded idle markers without execution between them. The adapter now preserves
the failure instead of manufacturing recovery from that empty success. A paused
previous assignment's outcome is distinguished from failure in current owned
inputs before waking a verified queue. Unknown failure ownership stays stopped.

`attention.test.ts` exercises coalesced replies/findings, lost notice admission,
stable diagnostic identity across controller restart, terminal research notices
and exhausted budgets. Required responses and mandatory worker decisions remain
retained independently of optional notifications. `messages.test.ts` also proves
pause of failed work keeps its real recovery checkpoint; cancellation and an
explicit resume reuse the session but supersede the old instruction.

The reporter prerequisite on this host uses the documented
`REPORT_CHROMIUM_PATH=/tmp/opencrew-report-browser/chrome/linux-155.0.8059.84/chrome-linux64/chrome`.
The cached Playwright binary fails in the system loader; the existing compatible
Chrome passes all four reporter integration tests. This is an environment
selection, not an application fallback or an automatic browser installation.

The completed communication gate passed `pnpm check`, `pnpm test` (386 tests in
62 files), and `pnpm test:e2e` (both tests in 224.19 seconds). The final native
run was executed separately from the unit suite at
`/tmp/abra-message-recovery-full3-20261018`; retained JSON records `result: pass`
and `cleanup_complete: true`, the exact answer, forwarded acknowledgement and
unanswered request across failure/restart. The full run also passed the separate
PR-feedback and finishing assertions. A narrow ProcessRunner integration check
passed four tests including self-termination signal evidence; command failures
now preserve that cause rather than reporting only the platform's `Unknown`.
No live provider or remote delivery performance is inferred from these results.

## One-response recovery native recipe

Run the isolated omitted-response scenario without paid credentials:

```sh
REPORT_CHROMIUM_PATH=/path/to/compatible/chrome \
ABRACODE_TEST_JOURNEY=reply-recovery \
ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-reply-recovery \
pnpm exec vp test run --project e2e tests/e2e/native.test.ts
```

The loopback provider deliberately omits two worker responses and one lead
response. Assertions require exactly one response-only reminder per original ID,
two correlated answers, one exhausted acknowledgement incident, restart-stable
identities, one parent notice and no fabricated source execution. Explicit worker
pause and lead disable verify empty inboxes before fixture teardown. This scenario
also runs in the normal native suite. It deliberately pauses the task after its
communication assertions; it does not establish complete task-delivery quality.
Inspect `native-engineering.json` after teardown for actual result and cleanup.

`response-recovery.test.ts` forces concurrent ticks, early replies (including the
native guard boundary), ambiguous/lost admission, native uncertainty, capacity
wait, pause and diagnostic-budget races. `leads.test.ts` covers the same finite
lead contract, revocation and parent-notice receipt loss. A successful native
admission never substitutes for an acknowledgement or answer. Recovery metadata
and accepted reply history remain retained; use the [recovery runbook](../../recovery.md)
for authorized clearing actions.
