# AbraCode verification recipe

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

The native journey requires the frozen supplier cache, Git, util-linux `flock`, and a previously provisioned compatible Chromium for agent-browser. Follow [browser prerequisites](../operations.md#browser-cli); browser installation is an explicit contributor setup step, never a recipe's automatic repair. `pnpm browser:install` provisions the browser if needed. Missing binaries/libraries must fail with the actual command output. Do not start or restart the operator's AbraCode service.

The harness in [native.test.ts](../../tests/e2e/native.test.ts) creates its own installation root using [install.ts](../../tests/e2e/install.ts), isolated native config/data/cache/state, loopback ports/provider, local repositories and bare remotes. It checks the native server's `server.info()` and activates the central location before driving it. Worker preflight waits for the worker plugin to become active. A process merely listening is not sufficient health evidence.

## Drive and retain evidence

Run the mapped [full-spec journey](features/full-spec.md) from the repository root:

```sh
mkdir -p /tmp/abracode-verification-evidence
ABRACODE_TEST_JOURNEY=engineering \
ABRACODE_TEST_EVIDENCE_DIR=/tmp/abracode-verification-evidence \
  pnpm exec vp test run --project e2e tests/e2e/native.test.ts \
  > /tmp/abracode-verification-evidence/native.log 2>&1
```

Use a fresh evidence directory per run to avoid confusing old output with a new observation. It must be outside the fixture installation root. A successful exit and Vitest result are required; read `native.log` on failure. `native-engineering.json` records the actual result, timestamp, native tool outcomes, red/green consumer observations, reviewed worktree status and controller receipts. Neither an old file nor a skill invocation establishes a pass.

`ABRACODE_TEST_JOURNEY=engineering` selects the complete engineering journey through approval, diagnosis, independent Review, preserved branch/retirement, restart, lightweight correction and the missing-evidence decision. The default suite additionally runs the separate PR-feedback and post-merge-residue assertions; use `pnpm test:e2e` for that full acceptance. The focused recipe does not claim those additional assertions passed.

After the runner exits, confirm both files still exist and the recorded `result` is `pass` with `cleanup_complete: true`. The JSON includes bounded text observations rather than screenshot image payloads. Browser screenshots remain disposable scratch evidence; they are read/asserted during the test and are not claimed as retained attachments. A report that names a deleted screenshot cannot use that path as later proof.

## Cleanup and limits

The test stops only its own child server/provider and browser sessions, then removes its own installation root. It never kills by process name, touches the operator service, or pushes to user remotes. Failure teardown runs too. Evidence outside the fixture root survives; the caller owns that directory. Do not remove retained evidence to make a failed run appear clean.

The [feature map](features/README.md) describes other journeys and their limitations. When a scoped change alters a mapped entry point, precondition or expected state, update that journey alongside the harness. Recipes in foreign repositories use their existing documentation/checks; this document is not globally registered as a worker skill. Scoped recipe creation uses `abra-verification` and must be exercised before being described as usable.

## Local web acceptance

`pnpm exec vp test run --project e2e tests/e2e/web-coherence.test.ts` exercises the built frontend against a disposable typed HTTP/AG-UI fixture: Pierre split diff/search without a separate file list, URL history, desktop/mobile themes, policy-specific planning, exact decision/communication navigation, response recovery and pagination, off-page refreshes with retained data after errors, focus restoration, form binding resets, simultaneous native reply state, one startup bootstrap and explicit same-ID recovery after reload. Set `ABRACODE_TEST_EVIDENCE_DIR` outside the fixture for retained screenshots. Build the web assets first with `pnpm web:build`. This fixture proves frontend behavior; the installation journey below proves real native contracts.

`pnpm exec vp test run --project e2e tests/e2e/installation.test.ts` builds and starts the shipped CopilotKit v2 workspace against its disposable installation. Chromium opens the retained Abra without credentials, answers native conditional/default/hidden/string/number/integer/choice/multiselect/external fields, rejects an unbound controller checkpoint, reloads and reconnects after native service restart. Frontend shutdown must leave the native service and session usable. With `ABRACODE_TEST_EVIDENCE_DIR` set outside the fixture root, desktop and narrow screenshots survive teardown. It uses the existing report Chromium prerequisite and never touches the operator service.

`pnpm exec vp test run --project integration tests/integration/web-workspace.test.ts` exercises Effect HTTP plus shared `HttpApiClient`: response/payload/query validation, typed failures, exact host/origin checks, encoded-path rejection, raw native-route exclusion, CopilotKit v2 Fetch/AG-UI identity and retry behavior, and report sandbox/download headers. Unit tests in `web-admissions.test.ts` and `web-agent.test.ts` prove durable-before-admission identity binding, simultaneous tabs, response loss, interruptible observations and explicit native stop semantics. The retired general proxy/WebSocket/form-projection contract is removed.

`pnpm exec vp test run --project e2e tests/e2e/development.test.ts` launches the public `pnpm dev` command in a disposable source install, exercises TanStack Router navigation, edits React source and checks that HMR preserves the draft, edits the Effect server and observes changed response headers through the Vite proxy, then proves shutdown preserves the native session. With an external evidence directory it retains `development.json` after cleanup.

`ABRACODE_TEST_JOURNEY=workspace pnpm exec vp test run --project e2e tests/e2e/native.test.ts` drives project registration, work intake, A2UI v1 rendering, full-spec plan approval, implementation, independent Review and branch delivery/closure from the browser. Native reads supply assertions; all workflow mutations in that journey enter through the main chat or native form dock. The branch policy requires plan approval; PR-specific merge gating remains covered by the native PR journey. The default E2E suite runs both journeys. Evidence records the actual approval kinds, retains screenshots outside the disposable installation, and reports cleanup.

The full native fixture continues to use its own authenticated native service for administrative setup and worker inspection. Its controller/approval/finishing assertions and deterministic-provider limits remain separate from the browser field journey. The new browser does not expose that native administrative API.

## Recorded exercise

Executed on 2026-10-17 using:

```sh
ABRACODE_TEST_JOURNEY=engineering \
ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-engineering-journey \
  pnpm exec vp test run --project e2e tests/e2e/native.test.ts \
  > /tmp/abra-engineering-journey/native.log 2>&1
```

Observed one native test passed in 105.29 seconds. The consumer invocation returned exit 1 before the scoped source edit and exit 0 afterward with `sample consumer observed sample`. Independent Review read the untracked proof under matching controller receipts; the unavailable runtime audit case retained `not_verified` and an open decision without delivery. The seeded historical capture remained unchanged across the native restart, and fresh preflight selected current defaults. After the server/provider stopped and the temporary installation root was removed, `native.log` and `native-engineering.json` remained at the named external paths; the JSON recorded `result: pass` and `cleanup_complete: true`. This focused run excludes the separate PR-feedback/post-merge-residue assertions and does not measure autonomous model quality.

Finishing behavior requires the full default native run. The focused engineering recipe excludes the additional PR synchronization and native finishing forms; neither planning artifacts nor an older engineering result establish those acceptance cases.

Full acceptance completed on 2026-10-18: `pnpm check`, `pnpm test` (349 tests in 59 files), `pnpm test:e2e` (both native and source-installation tests), `pnpm licenses:check`, and strict validation of `add-worker-engineering-skills` passed. The full native run used `ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-engineering-final-acceptance`; its JSON recorded `result: pass` and `cleanup_complete: true` after teardown. It covered the PR-feedback/post-merge-residue path in addition to the focused engineering journey.

Reliable-finishing acceptance on 2026-10-18 used the full default suite with `ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-complete-work-native-20261018-final`. The retained native JSON records `result: pass` and `cleanup_complete: true`. The journey republishes a late local-ahead revision to the same PR, refuses stale approval, routes generated-directory authorization despite a real exhausted stall and zero diagnostics, and retires/closes automatically across restart. An unknown new sibling survives the directory-only answer and requires its own preservation decision and fresh absence scan. The final preserved source is asserted from Git; the recording forge creates and merges exactly one PR. This is disposable native integration evidence, not a live GitHub or autonomous model claim.

Saved-report verification uses the [report feature recipe](features/visual-reports.md). Its React integration builds relocated offline opaque HTML, measures bytes, and starts/stops only an explicitly requested preview. The native workspace journey saves JSON, explicitly exports/downloads HTML without provider calls, restarts and reopens frozen values after worktree retirement. The independent research-report journey preserves the accepted Markdown contract.

The compact-loop variant uses `ABRACODE_TEST_JOURNEY=simplify-loop` with the same
native test/evidence command above. It checks attended automatic planning and
finite repair, retained stronger human plan/merge gates, skipped specifications,
scope decisions, pause and restart. See the [full-spec feature map](features/full-spec.md#compact-routine-loop-and-retained-gates)
for its assertions and limits. Only disposable fixture policy is opted in.
