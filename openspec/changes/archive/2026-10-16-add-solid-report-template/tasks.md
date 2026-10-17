# Tasks

## 1. Add the isolated report template

- [x] 1.1 Register `templates/reporter/` as the private `@opencrew/report-template` workspace with browser TypeScript/JSX configuration, HTML entry and Solid bootstrap; reuse the pinned Solid and Vite+ versions and add compatible Solid/single-file build plugins in the shared lockfile. Verify repository installation with the updated frozen lockfile and successful workspace type checking without changing native runtime versions.
- [x] 1.2 Add the editable `src/report.tsx` example and plain responsive CSS with summary, typed findings, evidence links, filtering, comparison table and expandable evidence. Verify keyboard operation and usable desktop/375px layouts in a browser; document `report.tsx` as the primary customization file in the template README.

## 2. Deliver the portable build

- [x] 2.1 Configure the workspace production build to emit a self-contained `dist/index.html` with application JS/CSS and supported imported assets included, without runtime CDNs or required sibling bundles. Add `pnpm report:check` and `pnpm report:build` root shortcuts, and verify that an edit to the example appears in a successful checked build under the existing Vite+ alias.
- [x] 2.2 Add a focused integration check that performs the real report build into a temporary output, verifies the HTML and its included application/style resources, rejects required sibling or remote example assets, and verifies the built page can be served. Run it through the existing integration test project; leave the source template unchanged and clean up only owned temporary resources.
- [x] 2.3 Document supported asset imports, single-file limitations and the build output in the template README. Verify the documented build recipe, then move the HTML out of its build directory and check content, filtering and evidence expansion in a browser offline and in a script-enabled iframe without same-origin privileges; record observed results or a concrete unavailable-browser limitation.

## 3. Provide local preview and native chat handoff

- [x] 3.1 Add `pnpm report:dev` and `pnpm report:preview` shortcuts using foreground Vite commands, loopback listeners, strict default ports and explicit alternate-port support. Verify successful serving, actual URL output, a clear failure for missing build output and an occupied-port failure; extend the focused integration check for these process/HTTP cases with scoped cleanup and no public binding.
- [x] 3.2 Document a short chat recipe in the template README and root README: edit, build, return the absolute HTML file link for the existing native preview, and provide the actual HTTP URL when local preview is running. Include URL lifetime, remote-client limitations, direct-file fallback and the existing Supervisor/research permission limits. Verify all command names and paths against the package scripts.
- [x] 3.3 Open the built example from the documented chat file link in pinned OpenCode 2.0.28 and verify its existing web HTML preview or desktop browser pane, local filtering/evidence controls and the independent browser URL. Record the tested link format and client/version in `docs/supported-apis.md`; record unavailable runtime verification explicitly rather than claiming it passed, and do not add a renderer, host patch or messaging bridge.

## 4. Integrate repository verification

- [x] 4.1 Include the report browser type check in the root check path and cover template files with the existing formatter/linter using browser-appropriate configuration. Verify that a temporary TSX type error is caught and that the backend remains Node-oriented; update `docs/testing.md` with the build/preview integration check and browser acceptance recipe.
- [x] 4.2 Run `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm build` and `pnpm report:build`; verify server/TUI outputs and the standalone report both build, existing research/observer coverage still passes, and tests use only disposable repositories without pushing to user remotes. Record any external/manual verification limitations separately from automated results.
