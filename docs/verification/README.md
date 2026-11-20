# AbraCode verification recipe

The focused controlled-replanning recipe is
`ABRACODE_TEST_JOURNEY=planning-recovery ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-planning-recovery pnpm test:one packages/runtime/tests/extended/native.test.ts`.
Use a fresh evidence directory outside the disposable installation. It reuses
the preparation, health checks and teardown below, exercising actual baseline,
restart, source rejection, adoption, fresh plan and independent Review gates.
See [the feature journey](features/full-spec.md#controlled-replanning-and-prospective-recovery).

Use the existing disposable source-installation and native-server harness. It drives the controller through native sessions and tools with a deterministic loopback model provider and a local recording forge. This proves integration and permission behavior, not autonomous model judgment or a live GitHub delivery.

For bounded repeated cycles, explicit fault profiles, native timing/resource
measurements and a separate authorized real-provider procedure, use
[operational verification](operational.md). Repeated soak cycles are opt-in.

## Prepare and check health

Use Node 26.4+ and the frozen pnpm toolchain. From the checkout:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
```

The native journey requires the frozen supplier cache, Git, the compiled `fs-ext` binding, and a previously provisioned compatible Chromium for agent-browser. Follow [browser prerequisites](../operations.md#browser-cli); browser installation is an explicit contributor setup step, never a recipe's automatic repair. `pnpm browser:install` provisions the browser if needed. Missing binaries/libraries must fail with the actual command output. Do not start or restart the operator's AbraCode service.

The shared harness in [native-fixture.ts](../../packages/runtime/tests/e2e/native-fixture.ts) creates its own installation root using [install.ts](../../packages/runtime/tests/e2e/install.ts), isolated native config/data/cache/state, loopback ports/provider, local repositories and bare remotes. It checks the native server's `server.info()` and activates the central location before driving it. Worker preflight waits for the worker plugin to become active. A process merely listening is not sufficient health evidence.

## Drive and retain evidence

Run the mapped [full-spec journey](features/full-spec.md) from the repository root:

```sh
mkdir -p /tmp/abracode-verification-evidence
ABRACODE_TEST_JOURNEY=engineering \
ABRACODE_TEST_EVIDENCE_DIR=/tmp/abracode-verification-evidence \
  pnpm test:one packages/runtime/tests/extended/native.test.ts \
  > /tmp/abracode-verification-evidence/native.log 2>&1
```

Use a fresh evidence directory per run to avoid confusing old output with a new observation. It must be outside the fixture installation root. A successful exit and Vitest result are required; read `native.log` on failure. `native-engineering.json` records the actual result, timestamp, native tool outcomes, red/green consumer observations, reviewed worktree status and controller receipts. Neither an old file nor a skill invocation establishes a pass.

`ABRACODE_TEST_JOURNEY=engineering` selects the complete engineering journey through approval, diagnosis, independent Review, preserved branch/retirement, restart, lightweight correction and the missing-evidence decision. The extended native suite additionally runs the separate PR-feedback and post-merge-residue assertions; use `pnpm test:native` for that coverage. The focused recipe does not claim those additional assertions passed.

After the runner exits, confirm both files still exist and the recorded `result` is `pass` with `cleanup_complete: true`. The JSON includes bounded text observations rather than screenshot image payloads. Browser screenshots remain disposable scratch evidence; they are read/asserted during the test and are not claimed as retained attachments. A report that names a deleted screenshot cannot use that path as later proof.

## Cleanup and limits

The test stops only its own child server/provider and browser sessions, then removes its own installation root. It never kills by process name, touches the operator service, or pushes to user remotes. Failure teardown runs too. Evidence outside the fixture root survives; the caller owns that directory. Do not remove retained evidence to make a failed run appear clean.

The [feature map](features/README.md) describes other journeys and their limitations. When a scoped change alters a mapped entry point, precondition or expected state, update that journey alongside the harness. Recipes in foreign repositories use their existing documentation/checks; this document is not globally registered as a worker skill. Scoped recipe creation uses `abra-verification` and must be exercised before being described as usable.

## Local web acceptance

`pnpm exec vp test run --project integration packages/runtime/tests/integration/retained-observation.test.ts`
uses real in-memory SQLite and the existing controller fixture to force an
intervening graph commit, continuous contention and a stalled record scan.
It also exercises real independent shared `fs-ext` lock owners, exclusive commits and
refused read-to-write upgrades. It verifies coherent retry, bounded unavailable output, released locks and pause
availability while a native observation remains pending. It starts no service
and uses no user repository or remote. Contributor fixtures remain disposable.

`pnpm exec vp test run --project e2e packages/runtime/tests/e2e/web-coherence.test.ts` exercises the built frontend against a disposable typed HTTP/AG-UI fixture: Pierre split diff/search without a separate file list, URL history, desktop/mobile themes, policy-specific planning, exact decision/communication navigation, response recovery and pagination, off-page refreshes with retained data after errors, focus restoration, form binding resets, simultaneous native reply state, one startup bootstrap and explicit same-ID recovery after reload. Set `ABRACODE_TEST_EVIDENCE_DIR` outside the fixture for retained screenshots. Build the web assets first with `pnpm web:build`. This fixture proves frontend behavior; the installation journey below proves real native contracts.

`pnpm test:one packages/runtime/tests/extended/installation.test.ts` builds and starts the shipped CopilotKit v2 workspace against its disposable installation. Runtime instructions and skills come from `packages/agents/assets`; the source-installation fixture omits the contributor `.agents` directory. Chromium opens the retained Abra without credentials, answers native conditional/default/hidden/string/number/integer/choice/multiselect/external fields, rejects an unbound controller checkpoint, reloads and reconnects after native service restart. Frontend shutdown must leave the native service and session usable. With `ABRACODE_TEST_EVIDENCE_DIR` set outside the fixture root, desktop and narrow screenshots survive teardown. It uses the existing report Chromium prerequisite and never touches the operator service.

`pnpm exec vp test run --project integration packages/runtime/tests/integration/web-workspace.test.ts` exercises Effect HTTP plus shared `HttpApiClient`: response/payload/query validation, typed failures, exact host/origin checks, encoded-path rejection, raw native-route exclusion, CopilotKit v2 Fetch/AG-UI identity and retry behavior, and report sandbox/download headers. Unit tests in `web-admissions.test.ts` and `web-agent.test.ts` prove durable-before-admission identity binding, simultaneous tabs, response loss, interruptible observations and explicit native stop semantics. The retired general proxy/WebSocket/form-projection contract is removed.

`pnpm test:one packages/runtime/tests/extended/development.test.ts` launches the public `pnpm dev` command in a disposable source install, exercises TanStack Router navigation, edits React source and checks that HMR preserves the draft, edits the Effect server and observes changed response headers through the Vite proxy, then proves shutdown preserves the native session. With an external evidence directory it retains `development.json` after cleanup.

`pnpm test:one packages/runtime/tests/integration/service-recovery.test.ts` starts an isolated native service with an unresolvable local plugin import. The public startup command must report the native failed-plugin diagnostic without waiting for activation timeout. Stop must refuse another selected configuration and a copied foreign registration, then stop the owned failed service before a Supervisor exists. The fixture owns its registration, native process and temporary state; teardown never stops the operator service. `fast/plugin-activation.test.ts` separately checks cold activation and the 15-second timeout using a controlled clock.

`ABRACODE_TEST_JOURNEY=workspace pnpm test:one packages/runtime/tests/extended/native.test.ts` drives project registration, work intake, A2UI v1 rendering, full-spec plan approval, implementation, independent Review and branch delivery/closure from the browser. Native reads supply assertions; all workflow mutations in that journey enter through the main chat or native form dock. The branch policy requires plan approval; PR-specific merge gating remains covered by the native PR journey. The routine E2E suite keeps the native workspace journey; the extended suite retains the other native journeys. Evidence records the actual approval kinds, retains screenshots outside the disposable installation, and reports cleanup.

The full native fixture continues to use its own authenticated native service for administrative setup and worker inspection. Its controller/approval/finishing assertions and deterministic-provider limits remain separate from the browser field journey. The new browser does not expose that native administrative API.

For complete current native coverage use `pnpm test:native`; the explicit
`native.test.ts` path selects the core journey or `ABRACODE_TEST_JOURNEY` subset.
The independently scheduled native files preserve the other feature journeys.

## Recorded exercise

Executed on 2026-10-17 using:

```sh
ABRACODE_TEST_JOURNEY=engineering \
ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-engineering-journey \
  pnpm exec vp test run --project e2e packages/runtime/tests/e2e/native.test.ts \
  > /tmp/abra-engineering-journey/native.log 2>&1
```

Observed one native test passed in 105.29 seconds. The consumer invocation returned exit 1 before the scoped source edit and exit 0 afterward with `sample consumer observed sample`. Independent Review read the untracked proof under matching controller receipts; the unavailable runtime audit case retained `not_verified` and an open decision without delivery. The seeded historical capture remained unchanged across the native restart, and fresh preflight selected current defaults. After the server/provider stopped and the temporary installation root was removed, `native.log` and `native-engineering.json` remained at the named external paths; the JSON recorded `result: pass` and `cleanup_complete: true`. This focused run excludes the separate PR-feedback/post-merge-residue assertions and does not measure autonomous model quality.

Finishing behavior uses `pnpm test:one packages/runtime/tests/extended/native-finishing.test.ts`
or the complete `pnpm test:native` run. The focused engineering recipe excludes the additional PR synchronization and native finishing forms; neither planning artifacts nor an older engineering result establish those acceptance cases.

Full acceptance completed on 2026-10-18: `pnpm check`, `pnpm test` (349 tests in 59 files), `pnpm test:e2e` (both native and source-installation tests), `pnpm licenses:check`, and strict validation of `add-worker-engineering-skills` passed. The full native run used `ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-engineering-final-acceptance`; its JSON recorded `result: pass` and `cleanup_complete: true` after teardown. It covered the PR-feedback/post-merge-residue path in addition to the focused engineering journey.

Reliable-finishing acceptance on 2026-10-18 used the full default suite with `ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-complete-work-native-20261018-final`. The retained native JSON records `result: pass` and `cleanup_complete: true`. The journey republishes a late local-ahead revision to the same PR, refuses stale approval, routes generated-directory authorization despite a real exhausted stall and zero diagnostics, and retires/closes automatically across restart. An unknown new sibling survives the directory-only answer and requires its own preservation decision and fresh absence scan. The final preserved source is asserted from Git; the recording forge creates and merges exactly one PR. This is disposable native integration evidence, not a live GitHub or autonomous model claim.

Saved-report verification uses the [report feature recipe](features/visual-reports.md). Its React integration builds relocated offline opaque HTML, measures bytes, and starts/stops only an explicitly requested preview. The native workspace journey saves JSON, explicitly exports/downloads HTML without provider calls, restarts and reopens frozen values after worktree retirement. The independent research-report journey preserves the accepted Markdown contract.

The compact-loop variant uses `ABRACODE_TEST_JOURNEY=simplify-loop` with the same
native test/evidence command above. It checks attended automatic planning and
finite repair, retained stronger human plan/merge gates, skipped specifications,
scope decisions, pause and restart. See the [full-spec feature map](features/full-spec.md#compact-routine-loop-and-retained-gates)
for its assertions and limits. Only disposable fixture policy is opted in.

The portable renderer's focused compiler/cache proof is
`pnpm exec vp test run --project integration packages/runtime/tests/integration/renderer-shell.test.ts`.
It needs the frozen supplier cache but no browser or native service. It simulates
interrupted compiler output, then uses the actual application compiler to verify
cross-owner concurrent preparation, second-document reuse, inert JSON, source and
notice identity changes, unrelated backend/lock stability and cache tamper refusal.
SVG, offline opaque-frame interactions and browser caching remain in final native/
browser acceptance. `pnpm build` includes preparation; `pnpm report:prepare` is the
same explicit source-installation recipe without rebuilding the other applications.

Browser observation sequence proof uses
`pnpm test:one packages/runtime/tests/fast/web-observation.test.ts`, with a
controlled transport and clock at the same module interface the React hook uses.
It covers retired baselines, duplicate/gapped updates, overlapping refresh,
unavailable recovery, scoped off-page invalidation and disposal while reads and
timers are pending. After `pnpm web:build`, run `web-coherence.test.ts` and
`web-rendering.test.ts` for actual browser recovery with retained drafts,
admissions, history/selection and explicit Stop. Use a fresh external
`ABRACODE_TEST_EVIDENCE_DIR` for screenshots and logs; fixture cleanup leaves these
outside its disposable state. This adds no browser polling or native admission.

Native adapter/A2UI proof uses `native-agui-stream.test.ts`,
`surface-publications.test.ts`, `presentation-associations.test.ts` and
`web-workspace.test.ts`. These exercise real AG-UI reduction, complete-value
recovery, exact producing message/call/revision associations and refused generic
callbacks. The native workspace journey adds 55 disposable closed-history rows
and one blocked companion as setup data; those rows are not controller delivery
proof. It checks an unfiltered captured table beside a task-specific link, a live
reference outside the first closed page, separate saved live/snapshot coverage,
and two standard HTTP observers across detach/reconnect and native restart.
The deterministic provider pauses until a standard HTTP observer receives tool
start, then separately pauses for partial text; client callbacks release each gate.
This proves observation before provider completion without relying on global busy.
The pinned server does not publish partial argument deltas; controlled native-event
fixtures verify that supported mapping and mid-argument recovery separately.
`native-transport.json` retains the gate observations and event types even on failure.
Native workflow mutations for the main issue still enter through chat/forms.
Original revision reads and frozen exports survive main-work retirement without
provider calls. Generic A2UI action/envelope paths and middleware tool injection
remain unsupported under the documented custom contract.

## Workspace publication and runtime simplification

On 2026-11-19, verification used Node 26.13.0 and pnpm 12.21.0 on Linux. The tested working tree was based on `a032c0776225f722464684df34b574a687bf06b9`. Its source digest was `e30d7c1abfea157ab68de5404a02f154cf8fbf17abf08896779a3d52d18fd56b` across 1,232 files. The digest hashes each sorted nonignored source, test, dependency manifest and license path followed by NUL and the SHA-256 of its contents in `.opencode`, `apps`, `packages`, `scripts`, `licenses` and the root package, lock, workspace, TypeScript, Vite and license files.

- `pnpm test:all --maxWorkers=1` passed all 823 tests in 141 files in 769.59 seconds with the existing timeouts. The first four-worker attempt lacked offline pnpm metadata for two disposable installs. A clean frozen install populated it. A subsequent four-worker run hit the native journey deadline and seven unit-test deadlines. The complete one-worker run passed.
- The registered gateway regression measured four native supervisor lookups and four assignment scans before batching, then one of each for a full refresh, one for receipts alone and zero for an empty refresh. Interrupted first and replacement publications were read at each staged write and recovered under their original native call IDs.
- The native workspace journey saved the exact selected revision, exported and downloaded 1,889,685 bytes, reopened after service restart and completed fixture cleanup. Two extended portable browser tests passed in 80 seconds. The relocated 1,966,021-byte report rendered in an offline opaque frame at widths 375 and 390 with zero network requests or page errors.
- The clean-install CLI run rejected an unprepared export, produced byte-identical HTML after an engine edit, activated a new identity on explicit preparation and refused to overwrite an existing destination. The dedicated report tests also covered a damaged or redirected bundle, an interrupted replacement, in-flight eviction and receipt recovery.
- `pnpm check`, `pnpm build`, `pnpm licenses:check` and `pnpm exec openspec validate simplify-workspace-publication-and-runtime --strict` passed. The native journey used a disposable local provider and local bare Git remotes. Raw logs, timing measurements, screenshots and CLI artifacts for this run are under `/tmp/abra-runtime-acceptance-ovVVBG` on the verification machine.

The [export measurements](../reports.md#measured-export-cost) include bytes read, source opens, application builds and diagram work. The [test fixture measurements](../testing.md) document the matched records and checkpoint runs.

The parallel, acceptance and lead journeys define their provider checkpoints alongside
the scenario in `tests/e2e/parallel.ts`, `tests/e2e/acceptance.ts` and `tests/e2e/leads.ts`. Each
fixture run creates its own gates and releases pending provider calls on teardown.

### Contextual cockpit

Run `ABRACODE_TEST_JOURNEY=cockpit ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-contextual-cockpit pnpm test:one packages/runtime/tests/extended/native.test.ts` from the repository root. This uses three disposable tasks, a real OpenCode server, a deterministic provider, and a task-owned agent-browser session. The journey drops the selected submission response after native admission, updates the worktree, fails one verification read, and checks that the original excerpt and linked answer reopen while a separate worker continues. The supervisor answer uses the native tool harness. The output directory contains the native result, cleanup receipt, steps, accessibility snapshots and screenshots at both widths.

The 2026-11-20 run retained its evidence in `/tmp/abra-contextual-cockpit-20261120`. The native result records a passing journey and completed cleanup. The focused admission, worker-evidence, ticket-diff and inspector-observation tests cover stale first sends, exact retries, trace and screenshot retention, and local reading history.

On that tree, `pnpm check` passed and `pnpm test:all` passed all 852 tests in 144 files. Strict OpenSpec validation passed for `add-contextual-cockpit-steering`. Separate repository-wide strict validation flagged 25 existing items. A clean copy of the OpenSpec artifacts at HEAD had the same failing items and finding counts. The evidence directory includes `check.log`, `test-all.log`, and `openspec-all.log`.
