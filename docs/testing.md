# Testing strategy

Frontend edits run the normal `pnpm check` lint path, including React hook order,
dependency completeness, render purity, state-to-state effects and mutation
checks, plus JSX naming/ARIA/label/heading/frame rules. The existing Effect and
workspace-boundary rules remain enabled. `frontend-lint.test.ts` runs disposable
invalid hook/dependency/purity/synchronization/unnamed-control examples against
that actual Vite+ configuration; valid named scroll regions pass. The fixture
limits lint to its source directory, not linked dependency trees.

Exceptions stay local and explained: initial bootstrap retention synchronizes
authoritative external state; block skeleton/Alert statuses keep valid block
semantics; inline SVG diagram canvases cannot be replaced with native images.
Named scroll regions and `pre` blocks remain keyboard-scrollable. No hook or
accessibility rule is globally suppressed to accept these cases. Native prose
statuses use `output`, named table/board regions use `section`, and grouped field
controls use `fieldset` rather than redundant roles.

Both entries enable development StrictMode. `surface-owner.test.ts` exercises
staging, failed replacement, independent readers, disposal and repeated setup;
the real browser catalog cases exercise the actual SDK. The disposable
development journey checks native form edits, composer draft, an unavailable Plan
bookmark and one active observer across workspace HMR, then backend reload and
shutdown. The bookmark check proves retained navigation/error presentation, not
successful reads of a fabricated task. Lazy form identities live outside the
refreshed shell. Native installation acceptance independently checks actual forms
and service lifetime.

`frontend-performance.test.ts`, included by `pnpm test:all`, enforces the complete
initial gzip script graph and deterministic historical content-render locality.
Its ceilings, fixed populations, toolchain, evidence and update procedure are in
[frontend verification](verification/frontend-parity.md). Latency measurements
remain separate from deterministic assertions. Build assets before browser cases;
wait for lazy content and painted geometry before recording reading anchors.

Load [the testing skill](../.agents/skills/testing/SKILL.md) as `$testing`. This skill documents development of AbraCode and is not registered in foreign runtime worker locations.

| When                                       | Command                                             |
| ------------------------------------------ | --------------------------------------------------- |
| Working on one behavior                    | `pnpm test:one <test-file> [-t 'scenario']`         |
| Finding imported callers of changed source | `pnpm test:affected <source-file>`                  |
| Checking core behavior                     | `pnpm test:core`                                    |
| Finishing a change                         | `pnpm check` and `pnpm test:all`                    |
| Changing a native/install/export boundary  | The relevant extended test, or `pnpm test:extended` |

Batch related edits, run the relevant regression, and expand only when the change
or a failure warrants it. Run routine acceptance once on finished work. Do not
rerun everything after a few small edits. Import-based selection cannot discover
subprocess entrypoints or file-loaded assets; select those tests explicitly.

The routine suite includes fast contracts, controller behavior, integration
checks, browser behavior and one real native workspace journey. Aim for roughly
a minute of core feedback and a couple of minutes for routine acceptance.

Slow, overlapping native journeys, fresh installation, development/HMR and
repeated compiler/export checks live in `packages/runtime/tests/extended`.
They remain available when their boundary changes, without burdening every edit
or routine CI run. `pnpm test:native` selects all native journeys explicitly.
Repeated crash/resource soak remains a separate opt-in operational check.

Use ordinary Vitest projects and concurrency. The runner uses up to eight file
workers; pass its standard `--maxWorkers` option to lower that on a smaller host.
Browser cases share one owned browser, with separate contexts and fixture servers.
Unit files reuse fork workers; process-backed integration and E2E files retain
fresh process isolation. There is no custom scheduler or test orchestration script.

Git behavior uses small private repositories and local bare remotes. An immutable
per-run seed avoids repeating initialization; each fixture has writable Git state
of its own. Cleanup is registered immediately, including setup and shutdown failure
paths. Source installations use the frozen offline package store and private
installed dependencies. Stop owned children before removing owned temporary roots;
retain only requested small logs/evidence outside them. Tests never push to user
remotes or remove unowned resources.

Two straightforward production costs found during investigation were fixed:
lock acquisition uses `fs-ext` directly in Node, with a scoped Node holder for the embedded host, and fingerprints
batch Git's untracked-file hashing. Regression coverage preserves kernel-lock
release and the exact persisted fingerprint bytes, filters and unusual paths.
See [API evidence](supported-apis.md).

# Acceptance coverage

`work-queries.test.ts` exercises real in-memory/file SQLite pages, Unicode and
literal search, legacy identifier collation, complete totals/readiness,
normalized request-byte preservation and malformed dependency refusal. A native
statement spy verifies constant SQL operation counts for 161 issues and paged
reads. `work-database.ts` supplies the shared scoped database fixture; existing
independent-process batch/claim tests continue to use the same graph owner.

Specification Review regressions in `packages/runtime/tests/unit/spec-verification.test.ts` cover required assessment evidence, contradictory verdicts, intentional schema omissions, retained conflict decisions, blocked unsafe retry, approved-scope correction, fresh planning approval and legacy Review recovery. The native provider fixture submits the same full-spec evidence through `abra_review_report`; lightweight Review retains its short-contract report.

`packages/runtime/tests/unit/native-contracts.test.ts` covers native model/error projection, UTC validation with TestClock, JSON omission semantics, phase evidence types, lazy single-flight acquisition with failure retry and injected FileSystem reads. Native guard fixtures assert the Effect cause category as well as rejection text. Existing Effect/process, coordination and native-renderer suites continue to validate callback lifetime, process-tree cancellation, task replacement and cleanup.

Validation uses Vite+ default formatting and linting, TypeScript strict checking, Vitest, disposable Git repositories, CLI adapters and a real OpenCode v2 server. No production repositories or forge endpoints are mutated.

| Requested behavior                                           | Coverage                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three independent projects, preserving existing instructions | Unit onboarding; real v2 onboarding of frontend/api/worker                                                                                                                                                                    |
| Remote onboarding and fresh pinned bases                     | URL-only managed clone; remote HEAD changes/explicit overrides; failed fetch; force-push/GC recovery; native SHA creation                                                                                                     |
| Missing setup registration and isolated initialization       | Setup blockers before claim; fetched-base recheck; CLI init/native setup worktree; durable approval and cleanup gates                                                                                                         |
| Requested goal becomes work and Explore                      | Controller intake validation/retry recovery; SQLite creation/request identity/dependencies; native model-facing creation then Explore                                                                                         |
| Register/list work and explicit association                  | Unit registry; typed SQLite repository association; native plugin tools                                                                                                                                                       |
| Dependency chains and ready filtering                        | SQLite three-project chain; controller filtering                                                                                                                                                                              |
| Atomic claims and duplicate scheduling                       | Competing SQLite claims in independent processes, shared controller locks, scheduler capacity                                                                                                                                 |
| Issue worktree                                               | Real Git unit fixtures; real native v2 worktree API                                                                                                                                                                           |
| Explore/Apply share worktree                                 | Controller test and real native session location assertions                                                                                                                                                                   |
| Apply prerequisites and human approval                       | Incomplete/invalid plans, pending/rejected forms, real native form gate                                                                                                                                                       |
| Successful strict validation advances                        | Real OpenSpec and native vertical slice                                                                                                                                                                                       |
| False completion rejected                                    | Unfinished real OpenSpec task and controller task gate tests                                                                                                                                                                  |
| Failed tests/review                                          | Controller checks/fingerprint/review failures and retry feedback                                                                                                                                                              |
| Worker diagnostics and model inheritance                     | Native provider 403 surfaced/redacted; Supervisor selection differs from native default; same-session retry; GPT-family native patch planning and source-edit denial; worker diagnostics denied; unavailable-session fallback |
| Restart recovery                                             | Unit interrupted-session recovery; real restart during pending approval and after completion                                                                                                                                  |
| Existing PR rediscovered                                     | Fake forge exact-head/branch PR discovery, no duplicate create                                                                                                                                                                |
| Incomplete/ambiguous delivery retains worktree               | Missing merge approval, changed/unpreserved work and cleanup failure                                                                                                                                                          |
| Close only after preservation and cleanup                    | Controller merge/cleanup/closure; real remote-branch delivery and native retirement                                                                                                                                           |
| Dependents become ready after closure                        | SQLite and full controller closure chain                                                                                                                                                                                      |
| No simultaneous worktree writers                             | Busy-session handoff rejection and worker allowlists                                                                                                                                                                          |

The real-server test uses a test-only native RPC probe to invoke the actual registered model-facing tool executors and a local OpenAI-compatible streaming fixture for native model execution. It exercises file-tool permissions/hooks, persistent session creation and inbox execution, full planning/application/review, real CLI validation/archive, a real local Git push, non-force native worktree retirement and issue closure. It deliberately attempts an Explore source edit; the guard must reject it while permitting planning files. Portable skill registration is checked at the worker location.

The test selects an explicit preserved-branch delivery condition against a disposable bare remote. GitHub merge behavior is tested with fake forge replies; no live GitHub PR or branch protection mutation is part of validation. Real provider/model quality, production forge permissions and a repository's chosen checks still require onboarding verification.

Use the [testing skill](../.agents/skills/testing/SKILL.md) for focused commands
and [CONTRIBUTING](../CONTRIBUTING.md) for required final acceptance. The routine runner
has four projects: fast, unit, integration and E2E, plus the explicit extended suite. Real boundary tests declare
their own deadlines; a per-test deadline does not establish the suite time budget.

Skill frontmatter is validated with the bundled skill-creator validator (using a temporary `uv` environment for its PyYAML dependency); linked local references and documented scripts are checked separately.

## Continuous integration

The [test workflow](../.github/workflows/test.yml) runs on pushes to `main` and
pull requests targeting `main`. It provisions the pinned toolchain and browsers,
then runs static checks, `pnpm test:all` and the build. Each regression executes
once in that partition; the workflow owns the exact step order.

The frozen install includes developer dependencies and lifecycle scripts for Effect tooling, and populates the store used by offline installation tests. `pnpm check` includes linting, TypeScript, Effect diagnostics and React report-export and web type checking. Named steps fail on errors without automatically formatting or fixing files. Reporter Playwright Chromium is provisioned before integration tests, and the native browser is provisioned before end-to-end tests. Both setup steps install Ubuntu browser libraries with `--with-deps`; local systems can use the commands without that flag and supply compatible system libraries. Fixtures use temporary repositories, local model endpoints and disposable local bare remotes, with no personal credentials or user-remote pushes.

Repository permissions remain read-only. Each job has a 30-minute timeout; a newer run cancels the previous run for the same PR/ref while unrelated refs keep running.

## Effect tooling

TypeScript **7.0.2** uses the native Effect language service from `@effect/tsgo`. The plugin keeps the conventional `@effect/language-service` configuration name in `tsconfig.json`; no legacy JavaScript language-service package is needed. Refactors, completions and type information come from the native language service. Editor Effect diagnostics are disabled there because the patched Oxlint integration reports them, following the upstream [Oxlint setup](https://github.com/Effect-TS/tsgo/blob/main/docs/README.md).

`pnpm install` runs `effect-tsgo patch --typescript --oxlint` through `prepare`. It patches both the native TypeScript compiler/language server and Oxlint's type-aware checker. Compatible versions are pinned together: TypeScript 7.0.2, `@effect/tsgo` 0.69.0, Oxlint 1.93.0 and oxlint-tsgolint 7.0.2007. Upgrade them together using the [supported-version table](https://github.com/Effect-TS/tsgo#supported-package-versions). The pinned terminal FFI package has a type-only TypeScript 5 peer declaration; the local peer policy allows TypeScript 7, because it belongs to OpenCode’s transitive terminal runtime.

`pnpm check:lsp` independently scans all project files with native Effect diagnostics enabled and treats warnings as failures. It excludes the unstable-API notice because OpenCode's public Effect client requires the pinned Effect HTTP modules. Oxlint still enforces that rule with a narrow exception at the HTTP adapter. This scan is also part of `pnpm check`.

Vite+ handles formatting and Effect-aware linting. Full type checking remains disabled in its lint configuration; `pnpm check` runs the patched workspace `tsc` separately.

The `lint` block in `vite.config.ts` enables the recommended Effect rules and excludes `.abracode`, `.lavish` and `dist`. Both `pnpm check` and `pnpm lint` run the Effect-aware checker through Vite+, failing on warnings as well as errors. `pnpm lint:effect` runs it directly. A development probe verified that an unexecuted Effect is rejected by `effecttsgo/floating-effect`.

Effect regressions cover application connections surviving registration until host scope closure, failed plugin setup releasing leadership, command interruption waiting for an uncooperative child, interruption preserving provisioning intent for recovery, monitor shutdown closing its subscription and in-flight reconciliation, failure releasing a real kernel lock, and cancellation of surviving command descendants. Tests execute production Effects at the test-runner seam and use temporary repositories; the real-server vertical slice continues to validate native host loading, permissions, schema interoperability and restart recovery.

Work graph integration tests cover durable reopen, normalized request retries, request rebinding, rollback after an injected SQL failure, competing creation and claims across processes, ownership-guarded transitions/history, missing dependencies, schema upgrades and workflow/scope/report persistence.

Git observation tests verify that status and fingerprints leave the index untouched when file timestamps change, preventing index-refresh races with delivery.

Effect process acceptance covers interruption of uncooperative leaders and surviving descendants, deadline termination before return, raw whitespace, independent stream budgets, bounded progress tails, environment overrides and explicitly allowed semantic exit codes. A controlled-clock test advances a configured check beyond the former 120-second blanket deadline. The same Runner is exercised in Node tests and the pinned native OpenCode end-to-end host.

Clock-controlled attention tests distinguish native content identity and explicit progress from repeated busy polls, cover live command deadlines and expiring waits, and retain one incident across restart/disposition/budget exhaustion. The native end-to-end fixture admits one Supervisor failure incident using the local model endpoint and records its disposition before retrying the worker. No routine poll or synthetic notice requests a model turn.

| Native orchestration improvement | Delivered acceptance evidence                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary CI/review waiting       | `delivery-wait.test.ts`: standing/human/review waits, clock-driven restart/backoff, transport and changed heads                                                  |
| Schema/migration boundaries      | `contracts.test.ts`, `records.test.ts`, SQLite upgrade/request-identity fixtures                                                                                 |
| Slow-operation ownership         | `coordination.test.ts`, independent-process `capacity.test.ts`, process descendant/deadline tests                                                                |
| Generated retirement             | `retirement.test.ts`: exact paths, tracked/symlink/nested/unknown refusal, replacement identity and lost-removal recovery                                        |
| Durable obligations/attention    | `obligations.test.ts`, `attention.test.ts`: owners, generations, expiry, native identity, bounded budgets/capacity                                               |
| Research/lightweight paths       | `policies.test.ts` and native E2E: no-OpenSpec work, immutable publication/restart, explicit report handoff and delivery                                         |
| GitHub evidence                  | `forge-readiness.test.ts`, `forge-findings.test.ts`, `preservation.test.ts`: required identity, methods, source/result retention and scoped summaries            |
| Correction rounds                | `corrections.test.ts`: finite rounds, immutable history/archives, fresh revision plan/merge approval; native successful and exhausted lightweight rounds         |
| Native observation               | `visibility.test.ts`, `ticket-diff.test.ts`, browser/native observation fixtures: bounded read-only projection, report loading, offline freshness and navigation |

Validated on 2026-10-15: `pnpm check` (formatting, lint, strict TypeScript and Effect diagnostics), `pnpm test` (176 tests in 29 files, including the native renderer), `pnpm test:e2e`, `pnpm build`, and strict OpenSpec validation for improve-native-orchestration. The built server/TUI import host Effect/OpenCode packages externally; their shared observer schema chunk has no filesystem or platform-adapter imports. The combined restart test retains migrated full-spec authorization, pending delivery, decisions, a retained research report and a corrected lightweight head without duplicate native IDs or unsafe retirement.

Type-contract coverage in `identity-contracts.test.ts` verifies that domain IDs cannot substitute for one another, plain strings cannot enter branded controller interfaces, native session brands remain identical, and decoded delivery phases retain their required commit evidence. `review-regressions.test.ts` covers research restart before prompt admission and stale saves after observation removal. Record/graph fixtures also cover malformed keys without losing valid history and preservation of arbitrary legacy assignees. The native pause assertion waits for the controller's confirmed stop checkpoint before resuming when monitoring still owns the execution lock.

Native/Effect adoption coverage: `native-contracts.test.ts` verifies schema reuse, UTC calendar validation, injected Clock/FileSystem, lazy single-flight acquisition and inventory selection. `tool-contracts.test.ts` verifies structured results, strict input validation, native failure versus defect channels and bounded progress. `visibility.test.ts` counts one scan per collection/request and verifies durable-success invalidations. `observability.test.ts` inspects finite method/role counters, failure deduplication, reconciliation timing and retained identity log annotations. The native renderer fixture verifies remapped Back/Home commands, host running/pending state, off-screen synchronization and failed-sync presentation without active polling or focus theft.

The native-server fixture exercises actual model-generated invalid/extra arguments, failed-tool state, structured output/content equality, setup progress, portable observer errors, home-scoped events, worker-location preflight, full-spec/research/lightweight delivery and durable restart. Native input repair is a pinned compatibility behavior: preserve the composed strict schema regression when updating OpenCode. All repositories/remotes in these tests are disposable local fixtures.

Inspect built-in Effect metrics through `Metric.value` or the host's configured metric consumer. Counters represent observer attempts, capacity-denied admission checks and distinct committed worker failures; repeated waiting checks can increment admission waits. Reconciliation timing includes failures/interruption. Correlation logs/spans expose retained identities only; raw output, credentials, provider response bodies and model/session/issue metric dimensions are excluded.

The correction-decision regression forces a newer native observation between execution read and decision append. The coordinated update must retain both values; stale observation merges must never discard an exhausted-budget decision. Adapter precondition checks also assert typed Fail causes for missing OpenSpec worktrees and mismatched forge repositories.

Validated on 2026-10-16 for adopt-native-opencode-effect-patterns: pnpm check (zero warnings/diagnostics), pnpm test (210 tests in 35 files), the real native-server E2E, and strict OpenSpec validation. Native E2E also verifies worker-location invalidations reach the central observer.

## Saved reports and portable exports

See [saved reports](reports.md) for explicit save/export/preview commands and legacy compatibility. `pnpm report:check` checks the React entry. `react-report-export.test.ts` builds real single-file HTML, relocates it into an offline opaque frame at 375/390px, verifies prepared diagrams/pending checks/filtering/local feedback, and starts/stops the explicit preview command. `report-artifacts.test.ts` exercises concurrent isolated JSON-to-HTML exports and literal hostile source text. `reporter.test.ts` checks Mermaid preparation and explicit validation errors. Unit publication tests cover immutable JSON, legacy retries/staging/unavailable builds, corruption and export receipt recovery. The old Solid/manual-template tests were replaced with these shared-renderer behaviors.

Set `ABRACODE_TEST_EVIDENCE_DIR` outside disposable roots to retain portable-report screenshots and measured output bytes. Native workspace/report journeys exercise the installed RPC/HTTP owner, restart and worktree retirement. Source inspection of the native graphical viewer is distinct from an actual paired-GUI click-through.

## PR action lifecycle regressions

`action-lifecycle.test.ts` records run-level POSTs for two failed job findings, preserves reservations through restart/control generation, recovers an approved permission preflight without another form, and proves a pause between preparation and admission sends nothing. Legacy uncertain permission errors remain observation-only and keep their original receipts. `action-clearance.test.ts` exercises explicit finish, completed merge approval and periodic reconciliation before required outbox work exists, checks same-head approval retention and verifies the manual-default path. A completed merge shares one canonical check observation with feedback clearance. `action-recovery.test.ts` covers lost command responses, deadlines, malformed output and interruption across ready/reviewer/reply/rerun actions, crash after admission, and mixed legacy stages through storage. Every potentially submitted case reloads its original identity and reconciles without another send.

The canonical provenance fixtures in `pr-feedback.test.ts` keep same-name required/advisory apps and commit statuses distinct and exclude superseded failures. Supplemental logs may be unavailable without changing authority. Shared feedback/external fixtures live in `packages/runtime/tests/helpers/review-evidence.ts`; browser acceptance covers lazy reads, narrow layout, uncertain/unsubmitted action states and preflight/stale evidence. The custom terminal renderer test is retired with its presentation. Existing external validation and coordination fixtures exercise custody, capacity and stop/restart through the owning service rather than an inline lifecycle branch.

The native `packages/runtime/tests/e2e/pr-feedback.ts` scenario runs through the real server and workers with a local recording forge: recoverable permission preflight, completed approval before required actions, two failed jobs sharing one old-attempt rerun, correction, lost reply response, resolution, merge and server restart. `native-fixture.ts` owns the shared process/worker harness. External preflight failure separately verifies reservation release before launch.

All fixtures remain temporary and external mutations are recording fakes; no live GitHub write, user remote, model provider or shared no-mistakes runtime is used. Action versions must preserve IDs/forms/markers/history/budget and refuse unsupported or incomplete evidence without inventing a safe retry.

## Worker policy and context acceptance

`packages/runtime/tests/unit/role-policy.test.ts` covers role authority, native permission scope, additive requirements and forbidden alternatives. `packages/runtime/tests/unit/patch-guards.test.ts` retains symlink/move/control-file checks and direct forbidden/inactive tool calls. `packages/runtime/tests/unit/worker-context.test.ts` covers native-ID skill resolution, unusable content, tool alternatives, immutable capture, pre-session failures, bounded/legacy/malformed diagnostics, read-only inspection with an unresolved question, partial payload publication, stale observations, policy incompatibility and cold-location activation. `packages/runtime/tests/unit/worker-lifecycle.test.ts` changes issue/role sources between uncertain admission attempts and requires the original prompt identity and payload.

The real native test in `packages/runtime/tests/extended/native.test.ts` also runs `packages/runtime/tests/e2e/worker-context.ts`. It uses copied central role definitions and disposable foreign repositories to verify that a central-only explicit agent is absent at a worker location, a required skill blocks before session creation, and a permitted required tool removed by the test plugin prevents its provider request. Its deterministic provider counts requests carrying the missing-tool assignment. Existing patch-only, denied management, full-spec/lightweight/research, spec-verification Review, protected approval/delivery, restart and retired-resource cases remain in the same suite. The fixtures use local bare remotes only.

| Contract                                                | Verification evidence                                                                                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Authoritative role permissions and preserved boundaries | Role-policy native rules, patch/direct-call guards, central Supervisor profile assertions and foreign `build` selection                   |
| Additive capability requirements without grants         | Config decoding/example tests, forbidden alternative test and skill resolution without granting additional tool authority                 |
| Explicit assignment context                             | Captured full-spec context and policy-appropriate lightweight/research lifecycle fixtures; preserved repository configuration             |
| Retained context and uncertain submission               | Immutable payload/orphan tests, lost-response and lost-submission source-change tests, native restart assertions                          |
| Required worker-local skills                            | Missing/ambiguous/unusable ID tests, cold activation test, portable-skill native assertion and missing-skill native blocker               |
| Effective request tools                                 | Patch alternatives, missing-tool request blocker and zero matching provider calls in the native fixture                                   |
| Bounded diagnostics without authority                   | Read-only export comparison with an open question, large-reference omitted counts, invalid/legacy cases and retired context after restart |
| Worker-location admission validation                    | Explicit missing agent, model inventory/capability tests, prerequisite failure with retained worktree and admitted-prompt recovery        |

A context record proves supplied AbraCode instructions, not native admission, skill consumption or checkpoint authorization. Registry readiness, queue admission and provider execution are distinct assertions.

## Agent-browser acceptance

Provision Chrome before running browser E2E (there is no test-time download or silent skip):

```sh
pnpm browser:install
pnpm test:e2e
```

On Ubuntu CI the explicit setup step uses `pnpm browser:install --with-deps`. Local CachyOS/system Chromium setup and `AGENT_BROWSER_EXECUTABLE_PATH` are described in [operations](operations.md#browser-cli). Missing browser binaries or libraries must fail the acceptance with their invocation output. The reporter's Playwright Chromium prerequisite remains independent (`pnpm report:browser:install`, or `REPORT_CHROMIUM_PATH`).

`packages/runtime/tests/e2e/browser.ts` extends the existing native server's model-scripted tool calls; browser commands traverse the real native tool executor rather than a fake CLI. All four roles load `abra-browser`, run `skills get core` and `--version`, browse a local HTTP counter, inspect a snapshot, click its reference, capture a generated screenshot outside the repository, read its PNG through the native file tool and close the assigned name. Browser-only roles attempt both an unrelated command and a forbidden command chained to an allowed CLI command. The test checks native refusal and absence of their output files. A separate driver check opens two real worker-named browsers concurrently and verifies navigation/storage isolation and close independence. Local bare remotes remain the only Git remotes used by these fixtures.

The browser setup integration test runs the actual doctor entrypoint in a disposable home with a recording executable: only absolute-central `--version` is invoked, and a missing executable reports the central install/build clearing action. Unit tests cover ordinary admission without browser guidance or browser-only shell tools, explicit browser prerequisites without OpenSpec, retained Apply development-shell requirements, per-session context naming, narrow evidence read rules and unchanged recovery captures. Browser skill frontmatter also passes the skill validator. CLI/browser acceptance was verified on 2026-10-17 with agent-browser 0.39.1 and Chrome 155.0.8059.84; native API evidence is retained in [supported APIs](supported-apis.md#agent-browser-cli-and-native-command-permissions).

## AbraCode source-release acceptance

`pnpm test:e2e` includes two isolated Linux source installations. `installation.test.ts` copies current tracked application assets into a temporary root, runs `pnpm install --frozen-lockfile --prod=false --offline` against the supplier cache populated by the initial frozen install, and checks alternate personal config selection, static validation without state, noninteractive launch diagnostics, generated settings, repeated service/Abra reuse, the native auth command route, explicit config application and legacy-file preservation. It launches/relaunches the normal entry point through a disposable util-linux PTY, observes the AbraCode footer and verifies that the same Abra/service is retained. Selecting another personal file refuses the running service before changing generated settings. Full installs use disk-backed temporary directories (override with `ABRACODE_TEST_INSTALL_ROOT`) and copy supplier packages so install hooks cannot modify another fixture's dependencies. File workers are bounded; installations own private state and use copy-on-write supplier copies, except the fresh-install test. Native config/data/cache/state are isolated; it writes no personal credentials.

`native.test.ts` also installs the frozen source fixture, then exercises the installed plugin/CLI against a deterministic loopback provider and disposable local bare Git remotes. It covers controller-owned work, direct foreground/queued prompt denial before provider calls, Abra-only questions/forms, preserved approval identity, config edit/application, declaration removal/restoration, captured settings across restart, delivery and retained history. Browser prerequisites are provisioned explicitly before the suite. Nothing pushes to a user remote or calls a paid provider.

`configuration.test.ts` and `declarations.test.ts` cover strict decoding, role overrides, schema/example agreement, exact ignore rules, generated settings in two roots, legacy-path refusal, comment preservation, cooperating concurrent writes, independent edit conflicts, unwritable/interrupted writes, pending failures and omission semantics. Release CI additionally runs `pnpm config:schema` and offline `pnpm licenses:check`; changed or unreviewed evidence is a release failure.

Delivery-outcome regressions cover receipt-only merge approval, actual execution-lock contention versus helper/body failures, independent stage projection, safe bounded path samples, cleanup backoff and attention deduplication, and cleanup-only continuation after restart. The native forge fixture delays a local-only merge to exercise an overlapping approval request, retains ignored fixture residue through service restart, compares status/detail outcomes, then answers its native generated-directory form and verifies automatic retirement and closure without another finish call. A new unknown file after restart survives the directory-only answer; explicit preservation and fresh absence permit closure. Its existing local bare-remote guard remains mandatory; no user remote is a test target.

## Engineering procedures and verification recipes

Use the [executable recipe and feature map](verification/README.md) for isolated journeys and evidence that survives teardown. `engineering-skills.test.ts` tests portable registration, local preservation, exact IDs and role/default/configured selection. `engineering-recovery.test.ts` exercises NativeRuntime preflight against a serialized pre-suite context with only old inventory, lost admitted responses, original provenance, current policy incompatibility and fresh admission defaults. Existing immutable-context/request-tool and lost-response lifecycle regressions remain applicable.

`packages/runtime/tests/e2e/engineering.ts` supplies deterministic native tool calls within the existing real-server fixture: applicable skill loading by every coding role, post-loading management/delegation and edit/shell denials, a symptom-specific failing consumer invocation followed by the original green recheck, and Review reading unstaged/untracked proof under controller receipts. A separate full-spec unavailable-evidence report uses existing `not_verified` and scope decisions. The lightweight fixture retains correction budgets. The foreign repository has no upstream package or AbraCode recipe, preserves local skills/control files and uses existing documented checks. No automatic recipe/glossary/host setup is performed.

Set `ABRACODE_TEST_JOURNEY=engineering` to execute the complete engineering recipe through the missing-evidence decision; the default native run retains all PR-feedback and post-merge assertions. Set `ABRACODE_TEST_EVIDENCE_DIR` outside the disposable installation root to retain `native-engineering.json`; bounded tool text, actual outcomes and matching receipts survive teardown. The fixture waits for its own server to exit before deleting its root and records success only after cleanup, with `cleanup_complete: true`. Screenshots remain scratch and are not claimed as durable attachments. These are scripted integration assertions, not an evaluation of autonomous model quality or proof of live remote behavior.

The engineering integration also exercises the foreign repository's existing README check through a native Apply read before running the source consumer proof. Verification setup stays fixture-owned. Native teardown waits for the owned server to exit and retains evidence only after cleanup completes.

Finishing baseline regressions retain the required pre-submission controller guard: forge-adapter tests reject a missing guard and assert the explicit test guard runs before any merge request. The delivery-wait fixture resumes through the controller API; setup residue blocks merge before collecting the retained answered approval. Native post-merge cleanup residue is introduced only after the guarded merge has been submitted, so it tests late cleanup without bypassing pre-merge disposition.

Research-report concurrency regressions in `policies.test.ts` rotate the reconciliation operation while report input is inspected, then require the report receipt and newer operation identity to survive. The paired pause case rejects the superseded assignment without publishing an intent or receipt. Report intent and receipt updates use the current record under the commit lock rather than saving an old operation snapshot; native acceptance reruns the original report path.

The cleanup concurrency regression in `finishing-decisions.test.ts` first reproduced a retained `cleaning` phase after a fresh absence scan when an independent observation advanced the record revision. Atomic residue resolution now preserves that observation and closes the preserved work. Preflight observations and resolution update current records under the commit lock; only inspected residue keys are superseded, and newer or unrelated decisions remain blocking.

## Reliable finishing acceptance

The full native PR journey in `pr-feedback.ts` uses an actual local-ahead commit after publication and a stale merge form. Exact-content adoption starts revision planning, configured checks and independent native Review without Apply, then fast-forwards the same owned PR. A fresh head needs its own merge form. The source asserted after restart is the validated late revision; forge creation and merge counts stay one. Revision OpenSpec metadata is created by the controller before native Explore admission, including recovery of a persisted planning phase.

That journey disables diagnostics and holds an initial Explore response under a short fixture watchdog to observe a real exhausted suspected stall. An explicit retry retains that history, and successful work supersedes it before unexpected generated output enters pre-merge inspection. The exact native directory form is still delivered and does not consume a diagnostic turn. Matching authorization permits normal approval and merge. Post-submission residue survives service restart; the pending form is recreated under its retained identity before reply. A new unknown sibling survives that directory-only answer, receives a new preservation question and closes only after explicit preservation and a fresh absence scan. No shell cleanup or explicit finish is used to dispose of authorized generated output.

Focused `finishing`, `finishing-decisions` and `finishing-recovery` tests cover legacy/malformed evidence, read-only preflight and publication, exact directory identity/regeneration/replacement, file-hash-bound inclusion, preservation/defer/reconsider, undelivered forms, shared read-only output, two durable synchronization admissions and one exact-input extra receipt under concurrent reconciliation. Lost native form, staging, commit, push and retirement responses retain existing identities; notification failure leaves closure intact. `records.test.ts` additionally preserves malformed original evidence and concurrent questions while committing owned finishing receipts. Native form selections are scripted integration proof, not model judgment or live GitHub evidence.

## Native communication, batch scheduling and report snapshots

The native fixture exercises retained steering and correlated replies, queued
admission across restart, failed-worker obligations, atomic batch retry identity,
and a two-slot automatic research batch. The parallel journey starts two of three
tasks, preserves their native session/prompt/worktree identities across restart,
and releases a third task before a lower-priority dependent task. All providers,
repositories and bare remotes belong to the disposable fixture.

`reporter.test.ts` preserves manual TSX authoring and exercises local navigation,
filtering, evidence disclosures, code/diffs, narrow layouts and feedback exports.
`report-snapshot.test.ts` validates bounded evidence/provenance and builds a real
isolated snapshot report, moves the HTML, then checks offline and opaque-sandbox
rendering. Hostile markup and script delimiters remain inert text. Checks with
missing evidence stay unavailable. Feedback is local review input and grants no
controller authority. See the reporter README for the optional safe data path.

`dispatch.test.ts` and the SQLite work-graph suite cover task/repository profile
validation, complete model precedence, snapshot immutability and schema-6 receipt
compatibility. The native model journey uses the existing deterministic provider
inventory and disposable Research sessions to observe a task-selected model,
restart with a changed profile, recover explicitly in the same session/worktree,
and refuse unavailable model/variant selections before session creation. See the
[model-dispatch recipe](verification/features/model-dispatch.md) for the focused
invocation and the full native suite for combined Apply/batch coverage. Fixture
models test routing and authority; they do not measure model quality or cost.

Native success assertions use `nativeObservation` only for documented transient
`resource_unavailable`/`OBSERVATION_UNAVAILABLE` reads, bounded to five seconds.
The native tool fixture applies the same bounded handling only to read-only
`work_list`, `work_ready` and `work_status`. It does not replay mutations or retry
semantic failures. Dedicated contention fixtures still require bounded unavailable
output, independent pause and valid-state restoration; missing selections still
require `not_found`. The browser branch journey asserts human plan authorization;
PR merge authorization remains in the separate real native PR journey. A branch's
transient finishing phase is not a PR approval gate.

The combined suite caps worker concurrency at four (or available CPUs when fewer). Real diagram preparation and native fixtures run alongside Git/OpenSpec checks; higher concurrency caused repeatable five-second Git timeouts and inspector detail starvation under the diagram-heavy native journey. The cap preserves all projects and assertions. The measured four-worker acceptance run executes 694 tests in approximately 160 seconds on the documented verification host.

For tests of retained execution fields, use `retainedExecution` to write a valid execution through the real coordinated Records store. Supply phase evidence only when the assertion depends on it. Checkpoint readers can consume a stored approval and a temporary proposal whose bytes the Git adapter actually fingerprints. The legacy migration cases still create distinct active, form, interrupted and completed executions. The checkpoint reader uses a stored finishing target and control generation. The finishing lifecycle suite still creates the actual residue decision and exercises native authorization.

On the same checkout, one run of `pnpm test:one packages/runtime/tests/unit/{records,web-checkpoints}.test.ts --maxWorkers=1` with the default timeout passed all 21 tests in 11.15 seconds before migration and 4.82 seconds after. Eleven records cases and three checkpoint cases now skip three repository initializations apiece. Thirteen also skip starting an execution through the controller, including the stale-replacement regression. These timings describe a single matched run.
