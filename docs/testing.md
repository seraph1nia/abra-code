# Acceptance coverage

Specification Review regressions in `tests/unit/spec-verification.test.ts` cover required assessment evidence, contradictory verdicts, intentional schema omissions, retained conflict decisions, blocked unsafe retry, approved-scope correction, fresh planning approval and legacy Review recovery. The native provider fixture submits the same full-spec evidence through `abra_review_report`; lightweight Review retains its short-contract report.

`tests/unit/native-contracts.test.ts` covers native model/error projection, UTC validation with TestClock, JSON omission semantics, phase evidence types, lazy single-flight acquisition with failure retry and injected FileSystem reads. Native guard fixtures assert the Effect cause category as well as rejection text. Existing Effect/process, coordination and native-renderer suites continue to validate callback lifetime, process-tree cancellation, task replacement and cleanup.

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

Run:

```sh
pnpm format:check
pnpm check
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm run doctor
```

The `test` block in `vite.config.ts` defines three Vitest projects: `unit`, `integration` (30-second timeout for real CLIs), and `e2e` (120-second timeout for the native server). `pnpm test` selects unit and integration; `pnpm test:e2e` selects the native-server test. Cleanup uses Vitest test-scoped hooks. `pnpm exec vp test run` runs all three projects.

Skill frontmatter is validated with the bundled skill-creator validator (using a temporary `uv` environment for its PyYAML dependency); linked local references and documented scripts are checked separately.

## Continuous integration

The `test` workflow runs on pushes to `main` and pull requests targeting `main`, including opened, reopened and updated PRs. Other branch pushes and PR bases do not trigger it. One Ubuntu job uses the Node version pinned in `mise.toml` and pnpm from `package.json`, caches the pnpm store, and runs:

```sh
pnpm install --frozen-lockfile --prod=false
pnpm format:check
pnpm config:schema
pnpm licenses:check
pnpm check
pnpm report:browser:install --with-deps
pnpm test
pnpm browser:install --with-deps
pnpm test:e2e
pnpm build
```

The frozen install includes developer dependencies and lifecycle scripts for Effect tooling, and populates the store used by offline installation tests. `pnpm check` includes linting, TypeScript, Effect diagnostics and report-template type checking. Named steps fail on errors without automatically formatting or fixing files. Reporter Playwright Chromium is provisioned before integration tests, and the native browser is provisioned before end-to-end tests. Both setup steps install Ubuntu browser libraries with `--with-deps`; local systems can use the commands without that flag and supply compatible system libraries. Fixtures use temporary repositories, local model endpoints and disposable local bare remotes, with no personal credentials or user-remote pushes.

Repository permissions remain read-only. Each job has a 30-minute timeout; a newer run cancels the previous run for the same PR/ref while unrelated refs keep running.

## Effect tooling

TypeScript **7.0.2** uses the native Effect language service from `@effect/tsgo`. The plugin keeps the conventional `@effect/language-service` configuration name in `tsconfig.json`; no legacy JavaScript language-service package is needed. Refactors, completions and type information come from the native language service. Editor Effect diagnostics are disabled there because the patched Oxlint integration reports them, following the upstream [Oxlint setup](https://github.com/Effect-TS/tsgo/blob/main/docs/README.md).

`pnpm install` runs `effect-tsgo patch --typescript --oxlint` through `prepare`. It patches both the native TypeScript compiler/language server and Oxlint's type-aware checker. Compatible versions are pinned together: TypeScript 7.0.2, `@effect/tsgo` 0.53.0, Oxlint 1.88.0 and oxlint-tsgolint 7.0.2004. Upgrade them together using the [supported-version table](https://github.com/Effect-TS/tsgo#supported-package-versions). The pinned terminal FFI package has a type-only TypeScript 5 peer declaration; the local peer policy allows TypeScript 7, with native terminal integration tests verifying compatibility.

`pnpm check:lsp` independently scans all project files with native Effect diagnostics enabled and treats warnings as failures. It excludes the unstable-API notice because OpenCode's public Effect client requires the pinned Effect HTTP modules. Oxlint still enforces that rule with a narrow exception at the HTTP adapter. This scan is also part of `pnpm check`.

Vite+ handles formatting and Effect-aware linting. Full type checking remains disabled in its lint configuration; `pnpm check` runs the patched workspace `tsc` separately.

The `lint` block in `vite.config.ts` enables the recommended Effect rules and excludes `.abracode`, `.lavish` and `dist`. Both `pnpm check` and `pnpm lint` run the Effect-aware checker through Vite+, failing on warnings as well as errors. `pnpm lint:effect` runs it directly. A development probe verified that an unexecuted Effect is rejected by `effecttsgo/floating-effect`.

Effect regressions cover application connections surviving registration until host scope closure, failed plugin setup releasing leadership, command interruption waiting for an uncooperative child, interruption preserving provisioning intent for recovery, monitor shutdown closing its subscription and in-flight reconciliation, failure releasing a real kernel lock, and cancellation of surviving command descendants. Tests execute production Effects at the test-runner seam and use temporary repositories; the real-server vertical slice continues to validate native host loading, permissions, schema interoperability and restart recovery.

Work graph integration tests cover durable reopen, normalized request retries, request rebinding, rollback after an injected SQL failure, competing creation and claims across processes, ownership-guarded transitions/history, missing dependencies, schema upgrades and workflow/scope/report persistence.

Git observation tests verify that status and fingerprints leave the index untouched when file timestamps change, preventing index-refresh races with delivery.

Effect process acceptance covers interruption of uncooperative leaders and surviving descendants, deadline termination before return, raw whitespace, independent stream budgets, bounded progress tails, environment overrides and explicitly allowed semantic exit codes. A controlled-clock test advances a configured check beyond the former 120-second blanket deadline. The same Runner is exercised in Node tests and the pinned native OpenCode end-to-end host.

Clock-controlled attention tests distinguish native content identity and explicit progress from repeated busy polls, cover live command deadlines and expiring waits, and retain one incident across restart/disposition/budget exhaustion. The native end-to-end fixture admits one Supervisor failure incident using the local model endpoint and records its disposition before retrying the worker. No routine poll or synthetic notice requests a model turn.

| Native orchestration improvement | Delivered acceptance evidence                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary CI/review waiting       | `delivery-wait.test.ts`: standing/human/review waits, clock-driven restart/backoff, transport and changed heads                                           |
| Schema/migration boundaries      | `contracts.test.ts`, `records.test.ts`, SQLite upgrade/request-identity fixtures                                                                          |
| Slow-operation ownership         | `coordination.test.ts`, independent-process `capacity.test.ts`, process descendant/deadline tests                                                         |
| Generated retirement             | `retirement.test.ts`: exact paths, tracked/symlink/nested/unknown refusal, replacement identity and lost-removal recovery                                 |
| Durable obligations/attention    | `obligations.test.ts`, `attention.test.ts`: owners, generations, expiry, native identity, bounded budgets/capacity                                        |
| Research/lightweight paths       | `policies.test.ts` and native E2E: no-OpenSpec work, immutable publication/restart, explicit report handoff and delivery                                  |
| GitHub evidence                  | `forge-readiness.test.ts`, `forge-findings.test.ts`, `preservation.test.ts`: required identity, methods, source/result retention and scoped summaries     |
| Correction rounds                | `corrections.test.ts`: finite rounds, immutable history/archives, fresh revision plan/merge approval; native successful and exhausted lightweight rounds  |
| Native observation               | `visibility.test.ts`, `ticket-diff.test.ts`, real OpenTUI sidebar fixture: bounded read-only projection, report loading, offline freshness and navigation |

Validated on 2026-10-15: `pnpm check` (formatting, lint, strict TypeScript and Effect diagnostics), `pnpm test` (176 tests in 29 files, including the native renderer), `pnpm test:e2e`, `pnpm build`, and strict OpenSpec validation for improve-native-orchestration. The built server/TUI import host Effect/OpenCode packages externally; their shared observer schema chunk has no filesystem or platform-adapter imports. The combined restart test retains migrated full-spec authorization, pending delivery, decisions, a retained research report and a corrected lightweight head without duplicate native IDs or unsafe retirement.

Type-contract coverage in `identity-contracts.test.ts` verifies that domain IDs cannot substitute for one another, plain strings cannot enter branded controller interfaces, native session brands remain identical, and decoded delivery phases retain their required commit evidence. `review-regressions.test.ts` covers research restart before prompt admission and stale saves after observation removal. Record/graph fixtures also cover malformed keys without losing valid history and preservation of arbitrary legacy assignees. The native pause assertion waits for the controller's confirmed stop checkpoint before resuming when monitoring still owns the execution lock.

Native/Effect adoption coverage: `native-contracts.test.ts` verifies schema reuse, UTC calendar validation, injected Clock/FileSystem, lazy single-flight acquisition and inventory selection. `tool-contracts.test.ts` verifies structured results, strict input validation, native failure versus defect channels and bounded progress. `visibility.test.ts` counts one scan per collection/request and verifies durable-success invalidations. `observability.test.ts` inspects finite method/role counters, failure deduplication, reconciliation timing and retained identity log annotations. The native renderer fixture verifies remapped Back/Home commands, host running/pending state, off-screen synchronization and failed-sync presentation without active polling or focus theft.

The native-server fixture exercises actual model-generated invalid/extra arguments, failed-tool state, structured output/content equality, setup progress, portable observer errors, home-scoped events, worker-location preflight, full-spec/research/lightweight delivery and durable restart. Native input repair is a pinned compatibility behavior: preserve the composed strict schema regression when updating OpenCode. All repositories/remotes in these tests are disposable local fixtures.

Inspect built-in Effect metrics through `Metric.value` or the host's configured metric consumer. Counters represent observer attempts, capacity-denied admission checks and distinct committed worker failures; repeated waiting checks can increment admission waits. Reconciliation timing includes failures/interruption. Correlation logs/spans expose retained identities only; raw output, credentials, provider response bodies and model/session/issue metric dimensions are excluded.

The correction-decision regression forces a newer native observation between execution read and decision append. The coordinated update must retain both values; stale observation merges must never discard an exhausted-budget decision. Adapter precondition checks also assert typed Fail causes for missing OpenSpec worktrees and mismatched forge repositories.

Validated on 2026-10-16 for adopt-native-opencode-effect-patterns: pnpm check (zero warnings/diagnostics), pnpm test (210 tests in 35 files), the real native-server E2E, and strict OpenSpec validation. Native E2E also verifies worker-location invalidations reach the central observer.

## Report template

`pnpm check` includes `pnpm report:check`, which checks the separate browser TypeScript/TSX project. The backend TypeScript configuration stays Node-oriented and includes the template's Node validation scripts. Root Vite+ formatting/linting includes the template sources; a scoped browser environment override supplies DOM globals. Generated `**/dist/**` files are excluded from linting. A temporary failing TSX assignment was rejected by the browser type check during implementation.

`tests/integration/reporter.test.ts` runs the real Vite+ report build into an owned temporary directory and checks for a single HTML file with inline JS/CSS. Playwright opens a moved copy offline at 375px, checks all three Mermaid SVGs, filtering, evidence/source disclosures and absence of page-wide overflow or resource requests. It also loads the same bytes in an opaque-origin Blob iframe with the native sandbox flags and verifies rendering, filtering and denied parent access. An example-only 150 KB size budget catches regressions that bundle the Mermaid engine into the finished page. Mermaid is used only by diagram tooling; the page displays prepared SVGs.

The validator test checks all shipped sources, syntax errors with line diagnostics, a diagram that parses but fails rendering, continued checking after failures, explicit paths from another working directory, and missing-file failures. An isolated authoring fixture checks compiled `.mmd` imports, browser hot updates after source edits, no runtime Mermaid module requests, and a direct Vite build rejecting a malformed unused source. The suite also covers missing build output, occupied ports for dev/preview, explicit alternate ports, dev entry serving, process shutdown and the file remaining intact afterward. Each process has its own group and cleanup only terminates owned processes; no existing listener is stopped. The template source is not modified by these tests. Install Chromium once, then run through `pnpm test` or:

```sh
pnpm report:browser:install
pnpm exec vp test run --project integration tests/integration/reporter.test.ts
pnpm report:validate
pnpm report:build
pnpm report:preview
```

Browser acceptance after changing content, assets or build plugins:

1. Build; copy `templates/reporter/dist/index.html` to another directory and open it with networking disabled. Confirm the title, styling, all three findings and diagrams, filter/empty state and evidence/source disclosures. Only evidence navigation should need the network.
2. Check desktop and 375px widths, including expanded evidence, for readable controls and no page-wide horizontal overflow. Tab from the filter to a disclosure and press Enter/Space; check visible focus.
3. Load the same bytes as a Blob in an iframe with `sandbox="allow-scripts allow-popups allow-forms allow-modals"` and `referrerpolicy="no-referrer"`. Do not add `allow-same-origin`. Repeat filtering/disclosure checks and confirm the parent cannot read the frame document.
4. Return the actual absolute HTML file link in a pinned OpenCode 2.0.28 graphical conversation; click it and test the existing preview or desktop pane. Start the explicit local preview command, visit its printed URL on the serving machine and repeat the controls. Stop it and confirm the direct file remains usable.

Observed on 2026-10-16: Chrome 155.0.8059.84 loaded the copied standalone HTML offline with no resource requests; filtering reduced three findings to one and evidence expanded. Keyboard Tab/Enter worked, with no horizontal overflow at 375px. A Blob-backed iframe using the pinned native sandbox flags rendered the report and supported the same controls while parent document access was denied. Dev and local HTTP preview are covered separately. Actual paired OpenCode GUI click-through remains unavailable in this agent session; source inspection is recorded separately in [API evidence](supported-apis.md#report-html-preview), not counted as a successful native GUI test.

Validated on 2026-10-16 for add-solid-report-template: frozen-lockfile installation, `pnpm check` (zero warnings/diagnostics), `pnpm test` (212 tests in 36 files), `pnpm test:e2e` (real pinned native-server fixture), `pnpm build`, `pnpm report:build` and strict OpenSpec validation all passed. The standalone example is approximately 18.6 kB before compression. A temporary content edit appeared in a checked build and was restored; the failing TSX probe was removed. Browser acceptance used an isolated temporary Chrome install, with no browser dependency added to the repository. The actual paired native GUI limitation above remains separate from these passed checks.

Mermaid extension validated on 2026-10-16: frozen-lockfile installation, `pnpm check` (zero warnings/diagnostics), `pnpm test` (213 tests in 36 files), `pnpm test:e2e` (the real native-server fixture), and `pnpm report:build` passed. Mermaid 12.2.0 and Playwright 1.64.1 are pinned in the template workspace. The three shipped diagrams render without resource requests in both the moved offline file and the Blob sandbox, using Playwright's Chromium 156.0.8078.4. The full-Mermaid example is approximately 5.15 MB before compression (1.46 MB gzip). Chromium is now an explicit development prerequisite; `REPORT_CHROMIUM_PATH` can select an existing compatible installation. The actual paired native GUI limitation above still applies.

Build-time SVG compilation validated on 2026-10-16: frozen-lockfile installation, `pnpm check` (zero warnings/diagnostics), `pnpm test` (214 tests in 36 files), the real native-server E2E, `pnpm report:build` and explicit-file `pnpm report:validate` passed. The finished example is approximately 95 KB (22 KB gzip), about 98% smaller than the full-Mermaid report. A 150 KB example budget, offline/sandbox browser tests, source disclosures, development hot updates and rejection of invalid unused sources are covered. The isolated diagram server uses custom middleware without the app's SPA fallback and keeps its optimization cache separate from the report and from other build modes; successful-build/validator assertions also reject background transform errors. Mermaid remains available to authoring and validation tooling as a development dependency and is absent from the report's runtime imports.

## PR action lifecycle regressions

`action-lifecycle.test.ts` records run-level POSTs for two failed job findings, preserves reservations through restart/control generation, recovers an approved permission preflight without another form, and proves a pause between preparation and admission sends nothing. Legacy uncertain permission errors remain observation-only and keep their original receipts. `action-clearance.test.ts` exercises explicit finish, completed merge approval and periodic reconciliation before required outbox work exists, checks same-head approval retention and verifies the manual-default path. A completed merge shares one canonical check observation with feedback clearance. `action-recovery.test.ts` covers lost command responses, deadlines, malformed output and interruption across ready/reviewer/reply/rerun actions, crash after admission, and mixed legacy stages through storage. Every potentially submitted case reloads its original identity and reconciles without another send.

The canonical provenance fixtures in `pr-feedback.test.ts` keep same-name required/advisory apps and commit statuses distinct and exclude superseded failures. Supplemental logs may be unavailable without changing authority. Terminal feedback/external data lives in `tests/tui/feedback-fixtures.ts`; `sidebar.ts` still drives the actual native renderer, lazy reads, narrow layout and action-state labels. Existing external validation and coordination fixtures exercise custody, capacity and stop/restart through the owning service rather than an inline lifecycle branch.

The native `tests/e2e/pr-feedback.ts` scenario runs through the real server and workers with a local recording forge: recoverable permission preflight, completed approval before required actions, two failed jobs sharing one old-attempt rerun, correction, lost reply response, resolution, merge and server restart. `native.test.ts` owns the shared process/worker harness. External preflight failure separately verifies reservation release before launch.

All fixtures remain temporary and external mutations are recording fakes; no live GitHub write, user remote, model provider or shared no-mistakes runtime is used. Action versions must preserve IDs/forms/markers/history/budget and refuse unsupported or incomplete evidence without inventing a safe retry.

## Worker policy and context acceptance

`tests/unit/role-policy.test.ts` covers role authority, native permission scope, additive requirements and forbidden alternatives. `tests/unit/patch-guards.test.ts` retains symlink/move/control-file checks and direct forbidden/inactive tool calls. `tests/unit/worker-context.test.ts` covers native-ID skill resolution, unusable content, tool alternatives, immutable capture, pre-session failures, bounded/legacy/malformed diagnostics, read-only inspection with an unresolved question, partial payload publication, stale observations, policy incompatibility and cold-location activation. `tests/unit/worker-lifecycle.test.ts` changes issue/role sources between uncertain admission attempts and requires the original prompt identity and payload.

The real native test in `tests/e2e/native.test.ts` also runs `tests/e2e/worker-context.ts`. It uses copied central role definitions and disposable foreign repositories to verify that a central-only explicit agent is absent at a worker location, a required skill blocks before session creation, and a permitted required tool removed by the test plugin prevents its provider request. Its deterministic provider counts requests carrying the missing-tool assignment. Existing patch-only, denied management, full-spec/lightweight/research, spec-verification Review, protected approval/delivery, restart and retired-resource cases remain in the same suite. The fixtures use local bare remotes only.

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

`tests/e2e/browser.ts` extends the existing native server's model-scripted tool calls; browser commands traverse the real native tool executor rather than a fake CLI. All four roles load `abra-browser`, run `skills get core` and `--version`, browse a local HTTP counter, inspect a snapshot, click its reference, capture a generated screenshot outside the repository, read its PNG through the native file tool and close the assigned name. Browser-only roles attempt both an unrelated command and a forbidden command chained to an allowed CLI command. The test checks native refusal and absence of their output files. A separate driver check opens two real worker-named browsers concurrently and verifies navigation/storage isolation and close independence. Local bare remotes remain the only Git remotes used by these fixtures.

The browser setup integration test runs the actual doctor entrypoint in a disposable home with a recording executable: only absolute-central `--version` is invoked, and a missing executable reports the central install/build clearing action. Unit tests cover ordinary admission without browser guidance or browser-only shell tools, explicit browser prerequisites without OpenSpec, retained Apply development-shell requirements, per-session context naming, narrow evidence read rules and unchanged recovery captures. Browser skill frontmatter also passes the skill validator. CLI/browser acceptance was verified on 2026-10-17 with agent-browser 0.39.1 and Chrome 155.0.8059.84; native API evidence is retained in [supported APIs](supported-apis.md#agent-browser-cli-and-native-command-permissions).

## AbraCode source-release acceptance

`pnpm test:e2e` includes two isolated Linux source installations. `installation.test.ts` copies current tracked application assets into a temporary root, runs `pnpm install --frozen-lockfile --prod=false --offline` against the supplier cache populated by the initial frozen install, and checks alternate personal config selection, static validation without state, noninteractive launch diagnostics, generated settings, repeated service/Abra reuse, the native auth command route, explicit config application and legacy-file preservation. It launches/relaunches the normal entry point through a disposable util-linux PTY, observes the AbraCode footer and verifies that the same Abra/service is retained. Selecting another personal file refuses the running service before changing generated settings. Full installs use disk-backed temporary directories (override with `ABRACODE_TEST_INSTALL_ROOT`) and copy supplier packages so install hooks cannot modify another fixture's dependencies. The test pool is bounded to one worker to keep native processes and installation memory bounded. Native config/data/cache/state are isolated; it writes no personal credentials.

`native.test.ts` also installs the frozen source fixture, then exercises the installed plugin/CLI against a deterministic loopback provider and disposable local bare Git remotes. It covers controller-owned work, direct foreground/queued prompt denial before provider calls, Abra-only questions/forms, preserved approval identity, config edit/application, declaration removal/restoration, captured settings across restart, delivery and retained history. Browser prerequisites are provisioned explicitly before the suite. Nothing pushes to a user remote or calls a paid provider.

`configuration.test.ts` and `declarations.test.ts` cover strict decoding, role overrides, schema/example agreement, exact ignore rules, generated settings in two roots, legacy-path refusal, comment preservation, cooperating concurrent writes, independent edit conflicts, unwritable/interrupted writes, pending failures and omission semantics. Release CI additionally runs `pnpm config:schema` and offline `pnpm licenses:check`; changed or unreviewed evidence is a release failure.

Delivery-outcome regressions cover receipt-only merge approval, actual execution-lock contention versus helper/body failures, independent stage projection, safe bounded path samples, cleanup backoff and attention deduplication, and cleanup-only continuation after restart. The native forge fixture delays a local-only merge to exercise an overlapping approval request, retains ignored fixture residue through service restart, compares status/detail outcomes, then answers its native generated-directory form and verifies automatic retirement and closure without another finish call. A new unknown file after restart survives the directory-only answer; explicit preservation and fresh absence permit closure. Its existing local bare-remote guard remains mandatory; no user remote is a test target.

## Engineering procedures and verification recipes

Use the [executable recipe and feature map](verification/README.md) for isolated journeys and evidence that survives teardown. `engineering-skills.test.ts` tests portable registration, local preservation, exact IDs and role/default/configured selection. `engineering-recovery.test.ts` exercises NativeRuntime preflight against a serialized pre-suite context with only old inventory, lost admitted responses, original provenance, current policy incompatibility and fresh admission defaults. Existing immutable-context/request-tool and lost-response lifecycle regressions remain applicable.

`tests/e2e/engineering.ts` supplies deterministic native tool calls within the existing real-server fixture: applicable skill loading by every coding role, post-loading management/delegation and edit/shell denials, a symptom-specific failing consumer invocation followed by the original green recheck, and Review reading unstaged/untracked proof under controller receipts. A separate full-spec unavailable-evidence report uses existing `not_verified` and scope decisions. The lightweight fixture retains correction budgets. The foreign repository has no upstream package or AbraCode recipe, preserves local skills/control files and uses existing documented checks. No automatic recipe/glossary/host setup is performed.

Set `ABRACODE_TEST_JOURNEY=engineering` to execute the complete engineering recipe through the missing-evidence decision; the default native run retains all PR-feedback and post-merge assertions. Set `ABRACODE_TEST_EVIDENCE_DIR` outside the disposable installation root to retain `native-engineering.json`; bounded tool text, actual outcomes and matching receipts survive teardown. The fixture waits for its own server to exit before deleting its root and records success only after cleanup, with `cleanup_complete: true`. Screenshots remain scratch and are not claimed as durable attachments. These are scripted integration assertions, not an evaluation of autonomous model quality or proof of live remote behavior.

The engineering integration also exercises the foreign repository's existing README check through a native Apply read before running the source consumer proof. Verification setup stays fixture-owned. Native teardown waits for the owned server to exit and retains evidence only after cleanup completes.

Finishing baseline regressions retain the required pre-submission controller guard: forge-adapter tests reject a missing guard and assert the explicit test guard runs before any merge request. The delivery-wait fixture resumes through the controller API; setup residue blocks merge before collecting the retained answered approval. Native post-merge cleanup residue is introduced only after the guarded merge has been submitted, so it tests late cleanup without bypassing pre-merge disposition.

Research-report concurrency regressions in `policies.test.ts` rotate the reconciliation operation while report input is inspected, then require the report receipt and newer operation identity to survive. The paired pause case rejects the superseded assignment without publishing an intent or receipt. Report intent and receipt updates use the current record under the commit lock rather than saving an old operation snapshot; native acceptance reruns the original report path.

The cleanup concurrency regression in `finishing-decisions.test.ts` first reproduced a retained `cleaning` phase after a fresh absence scan when an independent observation advanced the record revision. Atomic residue resolution now preserves that observation and closes the preserved work. Preflight observations and resolution update current records under the commit lock; only inspected residue keys are superseded, and newer or unrelated decisions remain blocking.

## Reliable finishing acceptance

The full native PR journey in `pr-feedback.ts` uses an actual local-ahead commit after publication and a stale merge form. Exact-content adoption starts revision planning, configured checks and independent native Review without Apply, then fast-forwards the same owned PR. A fresh head needs its own merge form. The source asserted after restart is the validated late revision; forge creation and merge counts stay one. Revision OpenSpec metadata is created by the controller before native Explore admission, including recovery of a persisted planning phase.

That journey disables diagnostics, retains an exhausted initial worker failure and brings unexpected generated output into pre-merge inspection. The exact native directory form is still delivered and does not consume a diagnostic turn. Matching authorization permits normal approval and merge. Post-submission residue survives service restart; the pending form is recreated under its retained identity before reply. A new unknown sibling survives that directory-only answer, receives a new preservation question and closes only after explicit preservation and a fresh absence scan. No shell cleanup or explicit finish is used to dispose of authorized generated output.

Focused `finishing`, `finishing-decisions` and `finishing-recovery` tests cover legacy/malformed evidence, read-only preflight and publication, exact directory identity/regeneration/replacement, file-hash-bound inclusion, preservation/defer/reconsider, undelivered forms, shared read-only output, two durable synchronization admissions and one exact-input extra receipt under concurrent reconciliation. Lost native form, staging, commit, push and retirement responses retain existing identities; notification failure leaves closure intact. `records.test.ts` additionally preserves malformed original evidence and concurrent questions while committing owned finishing receipts. Native form selections are scripted integration proof, not model judgment or live GitHub evidence.
