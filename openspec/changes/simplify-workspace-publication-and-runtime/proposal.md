# Proposal

## Why

An interrupted generated-surface publication can expose a current revision before its chat attachment exists. Routine workspace refreshes, report exports and narrowly scoped tests also repeat work that can be done once at a better point in their lifecycle.

## What Changes

- Publish each generated surface through one committed revision. Lists, exact reads, chat attachments and snapshot saves use that revision while the next publication is pending.
- Read the requested receipt, surface, presentation and project sections through one gateway call per workspace refresh. Validate the central Abra session once for that call. Preserve the existing scoped refresh, fallback and action checks.
- Give storage and checkpoint unit tests the smallest valid execution, receipt and Git evidence each case exercises. Keep lifecycle journeys that prove how that evidence is produced.
- Move the three repeated worker preparation cleanup paths into one capacity operation that releases the owned reservation and commits the idle observation together.
- **BREAKING** for source installations relying on lazy preparation. A new offline export uses the installed renderer bundle from the last successful `pnpm build` or `pnpm report:prepare`. Source edits take effect on the next successful preparation. A missing compatible bundle gives an actionable preparation message.
- **BREAKING** for snapshot saves with unavailable browser storage. Saving requires durable retention of the exact input before dispatch. Keep the snapshot open and explain how to retry. Share this small persistence rule with chat and review feedback.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `work-visibility` adds committed generated-surface visibility, bounded request-local observation of workspace sections, and durable browser request identity.
- `report-template` changes when an exporter identity becomes active and how exports use the prepared renderer.

## Impact

The change touches the native web gateway, browser workspace, surface publication and presentation associations, workflow capacity, report build and export tooling, and targeted runtime fixtures. The fixture and capacity refactors implement existing continuous-integration and execution-coordination requirements. SQLite work, OpenSpec planning and OpenCode session ownership continue through their existing interfaces.

## Scope and Choices

Use the interactive-review committed-head pattern for surfaces. Validate supported old heads and latest-only records using the evidence their format actually retained. Reuse authorization only within a single read request. Keep domain-specific transports, response matching and failure handling in chat, review and report saving.

Prepare the HTML shell, executable diagram preparation code and its resolved rendering assets, and required notices under one immutable exporter identity. Each export pins a complete bundle for its lifetime. Existing HTML receipts, original destinations and canonical JSON must remain readable. This explicitly revises the existing `report-template` first-export preparation scenario and the lazy source-install behavior in `docs/reports.md`. The surface work extends the existing interactive-review and generated-binding changes to layouts.

Prior audit evidence gives comparison points. One association-write failure left revision 1 readable with zero attachments. A full workspace refresh invokes four gateway guards for these four sections. A local renderer manifest listed 7,435 inputs and 168 links, and three verification passes took 569–662 ms each. Seven of 32 focused tests hit the five-second timeout on one run and passed on retry with a larger timeout. Measure the affected paths on a matched implementation baseline before attributing gains.
