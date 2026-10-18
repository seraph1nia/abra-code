# Proposal

## Why

AbraCode already owns durable workflows, capacity, scheduling, obligations and guarded delivery, but users still lack a reliable correlated conversation with managed workers and an ergonomic way to coordinate multiple goals. Extend these foundations using pinned OpenCode v2 mechanics so Abra can supervise parallel work with less routine human coordination and produce portable reports without another orchestration stack.

## What Changes

- Establish a native steering correctness gate before messaging: reproduce the assignment-ID/payload guard mismatch on the real server, then retain and authorize each distinct controller prompt intent without weakening worker guards.
- Add controller-mediated queue/steer requests, explicit worker acknowledgement/reply, stable correlation, bounded inspection and restart reconciliation. Reuse existing questions, waits and attention rather than duplicating their obligations.
- Add transactional, idempotent batch intake and fair admission through the existing SQLite graph, scheduler and capacity reservations; preserve all three workflow policies and conservative upgrade defaults.
- Extend existing event-driven supervision with derived classifications, coalesced summaries and explicit operational postures bounded by existing approval and repair policies.
- Add captured per-task model selections and narrow dispatch profiles, then optional persistent repository-scoped project leads sharing the same controller, graph and communication protocol.
- Extend the existing Vite/Solid report template with example-driven primitives, validated evidence snapshots, isolated builds, immutable retained artifacts and offline feedback export. Preserve manual TSX, build-time Mermaid, licensing and native single-file HTML preview.
- Deliver dependency-ordered slices with successful/refused/restart tests and focused documentation; no worker claim, message or report can grant lifecycle authority.

## Capabilities

### New Capabilities

- `agent-messaging`: Authorized, durable and correlated communication among Abra, assigned workers and later project leads.
- `batch-work-intake`: Bounded atomic multi-task creation with stable identities, local dependencies and policy validation.
- `project-leads`: Optional persistent management sessions with one-level delegation and exact repository scope.

### Modified Capabilities

- `native-supervision`: Explicit assignment/steering prompt intents and bounded, coalesced multi-task supervision.
- `execution-coordination`: Fair configurable automatic admission and capacity-safe message turns through existing reconciliation.
- `application-configuration`: Operational postures and snapshotted task/profile model resolution without silent fallback.
- `work-visibility`: Bounded request/reply and aggregate supervision views derived from authoritative evidence.
- `report-template`: Reusable authoring, validated snapshots and independently retained concurrent report builds.

## Impact

Reuse `workflow/{controller,advancement,sessions,worker-context,obligations,attention,capacity}`, `scheduler/scheduler`, `recovery/monitor`, `work/{intake,graph,model}`, `storage/{store,contracts}`, `opencode/{runtime,application,client,guards,role-policy,tools,tool-definition}`, configuration and native visibility. Introduce only cohesive missing message contracts/coordinator and narrowly scoped lead/report ownership code. Extend the deterministic provider/disposable-server harness and existing reporter browser tests.

Keep OpenCode packages pinned at 2.0.28, TypeScript/Effect Schema, SQLite, OpenSpec, pnpm, Vite+ and SolidJS. No alternative harness, new daemon/database/scheduler, recursive management hierarchy, external report platform or Lavish integration is included. Preserve the documented same-user trust boundary; native permissions and worktrees are not OS sandboxes.

The checkout has uncommitted delivery/recovery work and `complete-work-reliably` planning. This proposal preserves it and requires reconciliation of overlapping contracts before applying affected slices; it does not assert those changes are implemented or verified. This invocation creates planning artifacts only; native defect confirmation and all implementation/check results remain pending.
