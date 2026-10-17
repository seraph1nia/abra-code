# Design

## Context

See `proposal.md` for motivation and `specs/report-template/spec.md` for the behavior contract. The user confirmed that “in chat” means OpenCode's existing HTML preview beside the conversation, with an additional page link.

- OpenCrew already pins Solid 1.9.12 and Vite+ 1.2.0. Its root `vite.config.ts` builds Node server/TUI plugins and its root TypeScript configuration includes Node-oriented `.ts` sources. It has no browser report package.
- `pnpm-workspace.yaml` currently defines overrides, including the Vite+ core alias for Vite, but no report workspace. `vp build` and `vp preview` expose the normal Vite build/preview commands.
- In OpenCode v2.0.28, `packages/gui-extensions/src/file/renderer.tsx` resolves agent-referenced file links into existing file tabs, or a native desktop browser pane for HTML. `file/artifact-view.tsx` renders HTML from a Blob URL in an iframe permitting scripts without same-origin privileges. A normal multi-file Vite build would not resolve sibling bundles from that Blob URL.
- `src/workflow/reports.ts` and `report-contracts.ts` retain immutable Markdown research reports. `work-policies` requires research workers to remain read-only. This template is independent of those contracts.
- The active `adopt-native-opencode-effect-patterns` change touches existing integration modules. This change adds an isolated authoring package and does not require those modifications.

## Goals / Non-Goals

**Goals:** Use ordinary TSX as the authoring surface, reuse the existing build toolchain, and make one HTML artifact work in both native preview and a browser. Keep the package independent of native client state and backend dependencies.

**Non-Goals:** A report schema/DSL, framework of report widgets, annotations, chat transport, MCP Apps/A2UI/AG-UI, controller publication, historical report inventory, an OpenCode fork or GUI extension, remote hosting, and automatic server lifecycle management.

## Decisions

### 1. Isolate the browser template in one private workspace

Add `templates/reporter/` as `@opencrew/report-template`, registered explicitly in `pnpm-workspace.yaml`. Give it its own `package.json`, `index.html`, browser `tsconfig.json`, `vite.config.ts`, `src/main.tsx`, `src/report.tsx`, `src/styles.css` and README.

Use the existing Solid version, Vite+ toolchain, `vite-plugin-solid` for JSX compilation, and `vite-plugin-singlefile` for portable output. Keep browser dependencies in the workspace and record compatible versions in the shared lockfile. Do not upgrade the orchestrator's pinned native dependencies or remove its Vite override to accommodate the report package.

Alternative: add a browser entry to the root Node build. A small workspace keeps DOM/JSX compiler options and browser imports out of the server/TUI build, while preserving one repository installation.

### 2. Author reports directly in TSX with plain CSS

`src/report.tsx` is the primary customization point. The initial example contains a title/summary, a small typed findings array with evidence links, a text filter, a simple comparison table and expandable evidence using semantic HTML. Keep the composition local; extract a wrapper only when the example actually repeats it. Inline SVG is sufficient for an example figure if useful.

Use system fonts, responsive CSS and ordinary labels/focus states. No `@opencode/ui`, Tailwind runtime, component library, charting package, remote font or CDN is needed. Native styling reuse was a possible convenience, not a requirement of HTML preview. The artifact renders inside its own document and can choose its own appearance.

Alternative: define a catalog and JSON report protocol now. Direct Solid authoring already supports custom interactions and avoids another interface agents must learn.

### 3. Build the portable artifact once

Configure Solid compilation and single-file output to produce `templates/reporter/dist/index.html`. Inline the application JavaScript, CSS and supported imported assets. Disable emitted source maps and avoid public-directory resources, external runtime dependencies, workers and fetch-loaded report data in the initial example. Render example figures inline and import supported raster assets through the bundler when necessary.

Document the supported asset conventions and the bundler's limitations rather than implementing a general HTML/CSS/JavaScript exporter. Add a real-build check that finds unexpected required sibling application resources and confirms the example needs no external assets. Browser verification must also exercise interactions with the artifact moved from its build directory and offline; a static scan alone does not prove portability.

Alternative: serve a normal asset directory and load its URL in every viewer. The existing native Blob-backed preview makes a self-contained artifact the simpler handoff. Vite's normal dev server remains available for authoring.

### 4. Expose four commands and use native links

Root shortcuts delegate to the report workspace:

| Command               | Behavior                                             |
| --------------------- | ---------------------------------------------------- |
| `pnpm report:dev`     | Start the normal authoring server and HMR explicitly |
| `pnpm report:check`   | Check the browser TypeScript/TSX project             |
| `pnpm report:build`   | Check and build the self-contained HTML              |
| `pnpm report:preview` | Serve the completed build locally, in the foreground |

Configure dev and preview listeners on `127.0.0.1`; use strict ports (defaults 5173 and 4173 respectively) and allow an explicit alternate port. A collision must fail rather than produce a misleading link. The command's actual listening URL is the browser handoff; do not hard-code a successful URL before startup. Preview must fail clearly when no build exists. This is a local development preview, not a production hosting service.

The documented agent recipe is: edit `src/report.tsx`, build, link the actual absolute `dist/index.html` path in chat, and start the explicit preview command when a browser URL is needed. Return both the file-preview link and the observed HTTP URL. File links use the client's existing native handling; they do not render HTML directly in a message. Treat native desktop browser-pane routing as an accepted equivalent of the file preview.

The HTTP link remains valid only while its process runs and is local to the serving machine. For remote clients, explain that limitation and retain the file-preview route through OpenCode. Remote access, publishing and a durable report URL are separate work. Do not introduce daemon discovery, pairing, reverse proxies or credentials here.

### 5. Leave orchestration and research evidence separate

The template imports no controller/native client and sends no prompts or approvals. Report builds run only where the author already has file and shell permissions. A Supervisor or research worker does not acquire those permissions by following the README. Automated conversion of retained research receipts into HTML is deferred; changing the editable example is not research-report publication or preservation.

Keep existing observer, report receipts, policies and database unchanged. Update the root README and `docs/testing.md` with the new commands, the native preview recipe, the local URL lifetime and the distinction from controller-owned research reports.

## Risks / Trade-offs

- [Single-file plugin compatibility with the existing Vite+ alias] → Pin a compatible version and exercise the actual browser build under the existing override before accepting the package; do not solve this by upgrading the native runtime.
- [Assets omitted from inlining] → Keep the example self-contained by construction, document supported imports, inspect real build output and verify moved/offline browser rendering.
- [Preview varies across clients] → Verify the pinned graphical OpenCode viewer and record its link format; provide the same built file and local browser option for clients without HTML preview. No TUI HTML rendering is promised.
- [Loopback URL is unusable from another machine or after process exit] → Label it accurately and preserve the independent file-preview link. Do not silently widen the listener or claim public hosting.
- [Portable output includes a JS runtime in each report] → Accept this small duplication for the first template; shared asset hosting is unnecessary for one standalone report.
- [New browser files evade root checks] → Include `report:check` in the root check path and ensure existing formatting/lint tooling covers the workspace with browser-appropriate configuration. Keep the root backend TypeScript project Node-oriented.

## Migration Plan

This is additive. Install the updated lockfile, use the new report commands and verify the example in native preview and a browser. Existing Lavish artifacts, sessions and retained research reports are not migrated. Rollback removes the report workspace registration, shortcuts and template dependencies; no persistent runtime data requires migration.

## Evidence

- Local: `package.json`, `pnpm-workspace.yaml`, `vite.config.ts`, `tsconfig.json`, `docs/supported-apis.md`, `src/workflow/reports.ts`, `src/workflow/report-contracts.ts`, and the full `work-visibility` and `work-policies` specifications.
- Native preview: https://github.com/anomalyco/opencode/blob/v2.0.28/packages/gui-extensions/src/file/artifact-view.tsx and https://github.com/anomalyco/opencode/blob/v2.0.28/packages/gui-extensions/src/file/renderer.tsx.
- Build references: https://github.com/solidjs/vite-plugin-solid and https://github.com/richardtallent/vite-plugin-singlefile.
- Local preview semantics: https://vite.dev/guide/static-deploy.html.
