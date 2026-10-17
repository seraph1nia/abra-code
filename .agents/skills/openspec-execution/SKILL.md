---
name: openspec-execution
description: Execute an assigned AbraCode full-spec, research or lightweight issue using its policy-specific contract and controller gates.
---

Work only in the issue's assigned worktree. Abra is the only user conversation; report questions and results through your existing worker tools. Direct worker prompts are refused unless they match the retained controller assignment. Do not ask users to open a worker chat. Read its AGENTS.md and relevant project skills. Follow the policy named in the prompt. Research and lightweight use the retained short contract; Research submits abra_research_report read-only, while lightweight uses Apply, configured checks and independent Review without OpenSpec artifacts.

For full-openspec, use `abra_spec` with `action: status` to discover the configured schema, then `action: instructions` and `artifact` for each next artifact. Artifact IDs come from actual status output, not a fixed list.

Explore writes planning artifacts under `openspec/changes/<assigned-change>/`. The controller requires every configured planning artifact to be complete, strict validation to pass, and a tracked task checklist. Apply begins only after the recorded approval gate, uses `abra_spec` with `action: apply`, and updates actual task checkboxes as work is completed. Preserve approved planning contents.

Review inspects implementation read-only and submits `abra_review_report` with `passed` and `findings`. For full OpenSpec, follow the Review verification guidance below and include `spec_verification`; this is part of the existing independent Review, not another implementation or archive phase. The controller runs verification, archives OpenSpec into canonical specifications, commits and delivers. Any missing prerequisite, unfinished task, failed check or failed review blocks advancement. Explain unresolved requirements instead of declaring completion.

For an unresolved scope question, call `abra_worker_question` with a stable `key`, the prompt's control `generation`, `scope`, `question` and answer `owner` (`user` or `supervisor`). Retry the same input after an uncertain response. Report meaningful activity through `abra_worker_progress`; declare a bounded dependency/decision/controller-command wait with `abra_worker_wait`. Do not turn a question answer into plan/merge authorization. Questions remain visible until explicitly resolved; include unresolved questions when finishing a turn.

On failed Review, include `scope_status` (`in_scope`, `scope_change`, `uncertain`) in abra_review_report. Only classify in_scope when the fix is covered by the accepted requirements. A configured finite repair budget may admit a new Apply turn; missing/uncertain scope requires a decision. Full-spec postarchive corrections get a separate revision change and fresh configured plan approval. Never edit a previous archive or reuse its checklist as a new plan. Research/lightweight assignments use their retained short contract instead of abra_spec; Research submits abra_research_report, lightweight retains checks and independent Review.

Review, CI and skills supply evidence and guidance, not permission to revise approved requirements. When they conflict, identify the sources and expected behaviors, preserve the plan and raise a decision. A confirmed implementation defect is fixed within scope. A confirmed obsolete test or instruction may be corrected within scope when the accepted requirements already establish the intended behavior; do not disable gates to obtain a pass. Changed requirements return through Supervisor-controlled replanning and configured approval, or a revised short contract. A decision answer alone never authorizes a new plan or merge.

All worker roles can load `abra-browser` for website interaction and application behavior checks. Explore, Review and Research have only the agent-browser shell exception; repository edit scope and controller checkpoints remain unchanged. Apply retains its development shell.

## Review verification

Use during the assigned full-openspec Review session. This adapts OpenSpec's
`verify-change` completeness, correctness and coherence review to AbraCode's
existing independent Review gate. Review stays read-only; the controller owns
checks, archival, delivery and authorization.

Read the assigned change's available artifacts using the configured schema and
paths, implementation, nearby tests, relevant repository instructions and retained
check evidence. Do not infer completion from checked task boxes or passing CI alone.
Shell commands are limited to agent-browser for relevant browser checks; load abra-browser and use the assigned browser name and scratch screenshot directory. Do not invoke apply, update, sync or archive workflows.

Submit `abra_review_report` with `spec_verification`:

- `completeness`: map tracked tasks and requirements to concrete implementation
  references. Check removed behavior is absent and renamed requirements retain
  behavior; do not demand implementation of a removed requirement.
- `correctness`: assess required behavior and scenarios against code and available
  test/check evidence. Disclose untested or unreadable applicable evidence.
- `coherence`: assess adherence to the accepted design and relevant repository
  conventions. Identify contradictions between artifacts, instructions, review
  recommendations and CI expectations.
- `conflicts`: unresolved contradictions, each with at least two `sources` (artifact,
  requirement, code/test location, skill section or check identity) and a `summary`
  explaining the incompatible expectations and decision needed. Use `[]` when none.

Each dimension contains `status` (`passed`, `failed`, `not_verified`, or
`not_applicable`) and nonblank `evidence` with concrete references or the reason
it is unavailable/inapplicable. Respect schema-defined omissions, `skip_specs`
and optional design artifacts. A dimension can pass when all applicable checks
pass; explain any inapplicable subchecks. Use `not_applicable` only when no check
in that dimension applies. Missing applicable evidence is `not_verified`.

In `findings`, distinguish CRITICAL defects, WARNING risks and SUGGESTION
improvements with actionable references. Suggestions alone do not fail Review;
do not invent stylistic requirements. A passing result requires all applicable
dimensions verified, no blocking defects and no unresolved conflicts. Full-spec
reports without this evidence are rejected by the controller. Lightweight Review
uses its short contract and does not require OpenSpec artifacts or this scorecard.

### Resolve disagreement without moving the target

| Finding                                                                                                  | Disposition and next action                                                                                                                      |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Implementation fails an unambiguous accepted requirement                                                 | Fail with `in_scope`; bounded repair may fix implementation, then checks and independent Review rerun.                                           |
| A test or instruction demonstrably retains obsolete behavior already superseded by accepted requirements | Explain the evidence and fail with `in_scope` for the bounded correction. Preserve meaningful checks and the approved plan.                      |
| A review suggestion expresses a preference without a requirement violation                               | Record a SUGGESTION; it does not automatically expand this change.                                                                               |
| Requirements, CI, skills or review recommendations conflict and the intended behavior is unresolved      | Record both sources in `conflicts`, fail with `uncertain` (or `scope_change` when changed requirements are established), and request a decision. |

An unresolved conflict cannot be labeled `in_scope` to admit automatic repair;
the controller retains it as uncertain. The Supervisor resolves the decision
before requesting further correction. If accepted behavior remains unchanged,
explicit retry preserves the approved plan. If requirements change, full-spec
work returns through `replan` and configured fresh plan approval; lightweight
work uses `abra_work_scope`. After archival, full-spec correction uses a new
revision change and preserves the old archive. Do not rewrite plans to match
implementation, weaken CI policy, mark conflicts resolved without evidence, or
treat a decision answer as checkpoint authorization.
