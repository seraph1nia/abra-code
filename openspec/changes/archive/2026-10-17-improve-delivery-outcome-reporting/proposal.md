# Proposal

## Why

Abra can show a failed approval tool after saving approval or completing a merge, then describe a contended execution as awaiting merge while background reconciliation is progressing. Verified delivery can subsequently be obscured by a generic cleanup error or `recovery_required` state, leaving users without the retained paths or a clear next action.

## What Changes

- **BREAKING behavior for synchronous callers:** merge approval collection reports its durable receipt without running merge and cleanup inline. Retain automatic advancement through deterministic reconciliation; callers must observe delivery separately.
- Report contention for approval and finish as a bounded successful `operation_in_progress` observation, without inferring another server, duplicating mutations, or claiming the requested action ran.
- Expose independently evidenced approval, delivery, cleanup and closure states, with observation freshness and concrete next actions, through Supervisor tools and native ticket views.
- Keep ordinary post-preservation file blockers in `cleaning`; retain bounded structured paths, effective cleanup policy and recovery guidance instead of escalating them to unsafe recovery.
- Preserve native failures for rejected authorization, stale inputs, unsafe ownership and uncertain external effects. Preserve existing exact-content approvals, non-force retirement, and closure-after-retirement gates.
- Add regression coverage for approval/reconciliation races, merge-success/cleanup-blocked outcomes, restart, bounded diagnostics, and cleanup-only retry.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `execution-coordination`: Classify approval/finish contention as a routine observation, decouple merge approval collection from finalization, and retain ordinary cleanup blockers without unsafe recovery escalation.
- `safe-retirement`: Retain actionable bounded cleanup diagnostics and resume cleanup after explicit file disposition without repeating merge or broadening deletion authority.
- `work-visibility`: Present approval, delivery, cleanup and issue closure separately, including observed freshness and structured tool outcomes that cannot imply an unexecuted action succeeded.

## Impact

Controller paths in `src/workflow/advancement.ts`, `authorization.ts`, `finalization.ts` and `operations.ts`; retirement inspection in `src/git/workspaces.ts`; additive retained contracts, native tool outputs and read-only ticket projections; related native presentation and Supervisor guidance. Existing tool names, inputs, execution fields and form identifiers remain available; merge approval no longer waits for inline finalization. No new remote integration or automatic deletion permission is introduced. Implementation must update affected fixtures and run `pnpm check`, `pnpm test` and `pnpm test:e2e` using temporary repositories only.
