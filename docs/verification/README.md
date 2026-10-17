# AbraCode verification recipe

Use the existing disposable source-installation and native-server harness. It drives the controller through native sessions and tools with a deterministic loopback model provider and a local recording forge. This proves integration and permission behavior, not autonomous model judgment or a live GitHub delivery.

## Prepare and check health

Use Node 24.11+ and the frozen pnpm toolchain. From the checkout:

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

After the runner exits, confirm both files still exist and the recorded `result` is `pass`. The JSON includes bounded text observations rather than screenshot image payloads. Browser screenshots remain disposable scratch evidence; they are read/asserted during the test and are not claimed as retained attachments. A report that names a deleted screenshot cannot use that path as later proof.

## Cleanup and limits

The test stops only its own child server/provider and browser sessions, then removes its own installation root. It never kills by process name, touches the operator service, or pushes to user remotes. Failure teardown runs too. Evidence outside the fixture root survives; the caller owns that directory. Do not remove retained evidence to make a failed run appear clean.

The [feature map](features/README.md) describes other journeys and their limitations. When a scoped change alters a mapped entry point, precondition or expected state, update that journey alongside the harness. Recipes in foreign repositories use their existing documentation/checks; this document is not globally registered as a worker skill. Scoped recipe creation uses `abra-verification` and must be exercised before being described as usable.

## Recorded exercise

Implementation validation will record the exact invocation and observed result here after the native journey passes. Planned finishing behavior is not a passed baseline merely because it appears in `complete-work-reliably` artifacts. This map describes only currently exercised assertions, not that change's completion.
