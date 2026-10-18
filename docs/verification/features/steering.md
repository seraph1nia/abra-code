# Native steering

## Baseline

The M0 audit began from clean checkout `b6cb3e6` on 2026-10-18. The integrated
`complete-work-reliably` implementation retains typed finishing questions in
`Obligations`, mandatory routing and finite diagnostic provenance in
`AttentionService`, and publication/approval/retirement gates in
`Finishing`/`Finalization`. Messages reuse those owners without duplicating
decisions or granting automated steering authority. Remaining predecessor
acceptance tasks were not treated as passed checks. Concurrent documentation
and predecessor-task edits are preserved.

The existing native observer counts inbox entries as busy, but
`WorkerSessions.observe` still attributes session outcomes to the assignment.
Follow-up intent reconciliation and cancellation must precede slot release and
phase changes. The original assignment ID/context must remain intact.

## Reproduced defect

The disposable native test holds the successful Explore provider request after
the fixture authentication failure and invokes actual `abra_work_control steer`.

```sh
ABRACODE_TEST_JOURNEY=engineering \
ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-steering-replay-20261018 \
  pnpm exec vp test run --project e2e tests/e2e/native.test.ts \
  > /tmp/abra-steering-replay-20261018/native.log 2>&1
```

Observed red result: failed after 22.05 seconds in controller steering; native
`SessionPrompt.prepare` called `requireOwnedPrompt`, which rejected the new
unretained ID. The JSON retains assignment/session IDs and zero provider calls
containing the steering marker. Cleanup completed and both evidence files
survived fixture removal. An earlier independent red run is retained at
`/tmp/abra-steering-before-20261018`.

The run also replayed the assignment ID with changed text. Native returned its
original payload successfully and the changed text never reached the provider.
This distinguishes immutable native replay from literal HTTP refusal. The user
accepted native replay success while requiring controller conflict rejection
and guard refusal of unauthorized new IDs. See the pinned implementation audit
in [supported APIs](../../supported-apis.md#prompt-admission-and-replay-audit).

## M0 acceptance

The positive focused native journey passed in 100.62 seconds with retained
evidence at `/tmp/abra-steering-after-20261018`. The extended full suite then
passed both E2E tests in 217.91 seconds:

```sh
ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-steering-acceptance-20261018 \
  pnpm test:e2e > /tmp/abra-steering-acceptance-20261018/e2e.log 2>&1
```

Its `native-engineering.json` records `result: pass` and
`cleanup_complete: true`. The native scenario admits one steering instruction
despite a retry, refuses conflicting controller input and forged new native
prompts, preserves assignment capture and session/model/worktree identity,
withdraws a second queued instruction on pause and refuses stale-generation
work. The withdrawn instruction appears in neither native user context nor
provider user messages. Stop cancellation now removes all owned queued IDs
before one interrupt, preserving foreign inputs; the adapter has a focused
ordering regression test. Consumed prompts remain history.

`pnpm check` passed with no diagnostics. `pnpm test` passed 363 tests in 61 files;
the two new native-adapter tests passed separately, and the latest targeted
message/adapter/lifecycle run passed 22 tests. Unit fault injection verifies
response loss/restart retains one native ID and no replacement submission;
absent/unavailable observations preserve uncertainty and prohibit replanning.
Review covered provenance, immutable record history, short commit locking,
capacity and stop ordering. No dependencies, worker role permissions or native
runtime versions changed.

M0 does not claim correlated replies, worker-to-worker routing or queued-message
restart acceptance. Those remain M1 tasks. The deterministic provider proves
mechanics and refusal behavior, not autonomous model judgment.
