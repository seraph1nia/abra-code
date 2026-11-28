# Review consequential proposals before implementation

## Outcome

A person deciding whether to proceed can see what an independent reader understood, which assumptions that reader challenged, and which decisions still need an answer. The review belongs to the exact proposal the reader saw.

## Scope and choices

- At intake, the Supervisor selects consequential full-spec work for review, for example a migration with a difficult rollback. A user can explicitly request it at intake. Record that choice independently of the human plan-approval setting. Earlier work and unselected changes follow their existing workflow.
- After planning and before Apply, admit a fresh read-only reviewer. Give it the proposal and a review question. It reads the proposal alone first, then may check cited project sources. Its report records its understanding, material findings with evidence, and any question requiring human judgment. An empty findings list is a valid completed review.
- Show the result in one Supervisor-published A2UI findings view using the existing catalog. Keep findings tied to their reviewed revision. Route substantive scope questions to the existing decision flow and editorial feedback to the planner. Feedback, formal approval and implementation Review retain their own meanings. Test-run evidence stays in Verification.
- If the reviewer is unavailable, show review pending. A human can retry or explicitly continue for this revision under the existing approval policy. An unresolved scope decision still waits for a human answer even when plan approval is optional.

## Acceptance

Review plan A, revise it to B, then reopen A’s dashboard. A still shows the findings for A. B has its own review status, and only the current decision can be acted on. Use the [existing whole-plan fingerprint](../../../packages/runtime/src/workflow/advancement.ts) within the execution. Even a tasks-only revision gets a fresh review. A restart with identical inputs reuses the recorded review. With the reviewer offline, automatic advancement waits for a human choice.

## Capabilities

- [work-policies](specs/work-policies/spec.md) adds the selected reviewer handoff and recovery behavior to full-spec work.
- [work-visibility](specs/work-visibility/spec.md) adds the revision-bound findings view using the [existing A2UI publication path](../../../docs/web-workspace.md#a2ui-v1-catalog) and [plan feedback controls](../../../packages/runtime/src/web/review-tool.ts).
