---
name: testing
description: Choose AbraCode test suites while implementing a change, adding regression coverage, investigating slow tests or preparing final verification.
---

# AbraCode test workflow

Read the assigned repository's instructions first. This skill's commands apply
in AbraCode; foreign repositories retain their own test commands. Invoke as
`$testing`, or load native skill `abra-testing`.

## Select the smallest useful run

| Situation                                                 | Command                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| Pure contracts, projections, streams or in-memory SQL     | `pnpm test:fast`                                                 |
| One regression or a changed behavior                      | `pnpm test:one packages/runtime/tests/unit/messages.test.ts`     |
| One named scenario                                        | Append `-t 'scenario name'` to `test:one`                        |
| Source files with statically imported callers             | `pnpm test:affected packages/runtime/src/workflow/messages.ts`   |
| Broad backend regression                                  | `pnpm test`                                                      |
| All controller/unit behavior                              | `pnpm test:unit`                                                 |
| Real SQL, Git, CLI, compiler or process boundaries        | `pnpm test:integration` or `test:one` with the relevant file     |
| Browser or native workflow change                         | `pnpm test:one packages/runtime/tests/e2e/web-coherence.test.ts` |
| Completed implementation, before handoff                  | `pnpm check` and `pnpm test:all`                                 |
| Repeated crash/fault/resource stress explicitly requested | `pnpm test:soak` with the operational recipe                     |

During implementation, batch related edits and run the focused regression plus
relevant package checks. Expand after a failure or a broader dependency change.
Run full acceptance once on the final content, then repeat only when subsequent
changes invalidate it. Preserve controller-owned verification and Review receipts.
`test:affected` follows imports: explicitly select tests for subprocess entrypoints,
assets, instructions and other file-loaded inputs. Include new regression tests.

## Keep coverage valuable and inexpensive

Assert public behavior and the original regression. Keep separate cases for
meaningfully different authorization, persistence, failure and recovery contracts.
Consolidate duplicate setup/paths when the same behavior has stronger coverage;
record the replacement before removing a scenario. A passing smaller suite is not
full acceptance.

Use in-memory state for policy/projection cases. Use private real repositories for
Git behavior and file SQL for durability or independent-process contention. Reuse
immutable setup assets, with separate writable state per test. Keep actual process
cancellation, native integration and fresh-install checks at their real boundaries.
Wait for observable completion rather than sleeping or comparing mutable progress
snapshots. Assert notification identity and eventual delivery separately.

## Time and resource budgets

Aim for focused feedback within 10 seconds, core tests within 60 seconds and the
complete `test:all` run within 120 seconds, including preparation and cleanup.
Use the runner's bounded workers; `ABRACODE_TEST_WORKERS` can lower the limit on a
smaller host. Keep process/environment mutation isolated. Profile slow files and
setup before adding workers or increasing timeouts. Preserve all required coverage
while reducing repeated work; report an unmet budget explicitly.

Register cleanup as soon as a resource is acquired, including setup failures.
Stop only owned children, then remove owned fixture roots; retain small logs and
receipts outside those roots. Check cleanup after failed and interrupted runs.
Provision browsers once using [the prerequisites](../../../docs/verification/README.md).
For retained native evidence and stress runs, use
[the operational recipe](../../../docs/verification/operational.md).
