---
name: testing
description: Choose AbraCode tests during implementation, add focused regressions, investigate slow tests and prepare final verification.
---

# AbraCode testing

Read the assigned repository's instructions first. These commands apply to
AbraCode; other repositories keep their own checks. Invoke as `$testing` or
native `abra-testing`.

| Situation                                    | Command                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| One changed behavior or regression           | `pnpm test:one <test-file>`                                                     |
| One named scenario                           | Append `-t 'scenario name'`                                                     |
| Imported callers of changed source           | `pnpm test:affected <source-file>`                                              |
| Broad core feedback                          | `pnpm test:core`                                                                |
| Browser/UI source change                     | `pnpm web:build`, then the relevant `test:one` browser scenario                 |
| Completed change                             | `pnpm check` and `pnpm test:all`                                                |
| Native, installation, HMR or export boundary | The relevant file in `packages/runtime/tests/extended`, or `pnpm test:extended` |

During implementation, batch related edits and run the focused regression plus
relevant package checks. Expand after a failure or a wider dependency change.
Run routine acceptance once before handoff; repeat it only if later changes
invalidate that proof. Do not run the full suite after every few edits.
`test:affected` follows imports: select subprocess, asset and instruction tests
explicitly. Include new regression coverage.
Browser tests serve built assets: rebuild after UI source edits. Use
`pnpm test:e2e` for the routine browser/native smoke suite with preparation.

Keep distinct authorization, persistence, failure and recovery contracts. Drop
redundant scenarios or move expensive overlapping journeys to the extended suite.
Prefer in-memory policy tests; use real Git, durable SQL and native processes when
that boundary is the behavior being tested. Do not build scheduling or fixture
machinery just to meet an exact timing threshold. Aim for quick core feedback and
a routine suite taking roughly a couple of minutes.

Keep writable state private. Register cleanup immediately, including setup and
shutdown failures. Stop owned children, remove owned temporary roots, and keep
requested evidence outside them. Never push fixture repositories to user remotes.
Wait for observable completion, including lazy UI content, before asserting.

See [suite coverage](../../../docs/testing.md),
[browser prerequisites](../../../docs/verification/README.md) and the
[opt-in operational recipe](../../../docs/verification/operational.md).
