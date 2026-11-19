# Proposal

## Why

Inspecting a worker by ticket and session currently decodes every retained execution, even though the ticket lookup already supplied the evidence needed to check membership. Three smaller maintenance costs also have clear owners: repeated review RPC authorization, visual-report rules embedded in the storage writer, and a construction cycle between planning and worker admission.

## What Changes

- Make ticket-scoped worker inspection use the selected execution. Reuse the membership predicate for session-only assignment lookup.
- Consolidate the supervisor check, refusal translation and Effect context provision for the five native review RPC handlers.
- Extract visual-report history validation from the coordinated record writer and call it at the existing enforcement point.
- Simplify equivalent negated comparisons in code touched by these changes, including the later session work. Fold these edits into the owning change.
- Schedule the planning/session dependency change last, alongside the next planning or worker-admission edit. Give planning direct access to the location and idle checks it uses so the application can construct planning before admission.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `work-visibility` gains a bounded-read guarantee for worker inspection when both issue and session are supplied. The other edits implement existing contracts.

## Impact

The worker RPC in `plugin/index.ts` calls `Queries.inspectWorker`. The affected implementation lives in runtime workflow queries and worker assignment, the native web gateway, the execution store and report validation, and workflow construction in `opencode/application.ts`. The implementation uses the current storage format, dependencies, RPC schemas and controller gates.

## Scope and Choices

Deliver the first three changes as independently reviewable patches in the order above. Use storage and native call counts to verify inspection cost. Keep session-only lookup available to native hooks and distinguish read-only membership from active worker authority. Limit gateway consolidation to the five review handlers. Keep report validation inside the coordinated write. Treat the final wiring change as an independent follow-up within this checklist so the first three can land earlier.
