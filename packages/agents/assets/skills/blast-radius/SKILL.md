---
name: blast-radius
description: Identify and prove the concrete safety assumptions behind a risky in-scope change, including downstream and persisted contracts.
license: MIT
---

# Prove the safety assumption beyond the diff

Use when safety depends on a concrete fact outside the edited lines: old persisted input decoding, a wire contract, retry convergence, teardown order or a downstream consumer. Scale the work to the risk; a trivial edit does not require a catalog of hypothetical failures.

1. Read the actual changed behavior and relevant consumers, pinned dependency source and accepted contract. Include current uncommitted and untracked content, not only a committed diff ending at HEAD.
2. State the one or two facts safety depends on. Example: an old saved record still decodes through the actual application decoder after adding an optional field.
3. Follow that fact through the persisted format, external caller or real runtime order. A type declaration or search without matches is source evidence, not runtime proof.
4. Apply writes/runs a small rerunnable test, script or application interaction within accepted scope using the actual decoder/path. Record the input, invocation, expected and observed result. Prefer proof exercised by configured checks so independent Review can inspect a matching receipt.
5. Report confirmed risks, checked/cleared cases and explicitly unproven assumptions separately. Cite concrete code/evidence and consequences; do not invent probabilities, callers or APIs.

Review assesses available proof read-only and reports applicable unavailable evidence through its existing report. Browser checks require an available instance and existing browser permissions; no unrelated shell is allowed. A scratch path or Apply self-report alone is not accessible proof. Out-of-scope risks are questions or follow-up recommendations, not new implementation tasks. Use `abra_worker_question` for conflicting accepted requirements and stop dependent work. This guidance changes no correction limit, tool ceiling or controller gate.

Adapted from Lauren Tan's pstack blast-radius (MIT, Copyright (c) 2026 Lauren Tan). Full notice is retained in the AbraCode distribution at `licenses/pstack.txt`. All steps are contained here; no upstream companion skills are required.
