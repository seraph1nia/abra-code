# Proposal

## Why

Returning developers can ask Abra for one priority, inspect fleet counts, or compare changes on tasks they previously opened in this browser. They need one answer that still finds the decision or finished report that matters on a fresh device.

## What Changes

- Extend the existing next-work recommendation. “What should I focus on?” returns the leading action and its reason. “Catch me up” gives the same recommendation in context with human decisions, recent outcomes, ongoing work and the queue. Both honor the same sources, scope and conversational priorities.
- Make the result a bounded snapshot of current work. Identify the evidence behind each important item and disclose stale, missing or truncated coverage. Preserve exact follow-through to decisions, reports and GitHub items.
- **BREAKING** Remove the standalone “Since your last inspection” comparison. Keep the Work → Recently inspected route and palette entry as a device-local list for reopening tasks. Existing Attention forms remain the place to answer decisions.

## Capabilities

### New Capabilities

### Modified Capabilities

- `work-visibility` gains the unified conversational briefing and navigation-only recent history. It revises the next-action and local-recap requirements introduced in earlier changes.

## Impact

Add a typed, read-only Supervisor tool over existing work visibility, retained outcomes, dependency and GitHub inbox reads. Extend the existing orchestration skill to make one evidence-backed choice. Use existing chat tool presentation, reader targets and bound native forms for follow-through. Update the web recap component, workspace guide and current recommendation and inspector tests.

## Scope and Choices

- A fresh bounded read supplies facts and grouping. Abra ranks eligible actions using the developer's priorities. Focus and catch-up differ in answer length. Both default to tracked work and its linked GitHub evidence. An explicit broader GitHub scope is available to either phrasing.
- Current results may repeat across briefings. The feature needs no read receipt, cross-device cursor, new dashboard, scheduled delivery or personal research workflow.
- The implemented `recommend-next-work` and `add-contextual-cockpit-steering` changes still hold their original `work-visibility` deltas. Integrate those requirements before this change's delta when syncing canonical specs. Preserve the existing GitHub follow-through requirement and the Recently inspected destination from `redesign-workspace-navigation-and-search`. Cross-task notification delivery and lead grants in `expand-management-autonomy` are separate work.
