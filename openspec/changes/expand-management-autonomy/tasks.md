# Tasks

Planning only: do not apply automatically. The operator explicitly stopped expansion on 2026-10-18. The parent checkpoint has unresolved native acceptance failures. Re-audit this inherited plan and split it further if needed before implementation.

## 1. Prerequisite and design review

- [ ] 1.1 Obtain independent review and clean frozen-source native regression and repeated fault/cleanup evidence for `harden-operational-maturity`, including lead-decision routing and report/capacity intermittence.
- [ ] 1.2 Re-audit grant needs against existing controller authorization, intake transactions and capacity controls; confirm the smallest versioned design and explicit acceptance scope before coding.

## 2. Explicit bounded lead delegation

- [ ] 2.1 Add controller-owned grants with lead/revision/repository/kind/workflow binding, finite total/active limits, expiry, scheduling permission and unchanged human approvals; test deny-first legacy and stale/disabled/expired authority.
- [ ] 2.2 Commit delegated batches, dependencies, provenance and total usage atomically in the existing SQLite graph; prove last-budget races and commit-before-receipt idempotence.
- [ ] 2.3 Enforce active-task limits in central claims and preserve global/repository fairness, readiness, model capture and human plan/merge gates.
- [ ] 2.4 Expose grant status and usage through existing read-only lead/task projections and document bounded examples without unsupported YAML.

## 3. Lifecycle and recovery

- [ ] 3.1 Implement revoke-first scope/model/session/disable ordering; test idle, active, pending proposal, queued message, committed batch, running work and human approval windows without deleting authorized tasks.
- [ ] 3.2 Verify registration/session/notification/parent restart and response-loss recovery with immutable identities and finite management budgets; prohibit recursive leads and mutual wake loops.
- [ ] 3.3 Exercise a disposable delegated-lead native scenario, preserving task ownership and approval gates through restart and cleanup.

## 4. Quiet supervision and maintenance

- [ ] 4.1 Classify silent/digest/immediate observations deterministically, then implement one bounded source-identity digest with restart/partial-commit proof; never hide or resolve human decisions.
- [ ] 4.2 Verify posture transitions, unchanged-state zero-turn behavior and actual coalescing counts under finite source budgets and management capacity.
- [ ] 4.3 Complete measured lock-order, long-report/scheduler concurrency and retention-pressure review; remove only demonstrated duplicate ownership/logic and retain unresolved identities.
- [ ] 4.4 Refresh consistent complexity/state/dependency metrics and explain concrete responsibility/failure-path improvements.

## 5. Operational assessment

- [ ] 5.1 Repeat the full backend-maintenance scenario with actual delegated intake, findings, omitted reply, escalation, retained human decision, restart, Review, report and cleanup postconditions.
- [ ] 5.2 Record actual intervention/turn/latency/resource evidence with unavailable tokens/cost left unknown. Run real-provider or Firstmate comparisons only after separate operator authorization; otherwise explicitly record not run.
- [ ] 5.3 Review all authority/crash/cleanup/UI boundaries independently and run the relevant repository gates and strict OpenSpec validation. Do not claim parity or production readiness from deterministic fixtures alone.
