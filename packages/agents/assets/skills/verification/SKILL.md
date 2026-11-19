---
name: verification
description: Plan, execute or assess observable behavioral proof using existing repository recipes and checks within the assigned role.
license: MIT
---

# Verify the actual behavior

Use for relevant behavior changed by the assigned contract. Discover repository instructions, testing documentation and applicable local recipes/skills first. Use existing documented checks when no recipe exists. Absence of a recipe does not authorize setup, installation, new control files or a new approval workflow. Report a concrete missing runtime prerequisite if existing checks cannot exercise the applicable behavior.

A useful recipe contains:

- Preparation/launch: exact existing command, fixture/data requirements, isolated ports/state and how readiness reaches a usable instance.
- Health: a read-only observation confirming the intended instance/build, required data and access before driving it.
- Action and expected state: the real CLI/API/UI interaction and the observable result or side effect that would falsify success.
- Evidence: exact invocation, expected versus observed outcome, exit/status, meaningful state and retained artifact path, with limits and secrets removed.
- Cleanup: stop only processes/browsers and temporary state this run created. Preserve named evidence outside disposable resources and confirm it still exists after teardown. Do not remove execution sessions or worktrees.

Explore plans acceptance proof and recipe tasks only inside its assigned change. Apply may run documented development commands or start an isolated scoped fixture. Author/change a recipe only when accepted write scope includes it; follow existing harnesses and keep linked feature journeys current when changing them. A recipe is usable only after one journey runs from preparation through evidence capture and cleanup; report failures and stand-in limitations instead of weakening the expected result.

Review assesses current staged, unstaged and untracked implementation/proof against accepted scenarios and matching controller check receipts. It may use permitted browser observations on an available instance, but cannot start servers or run unrelated shell commands. Inaccessible Apply output and deleted scratch paths are unavailable evidence; progress summaries are not automatically passed to Review or retained as proof. Full-spec Review uses existing completeness/correctness/coherence statuses and conflicts; applicable missing proof is `not_verified`. Lightweight Review uses the accepted short contract and reports missing evidence there.

Availability or loading of this skill proves no behavior. Source inspection, check receipts and accessible observations are distinct evidence. Use actual values/actions, not cached screenshots or an assertion that a command ran. Leave approval and lifecycle decisions to the controller.

Adapted from Lauren Tan's pstack create-verification-skill and Prove It Works (MIT, Copyright (c) 2026 Lauren Tan). Full notice is retained in the AbraCode distribution at `licenses/pstack.txt`. This portable procedure does not require an AbraCode-specific recipe or upstream references.
