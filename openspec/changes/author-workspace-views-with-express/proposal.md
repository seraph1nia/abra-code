# Proposal

## Why

When Abra builds a workspace view, the Supervisor spells out a flat A2UI component tree in JSON, including IDs and child references. Express lets it describe the same layout with nested component calls. Abra already has the task context and publishing authority to do this in the current turn.

## What Changes

- **BREAKING** Replace the raw `surface` argument of `abra_render_ui` with `{ surface_id, source, validate_only? }`. The Supervisor supplies a complete view as untagged Express source. A valid call publishes by default.
- Bundle an on-demand `abra-express` skill for the central Supervisor. Provide catalog-derived component signatures, examples for work comparisons and snapshot views, and guidance for correcting rejected drafts.
- Compile Express locally and validate its output against the work catalog, actual work and resource references, layout limits and Mermaid checks. Return bounded, actionable diagnostics. Setting `validate_only: true` runs the same content checks and produces a validation result without publishing a revision.

## Capabilities

### New Capabilities

- `workspace-view-authoring` covers authoring, checking and publishing a generated workspace view from the Supervisor conversation.

### Modified Capabilities

## Impact

The runtime owns the tool, compiler and publication path. `packages/agents` owns skill registration and bundled instructions. The shared work catalog and surface decoder in `packages/contracts` supply the compiler vocabulary and the output contract. Update the native tool fixtures, presentation result handling, API evidence and dependency notices.

## Scope and Choices

Use the published TypeScript `@a2ui/agent` 0.1.0 server-side. Its public `ExpressParser.compile` accepts a complete source body and its web-core dependency range includes the project's 0.15.0 pin. Configure the parser with the work catalog, requested surface ID and A2UI v1.0. Require exactly one complete matching `createSurface` output. Express supports more operations and bindings than the AbraCode publication contract allows, so validate the entire compiled result before committing it. [A2UI inference formats](https://a2ui.org/concepts/inference-formats/)

Keep existing publication ownership, revision identity and native retry semantics. This change ends at the existing JSON publication boundary. Historical data migration, a second authoring format, report or review authoring changes, and a dedicated UI subagent are outside scope.
