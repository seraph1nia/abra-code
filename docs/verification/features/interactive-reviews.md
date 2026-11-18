# Interactive plan and report reviews

Use the existing disposable native setup in [verification](../README.md).
No operator service, configured worker or user remote is used by these checks.

```sh
pnpm test:one packages/runtime/tests/fast/interactive-reviews.test.ts \
  packages/runtime/tests/integration/interactive-reviews.test.ts
pnpm web:build
ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-interactive-reviews \
  pnpm test:one packages/runtime/tests/e2e/interactive-reviews.test.ts \
  packages/runtime/tests/e2e/frontend-performance.test.ts
ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-interactive-reviews \
  pnpm test:one packages/runtime/tests/e2e/native-workspace.test.ts
pnpm check
pnpm test:all
openspec validate add-interactive-plan-and-report-reviews --strict
```

The focused owner tests cover validation, immutable call retries, interrupted
publication repair, supersession, source changes, admission uncertainty and retained
image capture. Real filesystem cases exercise non-symlink containment, wrong image
types, individual/aggregate limits, source deletion and corrupt retained bytes.

The built-app browser journey exercises every control, keyboard radio selection,
design selection/enlargement/focus return, two-tab drafts, Plan inspection, reload,
a lost HTTP response after admission, exact receipt recovery and a correlated
published revision. It asserts one native admission across the response loss.
Its screenshot images are fixture content; the journey proves interaction rather
than design quality. The performance journey checks both empty and 1,000-message
startup against the unchanged published budgets.

The native workspace journey publishes through the real Supervisor-only
`abra_review_ui`, submits from the browser, observes actual native admission and
publishes a correlated review. Its final assertion recovers the exact feedback
receipt after native restart and task worktree retirement. The existing saved
JSON/HTML export and checkpoint journey runs alongside it. A deterministic provider
drives the fixture; this does not measure autonomous model quality.

Evidence is written outside the disposable root. The browser retains desktop and
narrow screenshots plus `frontend-performance.json`; the native fixture retains
`workspace/native-engineering.json`, including `interactive_review` observations
and `cleanup_complete`. Test teardown closes only owned browsers, HTTP scopes,
native processes and temporary fixtures. Keep command logs with the evidence and
record any unrelated workspace failures explicitly at handoff.

## Recorded result, 2026-11-18

Evidence: `/tmp/abra-interactive-reviews-final/`, with command logs at
`/tmp/abra-review-test-all-final.log`, `/tmp/abra-review-check-final.log`,
`/tmp/abra-review-feature-lint.log` and `/tmp/abra-review-package-checks.log`.
`review-verification-summary.json` records the native, performance and full-suite
outcomes. Native evidence reports `result: pass`, `cleanup_complete: true` and a
correlated review receipt recovered after restart. Startup was 533,401 gzip bytes
for empty chat and 745,426 for 1,000 messages, below the unchanged 536,000/748,000
ceilings. Feature-file lint, all package type checks and strict OpenSpec validation
passed.

The full suite completed with 729 passing and three failures in separate ongoing
workspace work: `integration/lifecycle-filesystem.test.ts`,
`integration/record-concurrency.test.ts` and `integration/work-queries.test.ts`.
The final full `pnpm check` is blocked by unstable-API lint in the separate
`lifecycle-filesystem.test.ts`. Those implementation/test files were preserved.
This is feature implementation evidence, not a green repository-wide handoff or
controller approval/delivery receipt.
