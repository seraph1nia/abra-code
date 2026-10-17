---
name: domain-modeling
description: Clarify ambiguous domain terms and record scoped terminology or architectural decisions during an assigned change.
license: MIT
---

# Clarify the domain within the assigned scope

Use when terminology or relationships affect behavior. Read repository instructions, any glossary map, applicable glossary and architectural decisions, then compare their definitions with code and the accepted contract. Follow existing locations; a missing glossary does not authorize creating one.

- Identify overloaded words and propose one precise term for each concept. Distinguish, for example, a request from its attempts or an execution from its native sessions.
- Probe relationships with concrete cases: Can two attempts coexist? What survives a restart? Which owner may change the state? Check the answers against actual code and accepted requirements.
- For a definition, record the term, plain definition, relationships and a distinguishing example. Keep implementation details in design documentation rather than the glossary.
- Record an architectural decision only when a meaningful trade-off is hard to reverse and would surprise a future reader. Use the repository's format: context, alternatives, decision and consequences.

Explore writes proposed definitions and documentation tasks only in its assigned planning change, never a root glossary or ADR. Apply updates existing vocabulary or decisions only when accepted scope includes those edits. Review reads and assesses consistency without writing. Do not silently redefine approved requirements: report conflicting sources through `abra_worker_question` and stop dependent work until resolved. Conversational agreement or this procedure does not authorize scope changes.

Adapted from Matt Pocock's domain-modeling (MIT, Copyright (c) 2026 Matt Pocock). Full notice is retained in the AbraCode distribution at `licenses/aihero-skills.txt`. Formats above are self-contained; no upstream templates are required.
