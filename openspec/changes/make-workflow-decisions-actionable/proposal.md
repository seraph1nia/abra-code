# Give each task a page and each decision a clear next action

## Why

A person can be told to approve a plan before its form exists. Once it arrives, submitting the untouched checkbox rejects the plan. Meanwhile, a worker repair can open the previous attempt’s transcript, and reading what is planned requires opening files despite OpenSpec already supplying task rows.

## What Changes

- Opening a ticket from Work starts on a full task page. A short summary names the intended outcome, latest progress and who owes the next move. The reader has four destinations — Plan, Diff, Reports and Live session. Ask Abra brings the existing conversation alongside the evidence.
- Keep navigation quiet. _Needs you_ opens an actionable human decision and its evidence. Agent replies, routine waits and historical activity stay available in their task context.
- Have the controller deliver required plan forms when the plan is ready. Show explicit approval and revision actions, retain requested changes, and collect missing scope through ordinary labeled fields.
- Present two human artifacts. Plan shows the accepted intent and progressing steps. Report brings together outcomes, checks, independent Review, limitations and delivery evidence. A read-only session opens the exact current assignment.
- Keep agent protocol out of human feedback receipts, carry applicable decisions into fresh worker assignments, and refresh only the evidence a known event changes.

## Capabilities

### New Capabilities

### Modified Capabilities

- `execution-coordination` gains recoverable delivery of required plan decisions and explicit checkpoint responses.
- `work-policies` gains structured short-scope clarification and concise compact-plan authoring.
- `work-visibility` gains task pages, a shared human action count, evidence-linked reports, current-session selection and scoped live reads.
- `worker-context` gains explicit provenance for the decisions supplied to a fresh assignment.

## Impact

Extend the existing controller authorization, visibility, briefing and review-response paths, the shared web contracts, the worker prompt builder and the Work reader. OpenSpec remains the source for tracked full-spec tasks. Reuse native form bindings, diff selection, session history and report receipts. SQLite continues to own issue state.

## Scope and Choices

- Chat stays the default landing destination. The deliberate layout change applies to task entry from Work. Preserve chat-originated inspection, exact bookmarks, drafts, focus return and the saved split preference.
- Deliver concise authoring guidance for new compact plans. Preserve pinned schema/template digests and the detailed planning option. The human Report is a view of retained evidence that stays readable after retirement. It adds no mandatory worker document or model call.
- When syncing specs, sync the navigation requirement from `redesign-workspace-navigation-and-search` before this change’s revised desktop entry behavior. Carry forward the exact source and response bindings from interactive reviews and the action targets from the unified briefing. Review the checkpoint and compatibility changes with a human before implementation admission.
