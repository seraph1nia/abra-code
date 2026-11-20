# Proposal

## Why

Each successful monitor tick can start a report-recovery scan while the previous scan is still reading execution records. Diagram preparation can also lose both render slots after two browser cleanup failures, leaving the next valid batch to time out.

## What Changes

- Give each central monitor one scoped report-recovery worker and a one-slot Effect Queue for wakeups. A successful reconciliation and scheduler tick requests a scan. Ticks during a scan reserve one follow-up and the scheduler can continue immediately.
- Use a one-slot Effect Queue for the workspace feed’s single refresh consumer. Merge change scopes before signaling and keep the outgoing feed on PubSub so every subscribed client sees updates.
- Release a diagram batch’s active slot and wake the next waiter even when renderer cleanup rejects. Keep the existing two active batches, eight waiting batches, caller deadlines and shared compilations.

## Capabilities

### New Capabilities

### Modified Capabilities

- `native-supervision` gains a bound on concurrent and pending monitor-triggered report recovery and defines how the monitor recovers after a failed scan.

## Impact

The implementation touches `packages/runtime/src/recovery/monitor.ts`, `packages/runtime/src/web/agent.ts` and `apps/report/scripts/diagram-batch.ts`. The feed cleanup implements the existing `work-visibility` requirement for scoped refresh. The renderer fix fulfills the released-capacity requirement in the implemented `enable-mermaid-rich-reports-and-dashboards` change. Both use their existing public interfaces.

## Scope and Choices

The report queue carries a wakeup. On each take, the worker reads durable execution records through `reconcileReports()`. The existing cross-process recovery lock, one-item recovery pass and periodic reconciliation continue to govern actual report work. Catch a domain failure inside each pass so the next wakeup can run. Scope closure interrupts the worker.

The in-progress `add-github-work-inbox` implementation registers dedicated inbox RPCs and backend reads. Its inventory owner shares in-flight reads by stream and limits forge concurrency. The browser requests inventory while the inbox is visible. Keep that demand path independent of workspace wakeups and fallback observations. The feed’s 200 ms coalescing delay, five-second fallback and client broadcast already serve the workspace contract.

In `DiagramBatch.prepare`, put slot release and FIFO waiter notification in an inner `finally` around cleanup. The existing caller-visible cleanup failure can propagate after the slot is released. This targeted fix leaves the renderer’s admission mechanism, timeout handling and cancellation semantics in place.
