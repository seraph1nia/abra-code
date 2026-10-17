# Proposal

## Why

Agents need a quick way to turn a report into an interactive page without setting up a new application or running Lavish's review machinery. A small Vite + Solid template can produce HTML that OpenCode already previews beside chat and that the user can also open as a normal page.

## What Changes

- Add a private report-template workspace at `templates/reporter/`, using TypeScript, Solid and Vite with plain CSS. Do not depend on `@opencode/ui` or a general UI kit.
- Provide one obvious report-authoring TSX file, a small example report, responsive styles, and local interactions such as filtering findings and expanding evidence. Ordinary Solid and semantic HTML remain the authoring interface.
- Build a self-contained `dist/index.html` with the report's supported assets included, so OpenCode's existing sandboxed HTML preview works without a directory server or CDN.
- Provide root shortcuts for development, type checking, building and explicitly serving the built page locally. Document returning a native file-preview link and, while the local preview is running, its browser URL in chat.
- Document the distinction between the existing HTML preview beside chat and HTML embedded in a message. This change uses the existing preview and does not modify OpenCode.
- Keep annotations, agent messaging, automatic research-report publication, hosting, UI protocols and lifecycle integration outside this first version.

## Capabilities

### New Capabilities

- `report-template`: simple Solid report authoring, portable HTML builds, existing OpenCode preview handoff and an optional local browser URL.

### Modified Capabilities

None. Existing work visibility, immutable research reports and worker permissions retain their current contracts; the template is a separate authoring tool, not a replacement report receipt or observer.

## Impact

- Add `templates/reporter/` with its own browser TypeScript and Vite configuration and usage documentation; register it in `pnpm-workspace.yaml` and add root `report:*` scripts and the required lockfile importer/dependencies.
- Reuse the existing Solid version and compatible Vite toolchain. Add Solid compilation and single-file bundling tooling without adding dependencies to the server plugin's runtime.
- Add a focused real-build portability check and verify the example in a browser and the pinned OpenCode HTML viewer. Update the repository README and testing documentation with commands and verified limitations.
- No changes to OpenCrew's database, tools, RPC, controller, research receipt format, permissions or native OpenCode application. No automated deployment, background service or public network binding.
