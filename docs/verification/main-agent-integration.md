# Agent package and controller integration in main

The controller repair was completed directly in Codex, then the existing agent
package implementation was integrated into the main working tree. The source
worktrees and native execution records remain retained; delegated implementation
was stopped before Codex edited either checkout. This is local implementation
evidence, not a claim of native delivery, GitHub merge or live-service activation.

## Implementation

- `packages/agents` owns the shared Effect Agent service/tag, six bundled Live
  implementations, catalog preparation, skills/instructions/tools and scoped
  native registration. Runtime supplies controller ownership and lifecycle gates.
- Controlled replanning captures attributable source before Explore, preserves
  separate index/candidate trees and enforces only the subsequent planning delta.
  Immutable attempts, source refs and exact request identity survive restart.
- `recover_planning` supports verified retained history or prospective adoption
  of exact current content through a distinct native human form. Adoption grants
  planning authority only; fresh plan approval, checks and Review still follow.
- Busy-writer refusal leaves the active assignment intact. Renderer discovery
  uses installation-relative metadata exclusion. The browser regression retains
  its retrying geometry constraint and sandbox assertion without a second
  geometry read during viewport transition.

Three-way integration preserved newer main history/error-handling checks,
controller baseline hooks, agent assets and preparation. The original source
worktree was not committed, reset or removed. The integration candidate,
pre-integration main files and controller-only patch are retained under
`.abracode/evidence/controller-and-agents-main-integration/`.

## Verification

| Candidate                           | Check                                                 | Result                                                              |
| ----------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| Controller before agent integration | `pnpm check`                                          | Passed; Effect diagnostics: zero errors/warnings                    |
| Controller before agent integration | `pnpm test:all`                                       | Passed: 765 tests, 132 files                                        |
| Controller before agent integration | `pnpm test:e2e`                                       | Passed: 41 tests, 6 files                                           |
| Controller before agent integration | Native `planning-recovery` journey                    | Passed; cleanup complete                                            |
| Combined main                       | `pnpm check`                                          | Passed; runtime and agents Effect diagnostics: zero errors/warnings |
| Combined main                       | Focused agent/preparation/registration/baseline tests | Passed: 41 tests, 4 files                                           |
| Combined main                       | pnpm build and both native journeys                   | Passed; both native fixtures report cleanup complete                |
| Combined main                       | pnpm test:all                                         | Passed: 800 tests, 138 files, 168.50 seconds                        |

The final standalone E2E command passed 43 tests in 7 files (89.42 seconds).
The relocated installation test passed in 43.56 seconds. After the final
approval-polling fix, all 24 baseline regressions and the native workspace
journey passed (78.31 seconds). The separate fast/unit/integration command had
also passed 756 tests before that final fix; the 800-test full suite is the
final combined-code proof.

Background approval polling leaves unanswered plans alone. Current source is
validated before recording an answered human authorization and before Apply
admission. This avoids treating an editor's in-progress write as an answered
checkpoint while retaining source-delta enforcement.

Evidence, command logs, native cleanup JSON and the final source manifest are
retained at
`.abracode/evidence/controller-and-agents-main-integration/verification/`.

The controller-only native proof is retained at
`/tmp/abra-controller-native-proof-v6/`. It proves dirty/untracked Apply content
across replan/restart, fresh plan authorization, actual source rejection,
rejected/stale/current adoption offers, configured checks, independent fixture
Review and an unchanged paused companion. Its JSON reports `result: pass` and
`cleanup_complete: true`.

The baseline regression also restores a complete serialized record export,
retained Git objects and SQLite online backup into a disposable environment. It
checks baseline/approval identities, unknown evidence, legacy reads and the
paused companion. An older backup is explicitly distinguished from later work.
This does not authorize restoring the operator's live state or starting old
writers against new-format attempts.

The native provider scripts fixture decisions. These results establish runtime
contracts and guard behavior, not autonomous model quality, external GitHub
authorization or approval of real retained work.
