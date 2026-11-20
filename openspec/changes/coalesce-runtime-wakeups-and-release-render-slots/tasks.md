# Tasks

## 1. Serialize monitor-triggered report recovery

- [x] 1.1 In `packages/runtime/src/recovery/monitor.ts`, replace the per-tick report fiber with a scoped `Queue.dropping<void>(1)` and one sequential consumer. Offer after a successful tick, log recovery errors per pass, and shut down the queue with the monitor. Retain the recovery scan and cross-process lock in `visual-reports.ts`. In `packages/runtime/tests/integration/effect.test.ts`, hold a pass open, complete several observed scheduler ticks, change the recoverable state and release the pass. Assert one active pass at peak and one follow-up that observes the new state.
- [x] 1.2 Exercise a failed pass followed by a successful wakeup, then close a monitor with an active pass and pending wakeup. Verify interruption, no follow-up after closure and rediscovery on a fresh monitor. Run `pnpm test:one packages/runtime/tests/integration/effect.test.ts` and the existing report-document publication recovery coverage.

## 2. Release diagram capacity after cleanup failure

- [x] 2.1 In `apps/report/scripts/diagram-batch.ts`, ensure each started batch decrements the active count and wakes its next FIFO waiter exactly once even when cleanup rejects. In `packages/runtime/tests/integration/diagram-preparation.test.ts`, occupy both slots with controlled renderers, queue a third distinct batch, make both active renderers reject on close, and verify the third batch renders successfully with a healthy renderer. Observe the two cleanup failures at their callers. Run the file with `pnpm test:one` to cover overflow, timeout and shared-compilation cancellation as well.

## 3. Coalesce workspace refresh signals

- [x] 3.1 In `packages/runtime/src/web/agent.ts`, replace the private refresh PubSub and its sole subscription with a scoped one-slot dropping queue. Merge pending scopes before offering, drain the merged scope per wakeup and retain the 200 ms delay. Preserve the separate event broadcast, subscription-before-baseline ordering and five-second fallback. Run `pnpm test:one packages/runtime/tests/fast/web-agent.test.ts`. Verify that distinct off-page issue hints arriving during a blocked read survive in the follow-up, and that two subscribed clients receive the resulting observation. Extend existing cases where needed.
- [x] 3.2 Check compatibility with `add-github-work-inbox` using its existing inbox and web-coherence coverage. Verify that idle workspace fallback observations cause zero forge inventory calls with the inbox unmounted or hidden, and that explicit or visible inbox reads still use the dedicated cached read path.

## 4. Verify integration

- [x] 4.1 Run `pnpm check` and `pnpm test:all` with the combined implementation. Verify strict OpenSpec validation for this change.
