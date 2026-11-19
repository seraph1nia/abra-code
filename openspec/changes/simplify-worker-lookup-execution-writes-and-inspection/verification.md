# Implementation verification

On 2026-11-19, `pnpm check` passed and `pnpm test:all` passed all 833 tests across 141 files in 185.22 seconds on Node 26.13.0 and pnpm 12.21.0. The first full run caught an inspector regression test that still intercepted the old detail endpoint. Its updated assertions observe Overview directly. Strict validation passed with two archive-order notices for the predecessor deltas listed in the implementation checklist.

## Read and write counts

| Entry point                           | Disposable fixture and observed calls                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native tool guard and worker progress | With 100 retained executions, each entry point read the selected execution once and made zero execution-prefix scans. Progress read the selected native session once. Neither entry point read another native session. A subsequent unknown session caused one authoritative scan.                                               |
| Ticket-scoped worker inspection       | With two tickets, the current and historical worker each required one execution read and one matching native session read. Foreign and missing selections made zero native reads. All cases made zero collection scans.                                                                                                          |
| Overview and full detail              | For one active full-OpenSpec ticket, Overview made one ticket observation, zero status/apply calls, zero plan listings and zero proposal reads. Full detail made one ticket observation and one of each planning call. Overview still worked after the worktree directory was moved away and left each planning count unchanged. |
| OpenSpec completion                   | The same real change was checked first with one unfinished task and then with its checkbox completed. Each invocation observed apply instructions once and only the second succeeded.                                                                                                                                            |
| Finder                                | 1,000 single inserts prepared zero rank or collation queries. SQLite selected the priority, status, repository/priority and repository/status indexes for the four page shapes. None of those page plans used a temporary sort.                                                                                                  |
| Review drafts                         | Two tabs shared one exact review revision. Reopening recovered the other tab’s edit, rejected a foreign revision, checked the original pending response and displayed its admitted receipt. Reopening sent zero messages. A failed storage write preserved the local answer.                                                     |

Run the focused cases from the repository root.

```sh
pnpm test:one packages/runtime/tests/unit/{patch-guards,worker-assignment,visibility}.test.ts
pnpm test:one packages/runtime/tests/{integration/openspec-schema,fast/openspec-prerequisites,integration/cli}.test.ts
pnpm test:one packages/runtime/tests/{unit/records,integration/record-concurrency,unit/spec-verification,unit/worker-lifecycle}.test.ts
LC_ALL=C pnpm test:one packages/runtime/tests/{fast/work-queries,integration/work-graph,integration/work-queries}.test.ts
LC_ALL=tr_TR.UTF-8 pnpm test:one packages/runtime/tests/integration/work-queries.test.ts
pnpm web:build
pnpm test:one packages/runtime/tests/{integration/web-workspace,e2e/web-coherence,e2e/interactive-reviews,e2e/inspector-observation}.test.ts
```

The two Node processes resolved their ICU collation locales to `en-US` and `tr-TR`. The SQLite upgrade tests covered v8 migration rollback, existing batch request bytes, retained IDs and dependencies, and fresh single and batch inserts after migration.

## Native restarts

Both opt-in journeys passed with `cleanup_complete: true`. Planning recovery retained the replan baseline, the verification and Review evidence, and a paused companion at generation 1. The crash journey retained the original worker prompt before and after admission, one native lead notice and an identical published artifact after restart with one render attempt. An initial crash run observed publication before source association had finished. The test now waits for association before comparing the full retry result.

```sh
evidence_dir=$(mktemp -d)
for journey in planning-recovery crash-windows; do
  mkdir -p "$evidence_dir/$journey"
  ABRACODE_TEST_JOURNEY="$journey" ABRACODE_TEST_METRICS=1 \
    ABRACODE_TEST_EVIDENCE_DIR="$evidence_dir/$journey" \
    pnpm test:one packages/runtime/tests/extended/native.test.ts || exit 1
done
```

The retained run records on the verification machine are `/tmp/abra-simplify-BcIDAS/planning-recovery/native-engineering.json` and `/tmp/abra-simplify-BcIDAS/crash-retry/native-engineering.json`.
