# Feature map

All commands run from the repository root after the [recipe prerequisites](../README.md#prepare-and-check-health). Every fixture uses disposable repositories and local/fake remotes.

[Native steering](steering.md) records the M0 red/green prompt-authorization audit,
native replay limits and queued-pause regression in the same native harness.

[Correlated messaging](messaging.md) covers queue/reply and retained
Research-to-Apply finding/acknowledgement journeys in that harness.

[Atomic batch intake](batch-intake.md) records transactional creation, refusal and
stable local-key mapping through native restart.

[Fair admission and bounded supervision](fair-admission.md) covers repository
rotation, two-slot parallel dispatch, scoped recovery, operational modes and
retained human forms.

[Captured model dispatch](model-dispatch.md) covers task/profile precedence,
immutable role choices and refusal of unavailable native models or variants.

| Journey                                                          | Harness entry                                                                                                                                                                                                                                                                 | Observable outcome                                                                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [Full-spec approval, proof and independent Review](full-spec.md) | [native.test.ts](../../../tests/e2e/native.test.ts), [engineering.ts](../../../tests/e2e/engineering.ts)                                                                                                                                                                      | Approval gates Apply; red/green consumer proof; Review reads current untracked proof; unavailable evidence blocks |
| [Lightweight correction](lightweight.md)                         | [native.test.ts](../../../tests/e2e/native.test.ts)                                                                                                                                                                                                                           | One scoped correction succeeds; exhausted budget retains a decision                                               |
| [Preservation, retirement and restart](retention.md)             | [native.test.ts](../../../tests/e2e/native.test.ts), [retirement.test.ts](../../../tests/unit/retirement.test.ts), [worker-lifecycle.test.ts](../../../tests/unit/worker-lifecycle.test.ts), [engineering-recovery.test.ts](../../../tests/unit/engineering-recovery.test.ts) | Local preservation before removal, cleanup blocker survives restart, exact retained admissions and fresh defaults |

[Persistent scoped project leads](project-leads.md) — static native sessions, scoped proposals/replies, finite shared attention, restart and revocation.

[Portable visual reports](visual-reports.md) — isolated controller builds, immutable
publication, restart/deadline recovery, offline sandbox and native handoff limits.

[Combined expansion acceptance](expansion-acceptance.md) — three policies, two-slot
automatic work, retained human decision, model selection, finding/acknowledgement,
independent Review, delivery, portable architecture report and restart.
