# Fair automatic admission and bounded supervision

Use the [disposable native prerequisites](../README.md). The focused journey
isolates parallel intake/scheduling/restart behavior from the larger coding flow:

```sh
REPORT_CHROMIUM_PATH=/path/to/compatible/chrome \
ABRACODE_TEST_JOURNEY=parallel \
ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-parallel-native \
  pnpm exec vp test run --project e2e tests/e2e/native.test.ts
```

The scheduler-only focused run at `/tmp/abra-parallel-focused2-20261018` passed
on 2026-10-18 in 29.05 seconds; its retained `native-engineering.json` records
four completed research tasks and successful fixture cleanup. Two of three
independent tasks begin at worker capacity two. Completing the first admits the
third at higher priority than the now-ready dependent task. Completing the third
admits that dependent task. A restart while the last two are held preserves each
session, original prompt identity and worktree relationship. The test disables
automatic scheduling through the owned service configuration/restart before
explicit pause/resume recovery, waits for confirmed stop, and completes both
workers with new authorized assignment IDs in the same sessions/worktrees.
This is explicit recovery; it does not claim automatic continuation of every
consumed native turn.

The extended posture journey also selects attended-automatic and unattended,
uses zero optional diagnostic budget, retains a user-owned worker question across
restart, recreates its same native form under Abra and refuses a model-supplied
answer. Native forms may need periodic reconstruction from retained controller
intent after service restart. The journey waits for that real postcondition.
The extended focused journey passed in 29.98 seconds at
`/tmp/abra-posture-focused2-20261018`, with cleanup complete. Its retained
observation records the incident/form identity, zero explanatory prompts for that
incident, unchanged approval ownership and all four tasks completed.

`tests/unit/scheduler.test.ts` covers equal-priority repository rotation,
priority, a crash between claim and cursor commit, missing/wrong-location Abra,
concurrent starts, uncertain admissions and paused work. The cursor records only
retained controller intent and cannot authorize a claim. Readiness/capacity and
worker-inspection tests distinguish dependency, active/retained/role capacity,
missing authority and native queued activity.

`tests/unit/configuration.test.ts`, `attention.test.ts`, `corrections.test.ts`
and `supervision.test.ts` exercise omitted/conflicting postures, suppressed manual
repairs, retained human forms, notice deduplication/provenance, bounded primary
counts and unavailable native evidence. `tests/integration/effect.test.ts`
proves event-burst coalescing, event subscription recovery, periodic fallback and
scoped shutdown without routine model turns. A stale-save regression in
`policies.test.ts` protects published research report intent/receipt/acceptance
from concurrent older controller snapshots.

Run the full original journey with `pnpm test:e2e`, without a journey filter,
after the focused proof. All providers, native installations, checkouts and bare
remotes are owned disposable fixtures; no operator service or user remote is
changed.

The integrated M2/M3 gate passed on 2026-10-18: `pnpm check` (zero warnings or
Effect diagnostics), `pnpm config:schema`, `pnpm test` (415 tests in 67 files,
222.52 seconds) and `pnpm test:e2e` (two tests, 249.90 seconds). Full native
results at `/tmp/abra-supervision-full2-20261018/native-engineering.json` record
`result: pass` and `cleanup_complete: true`, including unattended provider/Review
blockers, correlated replies, four completed parallel tasks, stable identities,
human forms, PR feedback and finishing. The earlier full run exposed a zero-budget
incident waiting behind an unrelated occupied attention slot; the retained
`attention.test.ts` regression fails before the budget-order fix and passes after.

Standalone `pnpm report:validate` and `pnpm report:build` also passed with the
configured compatible Chromium. The manual portable report is 115.28 KB
(26.87 KB gzip), with all three diagrams compiled at build time. These checks
cover the report toolkit; controller-owned artifact generation remains a separate
milestone.
