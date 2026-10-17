# Proposal

## Why

A merged PR can leave its ticket open behind retained files and an exhausted stall incident without presenting the user with the decision needed to finish. Local changes after publication also stop at a generic delivery-changed error instead of returning through verification and publication, so completion needs a controller-owned path from current work to verified closure.

## What Changes

- Reconcile pending, attributable changes within accepted scope through verification, independent Review and publication to the same open PR. Require matching local, reviewed and remote content before merge, invalidate old merge authorization when the commit changes, and preserve existing planning, repair and external-custody gates.
- Add read-only cleanup preflight before requesting merge approval and repeat it before merge. Resolve unexpected residue through a concrete retained decision in Abra; keep already authorized generated output for disposal after preservation.
- Support native, execution-specific authorization of exact generated directories without changing project defaults or treating ignore rules as deletion permission. Other retained files require explicit inclusion in delivery or verified disposition before proceeding.
- Continue eligible finishing automatically through preservation, authorized disposal, native retirement and work-graph closure, including restart and cleanup-only continuation. Reconcile externally merged PRs without attempting another merge or pushing late edits into a merged PR.
- Route mandatory finishing decisions independently of optional diagnostic-turn budgets. Revalidate and supersede obsolete stall incidents so current finishing work is not mislabeled exhausted.
- Extend shared tool/native outcomes with current synchronization, preflight and decision evidence, retaining separately evidenced approval, delivery, cleanup and closure.
- Cover late edits, approval races, generated residue, exhausted attention, remote drift, pause, lost responses and restart using temporary repositories and a fake forge.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `delivery-evidence`: Reconcile local publication drift and require current synchronized content plus cleanup preflight on every merge route.
- `safe-retirement`: Inspect cleanup readiness before merge and retain narrow execution-specific generated-directory authorization through safe retirement.
- `native-supervision`: Deliver mandatory finishing decisions despite exhausted diagnostics and retire attention whose underlying condition is resolved.
- `execution-coordination`: Resume synchronization and finalization deterministically from retained checkpoints, with bounded admission and no repeated external effects.
- `work-visibility`: Show current finishing stage and actionable decision instead of obsolete stall/exhaustion labels.

## Impact

This follow-up depends on the contracts and behavior of `improve-delivery-outcome-reporting`; it does not rewrite that nearly implemented change. Expected implementation areas are workflow advancement/finalization/checks/corrections/obligations/attention, Git delivery and retirement adapters, retained schemas and operation receipts, native tool/form contracts, shared visibility projections, and orchestration/recovery documentation. Existing tool inputs and policy defaults remain compatible; merge becomes additionally gated on cleanup readiness. No new service, force push, broad cleanup command, arbitrary file archive, or retrospective mutation of the screenshot's ticket is included. Implementation must run `pnpm check`, `pnpm test`, and `pnpm test:e2e`; tests must never push to user remotes.
