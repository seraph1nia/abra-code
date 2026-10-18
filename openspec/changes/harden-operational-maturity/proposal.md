# Proposal

## Why

AbraCode needs reliable native messaging and understandable fleet operation. This change is explicitly narrowed by the operator on 2026-10-18 to checkpoint implemented reliability fixes and visibility improvements; it does not claim complete operational acceptance.

## What Changes

- Preserve exact message identities, historical replies and controller authorization across ambiguous native observations and restart.
- Permit one durable, response-only reminder within existing diagnostic and capacity limits; retain one actionable escalation when the required reply remains missing.
- Remove recurring native inspection of resolved historical communication and reuse observations within one reconciliation tick.
- Add an opt-in isolated operational runner, resource accounting, redacted evidence and benchmark/comparison recipes.
- Expose fleet counts, attention navigation, scoped leads and paginated communication in native Work. Update onboarding, configuration and recovery guidance.
- Stop expansion here. Project-lead grants, delegated task intake, cross-task outcome digests and remaining P2 work move to [expand-management-autonomy](../expand-management-autonomy/proposal.md), which is not applied.

## Capabilities

### New Capabilities

- `operational-verification`: Isolated bounded lifecycle/fault/performance evidence and explicitly optional provider/comparison recipes.

### Modified Capabilities

- `agent-messaging`: Durable identities, finite missing-reply recovery and active-only reconciliation.
- `native-supervision`: Explicit finite accounting for automatic communication turns and durable escalation.
- `work-visibility`: Read-only fleet, lead and communication inspection.
- `project-leads`: Shared correlated response recovery and retained historical outcomes within existing proposal-only authority.

## Impact

Existing Messages, Attention, Leads, Runtime, guards, SQLite graph queries and native visibility own these changes. Optional request metadata records one recovery slot and lead escalation receipt. One index accelerates existing completion events; there is no new table, grant, service, scheduler or dependency. Human approval, captured models, independent Review and safe delivery remain controller-owned.

[checkpoint.md](checkpoint.md) records actual checks and unresolved failures. The full acceptance gate remains open; this checkpoint must not be described as production-ready or archived as fully verified. Original planning is preserved in the follow-up's `original-scope/` directory.
