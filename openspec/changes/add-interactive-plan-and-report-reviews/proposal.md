# Proposal

## Why

Plans and reports require users to describe choices in separate chat messages. Interactive review controls let users select features, choose a visual design and comment in context, then send an exact, version-bound revision request to Abra.

## What Changes

- Add an app-only A2UI review catalog with single choice, multiselect, visual design cards, comments and explicit submission.
- Retain review definitions, source identities, preview images and response receipts independently of immutable evidence documents.
- Publish and read reviews through a Supervisor-only native tool; discover them in conversation attachments and Plan/Reports inspection.
- Preserve drafts across presentation changes/reload and reconcile uncertain submissions without admitting another native message.
- Link follow-up reviews to submitted responses without confusing receipt acknowledgement with completed revision or approval.

## Capabilities

### New Capabilities

- `interactive-reviews`: version-bound, visual document feedback and reliable delivery to Abra.

### Modified Capabilities

- `work-visibility`: discover live reviews beside planning artifacts and source surfaces.
- `report-template`: expose live review adjuncts without changing immutable documents or offline exports.

## Impact

Shared contracts and A2UI components, native presentation storage/tool registration, fixed authenticated RPC/HTTP routes and web review state. No additional dependencies or workflow authority. Native checkpoints, existing forms, saved report formats and offline behavior remain unchanged.

The user explicitly authorized direct Codex implementation in the current checkout as an exception to the managed controller workflow. Existing paused executions and unrelated files remain untouched; this change does not authorize merge, delivery or cleanup.
