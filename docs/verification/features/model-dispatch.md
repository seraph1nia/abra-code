# Captured task model dispatch

Use the [disposable prerequisites](../README.md) and the existing native fixture:

```sh
REPORT_CHROMIUM_PATH=/path/to/compatible/chrome \
ABRACODE_TEST_JOURNEY=models \
ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-model-native \
  pnpm exec vp test run --project e2e tests/e2e/native.test.ts
```

The focused 2026-10-18 run at `/tmp/abra-model-focused2-20261018` passed in
21.94 seconds with successful cleanup. A real registered Research session selects
`fixture/gpt-specialist` through a task profile over its repository default.
The actual native request-tool observation and completed assistant metadata
identify that model. After editing the profile and restarting, explicit
pause/confirmed-stop/resume preserves the native session/worktree and captured
selection. Attempted patch, shell and management operations remain refused.

A second task selects a complete explicit model over a different repository
selection. Missing native model and variant tasks fail before worker-session
creation, release unused active reservations and retain their claim/worktree and
captured selection for inspection. They never fall back. The current extended
fixture also checks the read-only configured catalog and concrete readiness
reasons. The full journey exercises an Apply task override and model/profile
selectors in the automatic parallel batch; run `pnpm test:e2e` without a journey
filter for that combined proof.

`dispatch.test.ts` covers strict selectors/profile bounds, role mismatch, each
precedence level, complete variant semantics, canonical ordering, intake refusal,
immutable snapshots and clearing repository defaults with `dispatch: {}`.
`work-graph.test.ts` covers transactional schema-6 migration from historical
versions, schema-5 batch receipt preservation, future-version refusal, failed
migration rollback and conflicting selector identity. Existing worker/context
and record suites cover legacy captures and role permissions. Native interfaces
remain pinned at OpenCode 2.0.28; dispatch policy adds no provider adapter.

The integrated M4 gate passed on 2026-10-18: `pnpm check`,
`pnpm config:schema`, `pnpm test` (423 tests in 68 files, 224.16 seconds),
and `pnpm test:e2e` (two tests, 273.53 seconds). Retained full native evidence at
`/tmp/abra-dispatch-full-20261018/native-engineering.json` records a passing
result and complete cleanup. It includes the configured catalog, captured
Research profile, explicit Apply model, mixed model/profile parallel batch,
missing native model/variant refusals, restart, independent Review and approval
and delivery gates. The generated configuration schema adds only profiles and
repository dispatch to the earlier supervision-mode extension; models remain
complete native selections.
