# Reproducible Firstmate comparison

Use Firstmate as a behavioral reference for one liaison coordinating a visible
crew. Its documented architecture and runtime choices are separate from
AbraCode's single OpenCode controller. The reference inspected on 2026-10-18 is
[Firstmate at 1aa2a21](https://github.com/kunchenguid/firstmate/tree/1aa2a21ec35e2d0644ac836b7b5d3cb36669ef33).
Reading that documentation is not a Firstmate execution or a parity result.

Run paired experiments only with explicit operator authorization for the selected
models, credentials, budget and isolated installations. Do not install a harness,
start a paid provider, contact production task repositories or push user remotes
as an implicit part of this protocol. Start with the
[deterministic operational recipe](operational.md); its results prove controller
mechanics and do not substitute for this comparison.

## Freeze the experiment

For each implementation record the complete commit SHA, any uncommitted patch
and source-content fingerprint, runtime/harness version, OS/hardware, model IDs
and revisions where exposed, model settings, installed tool/skill inventory,
workflow policy, authority/approval settings and concurrency limits. Pin the actual
Firstmate checkout rather than relying on `main` or the reference above remaining
current. Record the exact tested AbraCode content; a HEAD SHA cannot identify a
dirty implementation.

Use one disposable seed repository and local bare remote per paired trial. Store
the initial Git tree SHA, literal goal text, issue/dependency graph, oracle test
commands and allowed paths in an external manifest. Reset from the seed for every
trial. Use the same model capability and task concurrency where possible; record
unsupported model IDs, tool differences or policy adaptations explicitly. Never
disable AbraCode's independent Review, plan fingerprints, current-content checks
or human gates to obtain a faster comparison.

Before introducing real model judgment, replay these existing deterministic goals
and assertions from the pinned AbraCode source as mechanics calibration:

| Scenario                 | Goal and controlled trigger                                                                                                                                            | Observable acceptance                                                                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: parallel development  | Three independent consumer fixes with capacity two; one retained human plan gate. Use `acceptance.ts`'s task/consumer contracts.                                       | Three correct delivered outputs; independent work continues while approval waits; one owner per task; tests and independent Review recorded.                                                                        |
| B: cross-worker research | Route a retained research finding to the implementation worker while its assignment continues. Use the accepted finding/source base and request ID in `acceptance.ts`. | Exact intended recipient; explicit acknowledgement; source evidence preserved; no scope/approval expansion or extra relay task.                                                                                     |
| C: omitted reply         | Complete an admitted turn with one missing answer and one missing acknowledgement, as in `reply-recovery.ts`.                                                          | One reminder per original ID; correlated answer or one escalation; queued/busy/unknown states do not cause speculative prompts; exact admission counts.                                                             |
| D: interruption          | Declare the fault before/after native admission and after parent-notice commit, as in `crash-windows.ts`; also interrupt a queued/running assignment.                  | Stable IDs, no independent duplicate instruction or notice, no lost accepted answer, correct retained uncertainty and explicit recovery action.                                                                     |
| E: scoped management     | Give a lead a finite repository/workflow/task/active/expiry grant, with human merge retained.                                                                          | Only eligible tasks admitted atomically within the grant; no self-grant or human approval; revocation prevents future mutation while admitted work remains owned. This scenario requires implemented grant support. |
| F: visual report         | Request the investigation/architecture report from the same retained source evidence. Use `reports.ts`'s static artifact and restart assertions.                       | Accurate evidence references; readable diagram; portable offline HTML; one verified artifact across publication/receipt loss; safe opening and navigation.                                                          |

The sample-code calibration is deliberately small. For practical usefulness add a
shared backend maintenance repository with an actual intermittent-test
reproduction, API error-contract tests and authentication regression vectors.
Freeze every input, expected output and independent consumer check before either
agent sees it. Retain the reproduction seed/schedule so a model cannot pass a
flaky test accidentally. Both implementations receive the same literal goal and
acceptance oracle. A report saying work is complete is not that oracle.

## Repeat and measure

Predeclare five paired trials per scenario/model configuration, alternating run
order and assigning the same trial seeds. Retain every failed, interrupted or
budget-exhausted trial. Do not select only successful runs or stop early when one
system looks better. Treat this as a small exploratory sample; a stronger claim
needs a separately justified sample size and uncertainty analysis.

Start elapsed time at authorized goal submission and stop only after accepted
output and required approvals/delivery/cleanup. Record queue time and active time
separately where observable. Count actual human interventions from the action
log: clarification, repair/resume, approval and manual relay are different kinds.
Report mandatory approvals separately from avoidable coordination. Count model
requests, native turns, tools and notification/digest turns as distinct measures.
Use only attributable provider-reported token usage; missing or incomparable
usage/cost remains unknown. Do not convert prompt counts into invented tokens.

For each trial retain completion rate, oracle failures, intervention kinds,
admissions/duplicates, response recovery/escalation, scheduling fairness/waits,
decision delay, completion-notification latency, elapsed time, memory/CPU,
retained state and residual resources. Identify the scope and unavailable status
of each metric. A timeout or absent cleanup receipt is a failed trial, not a
successful result with missing data.

Use a separate read-only reviewer for output correctness. For report/UI quality,
use a predefined rubric: evidence accuracy, clarity, diagram readability, offline
portability and time to find a decision/session/report. Preserve the reviewer
instructions and scores. Hide implementation labels where practical; record when
workflow differences make blinding impossible.

## Interpret the result

Report deterministic correctness, model judgment, token efficiency, UX and
operational reliability separately. Present per-trial outcomes plus medians,
ranges and failure counts, with model/policy differences alongside them. Do not
aggregate away an authority failure behind faster task timing. A single success,
a documentation inspection or mocked fixture pass cannot establish parity or
superiority.

Exclude multi-harness portability, remote-host management and Firstmate's runtime
infrastructure from the core OpenCode-only score. They are intentional AbraCode
non-goals. Missing reliable communication, useful scoped delegation, low human
coordination burden or correct delivery are practical gaps and must remain visible.
Do not port runtime infrastructure to improve a comparison score.

No paired Firstmate or real-provider trial has been run by this procedure yet.
Mark scenarios not run or incomparable explicitly, including grant-dependent
scenario E until its current implementation and verification exist.
