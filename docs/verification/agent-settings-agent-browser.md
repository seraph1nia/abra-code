# Agent settings reproduction with agent-browser

Observed on 2026-11-19 against the running development app at http://127.0.0.1:5173/settings. This is a reproduction of the operator's reported failure, not a mocked response or disposable backend.

**Resolved on 2026-11-19:** the native service was restarted to load the current plugin, and the development preview was restored at the same URL. Agent-browser now observes HTTP 200, all six agent definitions and no visible errors, including after refresh and a full reload. The initial failure evidence below is retained for comparison.

The project-local agent-browser 0.43.0 launched its provisioned Chrome for Testing 158.0.8127.36 in the task-owned session `codex-settings-evidence-806c6c2967b1`. The browser used a 1440 × 1000 viewport and dark color scheme.

## Finding

The Settings page renders, but no agent definitions load. The browser observes `GET /api/settings/agents` returning HTTP 409 with:

```json
{
  "_tag": "WorkspaceError",
  "code": "WEB_NATIVE_UPDATE_REQUIRED",
  "message": "The running AbraCode service does not support this workspace feature yet. Restart the service to load the updated plugin."
}
```

Clicking Retry makes another catalog request and leaves the same visible error. The authenticated native gateway's missing-method error is mapped to this compatibility response by `packages/runtime/src/web/native-errors.ts`; the active native plugin has not loaded the new catalog endpoint. Updating the frontend alone does not reload that plugin.

## Reproduction

Run from the repository root after `mise run setup`:

```sh
mise exec -- pnpm exec agent-browser skills get core
mise exec -- pnpm exec agent-browser --session codex-settings-evidence-806c6c2967b1 open http://127.0.0.1:5173/settings
mise exec -- pnpm exec agent-browser --session codex-settings-evidence-806c6c2967b1 wait --text WEB_NATIVE_UPDATE_REQUIRED
mise exec -- pnpm exec agent-browser --session codex-settings-evidence-806c6c2967b1 snapshot
mise exec -- pnpm exec agent-browser --session codex-settings-evidence-806c6c2967b1 network requests --filter /api/settings/agents
mise exec -- pnpm exec agent-browser --session codex-settings-evidence-806c6c2967b1 set viewport 1440 1000
mise exec -- pnpm exec agent-browser --session codex-settings-evidence-806c6c2967b1 set media dark
mise exec -- pnpm exec agent-browser --session codex-settings-evidence-806c6c2967b1 screenshot --full /tmp/agent-settings-error.png
```

Use the fresh Retry button ref from the snapshot, click it, wait for the same error, and capture another snapshot/network list. Finish with `mise exec -- pnpm exec agent-browser --session codex-settings-evidence-806c6c2967b1 close`.

## Retained evidence

Actual artifacts are retained under `.abracode/evidence/agent-settings-agent-browser-VUFDs5/`:

- `settings-error.png`: full-page screenshot, matching the reported error.
- `03-snapshot.txt`: visible heading, read-only label, compatibility error and Retry button.
- `07-network.txt`: original catalog request and HTTP 409.
- `08-response.txt`: original captured request/response detail.
- `08-response.json`: same-origin read through agent-browser confirming the typed error body.
- `11-retry-snapshot.txt` and `12-retry-network.txt`: unchanged failure after Retry.
- `13-close.txt`: owned browser session closed.

The native service, Abra session, work graph and existing browser sessions were not restarted or modified. No form reply, work action or model request was made. Resolving the version mismatch requires the normal controlled native-plugin reload or service restart.

## Installation changes

The CLI was already pinned at 0.43.0 in pnpm with its native build allowed. Mise setup now provisions its browser after pnpm installation. APM installs the [upstream discovery skill at the matching 0.43.0 commit](https://github.com/vercel-labs/agent-browser/blob/1cc19526f3641c8543d55aa6700e7c55b37ac356/skills/agent-browser/SKILL.md); its guide is loaded from the installed CLI. The root contributor instructions now prefer agent-browser for interactive verification and evidence. Automated regressions retain their existing test harness.

## Validation

`mise run setup` passed, including frozen pnpm installation, Chrome provisioning, frozen APM restoration and configuration-schema generation. `pnpm check` passed. `pnpm test:all` passed all 805 tests across 140 files in 175.87 seconds. The evidence directory also retains `mise-setup.log`, `browser-install.log`, `check.log` and `test-all.log`.

## Resolution evidence

The service was idle before the user-authorized `mise exec -- pnpm service:restart`. Its process changed from PID 570510 to PID 1813296; the retained Abra session stayed `ses_e2049f60effevD0FvGXtji7kf6`. The old development preview closed during that restart, so `mise exec -- pnpm dev` restored ports 5173 and 4098. No source-code fix was needed: the missing endpoint was already implemented in the current plugin.

Agent-browser session `codex-settings-fixed-806c6c2967b1` verified the actual running app, expanded Explore's configuration, refreshed the catalog and fully reloaded the page. All catalog reads returned HTTP 200. Browser assertions found exactly `abra`, `explore`, `apply`, `review`, `research` and `project-lead`, zero visible errors and zero editable fields. Browser error output was empty. The owned evidence browser was closed; the native service and development preview remain running.

Updated evidence is retained under `.abracode/evidence/agent-settings-fixed-PVEDq4/`:

- `agents-loaded.png` and `agent-details.png`: live page and expanded definition screenshots.
- `01-service-before.json`, `02-service-restart.log` and `04-service-after.json`: restart and preserved-session evidence.
- `08-agents-snapshot.txt`, `16-details-snapshot.txt` and `22-reloaded-snapshot.txt`: accessible page observations.
- `13-catalog-check.json`: HTTP 200, six definitions, zero errors and no editable fields.
- `23-network-after-refresh-reload.txt` and `25-final-assertions.json`: successful reads and assertions after refresh/reload.
- `24-browser-errors.txt` and `26-close.txt`: no browser errors and completed browser cleanup.
