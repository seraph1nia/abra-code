---
name: codebase-design
description: Reason about caller interfaces, ownership and test seams when an assigned change needs a design decision.
license: MIT
---

# Design at the caller interface

Use for an actual interface or ownership decision; a trivial edit does not need a design exercise. Read the assigned contract, relevant callers, repository terminology and existing decisions first.

A module has an interface (all facts callers must know, including ordering, errors, configuration and invariants) and an implementation. A deep module offers useful behavior through a small interface. A seam is where behavior can be substituted; an adapter satisfies the interface at that seam. Depth means caller leverage, not implementation line count.

1. Write a concrete caller example and the observable result it needs. Include failure behavior and who owns state, retries and cleanup.
2. Compare the current interface with the smallest useful alternative. Which knowledge moves out of callers? If deleting a wrapper removes complexity instead of redistributing it, reconsider the wrapper.
3. Locate the interface that reaches the real behavior in tests. Accept dependencies at an existing seam where useful; do not add hypothetical adapters or mock away the behavior being proved.
4. Check locality: can the next change be understood and verified here, or does it require coordinated edits across callers? Prefer the repository's established abstractions when they satisfy the contract.
5. Record the decision and relevant alternative in the assigned planning artifact or scoped implementation explanation. Verify caller behavior through the appropriate existing test interface.

Explore records proposals only inside its assigned change, including any documentation tasks. Apply implements only accepted scope; a better design that contradicts it requires `abra_worker_question` with both sources, then stopping dependent work. Review assesses design read-only using current implementation and evidence. Central Abra hands implementation to the assigned role. A skill supplies no extra editing, shell or lifecycle authority.

Adapted from Matt Pocock's codebase-design (MIT, Copyright (c) 2026 Matt Pocock). Full notice is retained in the AbraCode distribution at `licenses/aihero-skills.txt`. This procedure has no required companion files.
