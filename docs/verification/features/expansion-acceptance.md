# Multi-task expansion acceptance

The existing native provider/forge runs the complete combined scenario:

```sh
REPORT_CHROMIUM_PATH=/path/to/compatible/chrome \
ABRACODE_TEST_JOURNEY=acceptance \
ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-expansion-acceptance \
  pnpm exec vp test run --project e2e tests/e2e/native.test.ts
```

`tests/e2e/acceptance.ts` records authentication, database investigation and flaky
consumer-test tasks in one stable batch. Two start at worker capacity two; the
third has an accurate capacity blocker. Investigation and the lightweight fix
complete while authentication waits on its human-owned plan. Investigation uses
a role profile and retains a portable architecture report. The same plan form,
execution/session/worktree identities, findings and artifact survive restart.
Human authorization admits Apply, whose captured model differs from independent
Review's. A retained finding is queued to that existing Apply session twice under
one identity and explicitly acknowledged. Current-content verification,
independent Review, exact plan receipt, branch delivery, safe retirement and graph
closure remain required. Batch replay returns the same three issue identities.

The focused combined journey at
`/tmp/abra-acceptance-native6-20261018/native-engineering.json` passed on 2026-10-18
in 47.14 seconds with cleanup complete. Its portable HTML copy survives fixture
teardown. Earlier fixture runs correctly exposed a removed declaration (the test
restored an old YAML snapshot), an intentionally injected lightweight Review
failure, and a test reading a nonexistent approval convenience field. The final
fixture preserves newly registered declarations, keeps failure injection in its
existing dedicated journey, and reads the authoritative approval receipts. No
controller readiness, Review or approval gate was weakened to make it pass.

The first final full-suite run (`/tmp/abra-expansion-final-native.log`, 388.84
seconds) failed in the combined scenario: an earlier inventory-refusal journey
had deliberately left `central-only` and `missing-worker-skill` overrides in the
shared fixture configuration. Both new tasks correctly entered recovery rather
than running without their declared capabilities. The combined scenario now
explicitly selects installed default worker profiles and restores its caller's
configuration afterward. The original refusal assertions remain intact. Failed
run evidence is retained at
`/tmp/abra-expansion-final-native-20261018/native-engineering.json` with cleanup
complete; it is not counted as a passed run.

The second full attempt (`/tmp/abra-expansion-final2-native.log`, 102.67 seconds)
failed the strict correlated-provider-failure assertion before the combined
scenario. A minimized controller regression reproduced a late native failure
event erasing a previously reconciled prompt ID, model and observation time.
Native events carry no prompt ID. The event handler now preserves an already
stopped turn's exact retained failure when it matches the current assignment or
follow-up; active turns still accept new failure observations. The regression
failed before the fix (`/tmp/abra-expansion-late-failure-red.log`) and all 23
messaging tests passed afterward (`/tmp/abra-expansion-late-failure-green.log`).
The original native correlation assertion remains unchanged. Second-run evidence
also records failure and complete cleanup, rather than a successful result.

The final full native run passed both E2E files/tests in **402.41 seconds**:
`/tmp/abra-expansion-final3-native.log`. Retained evidence at
`/tmp/abra-expansion-final3-native-20261018/native-engineering.json` records
`result: pass`, `cleanup_complete: true` and 24 observations, including the strict
failure-correlation assertion, lead/report restart journeys and final combined
acceptance. The final handoff was explicitly acknowledged, independent Review and
verified branch delivery completed, and the same human-owned plan survived
restart. The portable acceptance report remains outside the cleaned fixture at
`/tmp/abra-expansion-final3-native-20261018/acceptance-architecture-2708ed9dd734d3ff1cb85df649ef441a6f58f5e4cf1d3cf105fc3fafcb7b92e7.html`
with SHA-256
`2708ed9dd734d3ff1cb85df649ef441a6f58f5e4cf1d3cf105fc3fafcb7b92e7`.

Run the default `pnpm test:e2e` for combined regression with queued messaging,
lost admissions, unresolved obligations/provider interruption, scoped project
leads, unavailable models, PR/merge/cleanup evidence and this final scenario.
Every Git remote is disposable/local. Task labels represent product orchestration
on the sample consumer provider; this does not test natural-language decomposition
quality or claim a real authentication refactor/database performance improvement.

## Integrated ownership and complexity review

The final review traced each capability delta through its existing owner and
failure/restart tests:

| Capability delta          | Ownership and review result                                                                                                                                                                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native supervision        | Guard authorization uses retained prompt intent and exact content, assignment, session and generation. Native same-ID replay follows the explicitly accepted 2.0.28 exception; changed replay text never executes.                                                                                              |
| Agent messaging           | Worker and lead requests share the native admission adapter. Controller correlation and explicit replies remain separate from OpenCode inbox evidence; uncertain absence never permits a replacement request.                                                                                                   |
| Batch work intake         | One SQLite transaction validates and commits tasks, dependencies and stable batch receipts. No second issue store or natural-language parser was introduced.                                                                                                                                                    |
| Execution coordination    | The existing scheduler owns fair admission; native uncertainty continues to reserve capacity. Pause, independent Review, current-content verification and exact plan/merge authorization retain their existing owners.                                                                                          |
| Application configuration | Complete task/repository/profile model selections are captured before execution. Omitted automatic settings preserve conservative behavior; unavailable selections block without fallback. Generated schema additions were inspected, with runtime semantic validation retained.                                |
| Work visibility           | Classifications and aggregate counts are read projections of existing lifecycle, decisions, waits and native observations. They introduce no persisted display state machine or lifecycle authority.                                                                                                            |
| Project leads             | One management level shares the controller, graph and native transport. Scoped controller tools are the only lead tools; disable/revision checks precede admission, and changed scope/model rotates context while revoking the old session.                                                                     |
| Report template           | Existing Reports owns optional read-only attachments. Trusted Vite/Solid compilation uses isolated inputs, caches and outputs, finite reservations/deadlines and digest-checked publication. Exclusive hard-link publication preserves occupied revisions; cleanup only removes verified owned scratch/staging. |

The implementation adds no package/lockfile dependency changes, alternate agent
harness, service, broker, scheduler, workflow engine, nested installation or
recursive management tree. OpenCode remains pinned to 2.0.28. Native sessions,
queues, execution observations, worktrees and model inventory remain native-owned;
AbraCode retains only orchestration authority and reconciliation evidence. Worker
text and report feedback cannot grant approval, scope or delivery authority.
Git worktrees and OpenCode permissions retain the documented same-user trust
boundary rather than operating-system isolation.

## Final verification record — 2026-10-18

All commands below exited successfully. Browser-dependent commands used
`REPORT_CHROMIUM_PATH=/tmp/opencrew-report-browser/chrome/linux-155.0.8059.84/chrome-linux64/chrome`;
the native run additionally used
`ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-expansion-final3-native-20261018`.

| Command                                                                        | Observed result                                                                                             | Retained log                                    |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `pnpm format:check`                                                            | All matched files correctly formatted                                                                       | `/tmp/abra-expansion-final-format.log`          |
| `pnpm config:schema`                                                           | Schema generated; additive posture, profile and repository dispatch changes inspected                       | `/tmp/abra-expansion-final-schema.log`          |
| `pnpm licenses:check`                                                          | Two tests passed; evidence matches 759 locked components and 24 distributed source files                    | `/tmp/abra-expansion-final-licenses.log`        |
| `pnpm check`                                                                   | Formatting, lint, TypeScript, Effect diagnostics and reporter types passed; zero diagnostic errors/warnings | `/tmp/abra-expansion-final3-check.log`          |
| `pnpm test`                                                                    | 441 tests in 71 files passed, 232.44 seconds                                                                | `/tmp/abra-expansion-final3-unit.log`           |
| `pnpm test:e2e`                                                                | Both native E2E files/tests passed, 402.41 seconds; fixture cleanup complete                                | `/tmp/abra-expansion-final3-native.log`         |
| `pnpm build`                                                                   | Six application bundle/map files built                                                                      | `/tmp/abra-expansion-final3-build.log`          |
| `pnpm report:validate`                                                         | Flow, sequence and state diagrams parsed and rendered                                                       | `/tmp/abra-expansion-final-report-validate.log` |
| `pnpm report:build`                                                            | Reporter type check and portable single-file build passed                                                   | `/tmp/abra-expansion-final-report-build.log`    |
| `pnpm exec openspec validate expand-native-multi-agent-orchestration --strict` | Change valid                                                                                                | `/tmp/abra-expansion-final-openspec.log`        |

Native tests use disposable installations, repositories, a deterministic local
provider and a local forge; no user remote is pushed. The retained JSON/artifacts
survive fixture cleanup. Actual graphical OpenCode chat-link click-through is
**not run** because no paired graphical client is available; pinned source
inspection and the matching opaque sandbox/browser tests are documented in
[visual reports](visual-reports.md). Real-provider model quality, decomposition
judgment and production authentication/database improvements are not claimed.
