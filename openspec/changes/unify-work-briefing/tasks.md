# Tasks

## 1. Expose a bounded briefing to Abra

- [x] 1.1 Define a typed briefing result in `packages/contracts` and implement one projection in runtime visibility. Reuse fleet and attention classification, dependency readiness, retained research and delivery receipts, and GitHub inbox coverage. Include source identities, observation times, truncation and usable evidence targets. Test an off-page decision, a completed research report, a gated dependency, partial coverage and a quiet fleet. A PR URL by itself must never imply merge readiness.
- [x] 1.2 Expose the projection as a central, read-only `abra_work_briefing` tool. Default to tracked or followed work and support an explicitly broader GitHub scope using existing inbox reads. Verify authorization, bounds, stable item identities across unchanged reads and no work or approval mutations in a disposable fixture.

## 2. Upgrade the existing recommendation in chat

- [x] 2.1 Update the Supervisor and its orchestration skill to use one recommendation procedure for focus and catch-up, including changed conversational priorities and evidence-limited answers. Document the two phrasings and explicit GitHub scope in `docs/web-workspace.md`. Exercise both against the same fixture with one decisive action and again after a changed priority. Verify that a requested private review still resolves to the discussed PR and remains idempotent.
- [x] 2.2 Connect briefing items to existing work, report and bound form readers through the normal chat presentation. Verify that the research link opens the exact result, that a changed head or settled form cannot approve stale work, and that after an answer the next available human decision can be opened. Verify that simply viewing the briefing leaves every obligation open.

## 3. Replace the local recap with navigation

- [x] 3.1 Replace the recap mounted in `apps/web/src/workspace.tsx` with a bounded Recently inspected list. Preserve the existing Work route, palette destination and usable task IDs in existing per-session browser history. Record explicit visits and resolve historical selections outside the current page. Update the workspace guide and inspector observation tests for unchanged tasks, reload, old history, empty or unavailable storage and background refresh. Assert that the former comparison panel is absent.

## 4. Verify the complete return-to-work journey

- [x] 4.1 Use the disposable verification recipe with a current merge decision, an unvisited completed investigation and independent CI work. From a fresh browser, compare focus and catch-up, open the evidence, settle the current decision through its native form and request another briefing. Confirm the changed recommendation, continued CI observation, and access to Recently inspected on desktop and phone layouts. Run focused checks while editing, then `pnpm check`, `pnpm test:all` and strict OpenSpec validation.

## Workflow follow-up

- When syncing the visibility deltas, incorporate the original recommendation and local-recap requirements from the predecessor changes before applying this change's modification and removal.
