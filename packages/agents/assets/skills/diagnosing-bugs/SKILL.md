---
name: diagnosing-bugs
description: Diagnose a difficult in-scope bug with a bounded symptom-specific reproduction, falsifiable predictions and an original-scenario recheck.
license: MIT
---

# Diagnose with an observable feedback loop

Apply uses this for a difficult bug or performance regression within accepted scope. Read the reported symptom, contract and relevant repository vocabulary. Choose a bounded attempt/time budget appropriate to the task; existing controller correction limits still apply. Do not run an investigation indefinitely or reset its budget.

1. Establish one runnable reproduction that reaches the actual failing behavior and asserts the reported symptom. Prefer a repository test; otherwise use its CLI, isolated HTTP/browser instance, or a small scoped harness. Record the exact invocation, fixture/input, expected result and observed failure. Redact secrets and keep credentials out of captured output.
2. Narrow the case one variable at a time while keeping the same failure. Pin time, randomness or inputs where appropriate. For intermittent failures record attempts, seed/load and failure rate; inability to reproduce is not a successful diagnosis.
3. State falsifiable hypotheses and predictions. For example: if retained requirements are being expanded on restart, a captured pre-upgrade prompt with only old skills available will fail before provider work. Test competing explanations where useful rather than inventing a mandatory count.
4. Probe the prediction using permitted Apply shell/edit tools in the assigned worktree. Tag any temporary instrumentation uniquely and change one variable at a time. For performance, measure the baseline and changed case. No production instrumentation is authorized by this skill.
5. Preserve a regression at an interface that can express the real bug when appropriate. Run it against the failure and fix, then rerun the original, unminimized invocation. A green shallow proxy does not establish that the reported symptom is fixed.
6. Remove only your own scoped temporary instrumentation/resources, retain useful proof, and report the invocation, cause supported by observations, original-scenario result and remaining limitations through existing worker progress/reporting.

If prerequisites or proof are unavailable after bounded attempts, report what was tried and the concrete missing condition through `abra_worker_question` or `abra_worker_wait`; do not claim a proven cause or fix. If a finding conflicts with accepted scope, cite both sources and stop dependent work. Explore and Review may assess the reproduction read-only; their browser-only shell allowance does not permit running development commands. Controller checks and independent Review still determine advancement.

Adapted from Matt Pocock's diagnosing-bugs (MIT, Copyright (c) 2026 Matt Pocock). Full notice is retained in the AbraCode distribution at `licenses/aihero-skills.txt`. No upstream harness or helper is required.
