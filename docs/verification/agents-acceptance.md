# Programmable agents acceptance evidence

This file preserves the earlier worktree handoff. The implementation is now integrated into main under the user's direct Codex instruction; current combined results are in [main integration evidence](main-agent-integration.md). Native execution and approval history remain retained.

Apply observations for `abra-dad34efb-f0af-4ccc-9655-f4540c2593e3`, generation 0,
on 2026-11-18. These are implementation evidence, not controller check receipts,
independent Review or permission to deliver.

## Historical worktree checkpoint

The approved planning fingerprint remains
`abeebb83f557f0c1c1fce06d56abe8ad45323fdea7bffc806f851d14bd179a8a`.
Only task checkboxes changed; task 9.3 remains incomplete. `pnpm check` stops at
the approved change's unchanged `design.md` formatting. Formatting that document
requires the separately agreed controller replan and fresh approval.

Final `pnpm test:all` passed **772 tests in 136 files** in 206.56 s; original log:
`/tmp/opencode/abra-agents-final-complete-I0NwL7/test-all.log`. This includes the
original native browser journey and all new regressions. Full build and remaining
independent static/licensing checks passed. No implementation changes are pending;
the remaining check failure is the approved design's deferred formatting.
The operator independently read final `workspace/native-engineering.json` as
`result: pass`, `cleanup_complete: true`. Native JSON/stage originals remain
retained; worker guards prevent direct scratch-file reads, so independent Review
needs controller-routed readable retention. These observations grant no checkpoint.

The nonmutating busy refusal is confined to `Advancement.advance`: it returns
the same `WRITER_BUSY` error without invoking failure reflection. Worker/native
busy guards are unchanged. Lifecycle regressions assert unchanged phase,
assignment/context, prompt/session/control generation, native sessions and work
assignment, with zero additional prompts/sessions. Unknown outcomes still block.

The browser helper handles only that exact typed refusal at the explicit-advance
callsite. It reobserves current native status, retained identities, forward
progress/activity, unique sessions and exactly one current-assignment admission.
It never replays an advance or treats unrelated failures as this race.

The five `.opencode/agents/{abra,explore,apply,review,research}.md` removals are
attributed operator-side edits, retained in this implementation diff. The
operator reported regular-file and normalized package-body parity before
removal. Current live runtime readers no longer use those paths; remaining
source references are historical v1 provenance and protected-path refusal
coverage. Removal alone is not treated as proof of instruction delivery.

## Observed checks

Commands run through `mise exec --`. Tests additionally unset inherited
`ABRACODE_CONFIG` and `ABRACODE_HOME`; no personal configuration is changed.

| Check                                                                                                                      | Observation                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:one packages/runtime/tests/unit/worker-lifecycle.test.ts packages/runtime/tests/unit/workspace-advance.test.ts` | 25 passed                                                                                                                                |
| `pnpm test:one packages/runtime/tests/integration/native-agent-registration.test.ts`                                       | 1 passed, 12.03 s; pinned 2.3.0 late adapter registration after inventory materialization, scoped disposal/restoration and zero sessions |
| `pnpm test:one packages/runtime/tests/e2e/inspector-observation.test.ts`                                                   | 2 passed, 6.00 s; delayed reads, dirty refresh and explicit refresh                                                                      |
| Existing `web-coherence.test.ts`                                                                                           | 32 passed against the rebuilt frontend, including late prior-selection isolation and read recovery                                       |
| `pnpm check:packages`, `pnpm typecheck`, `pnpm lint:effect`                                                                | Passed                                                                                                                                   |
| `pnpm check:lsp`, `pnpm check:lsp:agents`                                                                                  | Zero diagnostics; 416 runtime and 11 agents files                                                                                        |
| `pnpm config:schema`                                                                                                       | Regenerated consistently                                                                                                                 |
| `pnpm licenses:check`                                                                                                      | Passed; 1374 locked components and 31 distributed source files                                                                           |
| `pnpm check`                                                                                                               | Failed only unchanged approved `design.md` formatting                                                                                    |

The licensing refresh used only `--reachability-only`: no new suppliers,
license downloads or review approvals.

The initial independent `pnpm build` ran pack/web successfully, but
`report:prepare` failed `REPORT_SHELL: Renderer manifest lacks a required source
input`; `/tmp/opencode/abra-agents-export-stages-n7GuHZ/build.log` retains output.
The manifest's absolute `/.abracode/` exclusion also excludes this assigned
worktree's ancestors. The recorded bounded Supervisor disposition
`agents-renderer-worktree-root-filter` allowed an installation-relative exact
segment exclusion only. The correction retains all absolute/inside/realpath
and symlink checks.

Actual portable-renderer RED under a disposable `.abracode/worktrees` ancestor
failed with the same missing-input error in 10.68 s. After the correction, both
renderer-shell integration tests passed in 37.87 s. They prove required inputs,
`.abracode-other` inclusion, installation-local metadata exclusion and actual
outside-target symlink refusal, alongside existing compiler/cache/tamper checks.
Originals: `/tmp/opencode/abra-agents-renderer-relative-Nzt92x/{red.log,green.log}`.

The subsequent **complete `pnpm build` exited 0**, with log at
`/tmp/opencode/abra-agents-renderer-relative-Nzt92x/build.log` and portable renderer
identity `775c170c7f9820e5403668210cd92033c480c9b9e962b0d5e489f0832885b8ce`.
The earlier failure is not relabeled. This separate root-path bug is not
attributed as the native export timeout cause: the disposable native installation
does not have that ancestor.

## Disposable native proof

External originals remain retained. Worker read guards prevent inspecting these
scratch files directly; JSON/teardown assertions need routed readable copies or
explicitly attributed operator observations in addition to runner exits.

| Run                                    | Runner observation                                                                       | External original                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Lifecycle RED                          | Busy refusal changed `applying` to `blocked`                                             | `/tmp/opencode/abra-agents-final-preservation-dqzPCv/busy-red.log`   |
| Lifecycle GREEN                        | 14 passed, including completion-pending refusal                                          | `/tmp/opencode/abra-agents-final-preservation-dqzPCv/busy-green.log` |
| Engineering after lifecycle correction | 1 passed, 167.61 s                                                                       | `/tmp/opencode/abra-agents-native-final-p4sAcq/native.log`           |
| Relocated frozen installation          | 1 passed, 80.32 s; configured native Supervisor profile/session and actual TUI selection | `/tmp/opencode/abra-agents-install-complete-P9lmvB/installation.log` |
| Instrumented original browser          | 1 passed, 110.41 s; original approvals, report export and delivery assertions retained   | `/tmp/opencode/abra-agents-workspace-dom-msZ6Te/workspace.log`       |

Installation predates the explicit-advance preservation correction; that
correction does not change installation/bootstrap/model selection. Engineering
uses the corrected production lifecycle; later browser-only diagnostics do not
alter that journey. The engineering variant uses deterministic loopback model
responses and a recording forge/local disposable remotes, not a live provider,
autonomous model evaluation or external delivery.

Earlier successful captured-agent JSON is readable at
`/home/bart/Projects/abra-code/.abracode/evidence/agents-20261118-uS1liM/`.
It proves exact captured static revision restoration, unchanged provider counts,
single instruction delivery, tool/skill filtering and direct stale/wrong-role/
explicit-denial refusal. It is not substituted for post-correction lifecycle
proof.

## Retained failures and limits

- Initial full suite: 755 passed/1 failed, explicit advance `WRITER_BUSY`;
  `/tmp/opencode/abra-agents-checks-K4tCeh/test-all.log`.
- Pre-paired-fixture suite: 756 passed/1 failed, post-restart approval-button
  timeout; `/tmp/opencode/abra-agents-final-suite-ogBeul/test-all.log`.
- Paired-fixture browser: report-export response timeout;
  `/tmp/opencode/abra-agents-workspace-final-amzMB4/workspace.log`.
- Paired-fixture full suite: 767 passed/1 failed, post-restart approval-button
  timeout; `/tmp/opencode/abra-agents-suite-paired-Pn6Wca/test-all.log`.

The browser timeouts are not `WRITER_BUSY` and are never swallowed. Bounded
action diagnostics retain actual URL, selected tabs, visible/enabled controls,
DOM text and recent API responses/failures around both actions, with failure-time
screenshots on failure. An earlier Reports-tab screenshot is not failure-time
proof. The isolated instrumented pass did not establish a cause for those
intermittent failures. The full-suite diagnostic recheck at
`/tmp/opencode/abra-agents-suite-dom-FizCTb/test-all.log` again recorded 767
passed/1 failed. Its failure-time DOM shows the correct issue and Overview,
the native plan form visible, no page exception, but the inspector still loading.
Its network tail shows repeated aborted detail requests while other work reads
complete. The report read's 409 is not attributed as the cause.

### Inspector preservation RED/GREEN

The bounded browser reproduction used the existing `abra-slow` fixture's 500 ms
typed detail read and continuous 100 ms work observations. Before the correction,
the description remained absent for the fixed 3 s assertion window and ten detail
requests were aborted. Stopping observations, without retrying/reloading/changing
selection, allowed the same inspector to complete. This RED was observed in
`inspector-starvation-diagnostic.test.ts`, now retained as the first regression
in `inspector-observation.test.ts`.

After the recorded Supervisor disposition, only the detail query's live
invalidation handling changed in `apps/web/src/data.ts`. It allows the pending
read to finish and retains one dirty refresh; explicit user refresh still
delegates to the original typed query. The scoped subscription is disposed with
the wrapper, and issue-keyed queries continue to isolate late prior selections.
The GREEN includes a held stale HTTP response, a newer live observation while it
is held, a subsequent fresh detail response and a separate explicit user refresh.
No timeout was enlarged and no checkpoint/export assertion was removed.

Original browser and full-suite rechecks after this preservation correction
both failed at the unchanged 180 s overall native-workspace deadline, without a
wrapped approval/export action failure being emitted. Originals:
`/tmp/opencode/abra-agents-browser-preserved-SYZIFX/workspace.log` (187.81 s runner
total) and `/tmp/opencode/abra-agents-suite-preserved-zL2fAf/test-all.log`
(769 passed/1 failed, 248.80 s). Their exact pending operation is awaiting routed
native/transport diagnostics; no further blind run or timeout increase is used.
The separate earlier export timeout is not claimed diagnosed or fixed.

The relocated frozen installation was rerun after the frontend preservation
correction and passed in 58.63 s:
`/tmp/opencode/abra-agents-install-preserved-y9yIu2/installation.log`.
At that point acceptance remained blocked by the native-workspace timeout as well
as the approved design's deferred formatting; it was not described as only a
formatting blocker.

The subsequent bounded original-browser diagnosis passed in 104.43 s and retains named start/finish/failure
timings at `/tmp/opencode/abra-agents-export-stages-n7GuHZ/workspace.log` and
`workspace/workspace-stages.json`. Pending stage identities are written at each
transition, so the unchanged global deadline does not erase the unfinished stage.
The trace covers response headers/body, HTML fetch/body/preview, retained export
recheck, restarts, native commands and the control loop. No success is inferred
from an earlier action's `before` DOM snapshot alone.

After the renderer correction, final current-source full-suite verification
passed 772/772 tests at
`/tmp/opencode/abra-agents-final-complete-I0NwL7/test-all.log`. The historical
global timeouts remain disclosed; isolated success was not treated as their
cause or a substitute for this full-suite result. Native JSON/cleanup and stage
timings still require routed readable retention; the runner result alone is not
substituted for inaccessible telemetry.

## Independent captured-command audit

The final audit did not substitute `test:all` for missing exact captured commands.
Both exact commands exited 0 on the completed implementation:

| Exact command                                                                                                                                      | Result                                                                                            | Original log                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `env -u ABRACODE_CONFIG -u ABRACODE_HOME mise exec -- pnpm test`                                                                                   | 730 tests in 129 files passed, 176.34 s                                                           | `/tmp/opencode/abra-agents-independent-final-VqqFhy/test.log`     |
| `env -u ABRACODE_CONFIG -u ABRACODE_HOME ABRACODE_TEST_EVIDENCE_DIR=/tmp/opencode/abra-agents-independent-final-VqqFhy mise exec -- pnpm test:e2e` | Web build and 42 tests in 7 files passed, 174.10 s, including the original native browser journey | `/tmp/opencode/abra-agents-independent-final-VqqFhy/test-e2e.log` |

Workspace evidence remains under that same retained evidence directory. No
implementation change or deadline adjustment accompanied this audit. Existing
exact schema and licensing invocations already passed with unchanged applicable
inputs; they were not repeated solely to copy evidence. The full-suite command
includes the fast, unit, integration and e2e projects; these separate receipts
also preserve the independently requested command outcomes.

The implementation and evidence index are ready for the controller's
formatting-only replan after Apply is independently confirmed idle. The current
approved planning bytes and task wording remain unchanged, apart from legitimate
checkbox states; task 9.3 remains incomplete. This handoff grants no approval and
does not resolve the `pnpm check` blocker.

## Captured-profile expectation follow-up

The controller routed a delayed operator-read failure from the retained
`/tmp/opencode/abra-agents-20261118-7einLS/native.log`: a fresh package-selected
Explore session was compared with the historical implicit `"build"` default.
The operator reported `native-engineering.json` as `result: fail`,
`cleanup_complete: true`, with the assertion as the primary failure rather than
teardown socket-close stderr. Those originals remain failed evidence, not a
passing receipt. The subsequent controller reconciliation identifies this as
historical evidence already superseded by the passing native proof above, not a
new production failure or reason to reopen completed implementation.

The current fixture already used a package-ID pattern instead of `"build"`.
The narrow follow-up strengthens that check: decode the existing captured-context
diagnostics projection, require its exact revision-bound profile ID, compare the
native session's selected agent with that captured ID, and require that exact
profile in native inventory. It also retains context identity and expected
role/definition assertions. Production code and guards are unchanged.
Legacy snapshot/default selection and explicit native overrides remain distinct
in `prepared-agents.test.ts`; the engineering journey retains its external Apply
override and historical v1 restart cases.

An initial follow-up run failed because the test probe's storage is isolated from
runtime-plugin storage; decoding its absent value failed before the assertions.
Original: `/tmp/opencode/abra-agents-captured-profile-0WwH2j/native.log`,
31.49 s runner total. Its emitted summary reported `result: fail`,
`cleanup_complete: true`. No storage guard was changed or bypassed; the corrected
test uses the existing public captured-diagnostics projection instead. The focused
prepared-agent regressions passed 10/10 in 5.02 s in the same directory.

Fresh affected engineering proof after that last assertion edit **passed 1/1,
104.30 s**, with exit 0 at
`/tmp/opencode/abra-agents-exact-profile-final-21UpZZ/native.log`.
Post-edit `pnpm typecheck` and `pnpm lint:effect` passed; `pnpm check` again failed
only on the unchanged approved `design.md` formatting. Exact originals are
`typecheck.log`, `lint.log` and `check.log` in that same directory. Native JSON
originals remain retained for controller-routed readable inspection; this result
is the observed runner receipt, not a claim of directly reading guarded telemetry.

The earlier full build, exact `pnpm test`, exact `pnpm test:e2e`, `pnpm test:all`,
schema, licensing and relocated-install receipts predate this narrow test-only
assertion change. No production implementation, installation inputs, browser
assets, supplier inputs or configuration changed during this follow-up. The
affected engineering journey and type-aware checks above ran after the final
fixture edit; no pre-edit native pass is substituted for them. Historical queued
acceptance reminders retain their satisfied dispositions and do not reopen
completed implementation.

The consolidated handoff is ready for controller verification and the existing
formatting-only replan after independently confirmed Apply idle. Task 9.3 remains
incomplete, with the original approved plan and task wording preserved.
