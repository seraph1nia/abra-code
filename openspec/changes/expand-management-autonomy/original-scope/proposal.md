# Proposal

## Why

AbraCode already has the native messaging, scheduling, supervision and project-lead primitives needed for parallel work, but their operational limits need measurable proof. A required reply currently remains visible without a dedicated bounded recovery attempt, current-assignment historical messages still trigger native inspection, and Work home does not expose the fleet and communication evidence already available to the controller.

## What Changes

- **P0:** Audit message transitions against the pinned native APIs; preserve exact admission identities, historical replies and authorization through concurrency, interruption and restart. Add one controller-authorized missing-response reminder followed by one durable escalation, with no new substantive task or unbounded model turns.
- **P0:** Benchmark reconciliation before optimization, separate resolved history from active transport/response work, and reuse observations within a tick where measured results justify it. Add an opt-in disposable operational soak runner with postconditions, resource accounting, retained failure evidence and an explicitly authorized real-provider recipe.
- **P1:** Extend the native Work surface with fleet/per-repository counts, attention navigation, lead visibility and paginated communication detail. Preserve read-only inspection, native themes/forms and Abra as the sole conversation.
- **P1:** Classify and coalesce operational updates deterministically, preserving human decisions and significant outcomes across posture changes. Update README, first-use/configuration guidance and troubleshooting to match demonstrated behavior.
- **P2, gated on P0 evidence:** Add explicit, finite, versioned controller-owned project-lead delegation for scoped research/lightweight task intake and optional central scheduling. Preserve human checkpoint ownership and existing work after revocation.
- **P2:** Exercise management crash/revocation windows, simplify demonstrated ownership/locking/retention problems, and report measured complexity and repeatable Firstmate comparison results without inferring model quality from deterministic tests.

## Capabilities

### New Capabilities

- `operational-verification`: Opt-in isolated repeated-lifecycle, fault/restart and performance evidence; privacy-conscious metrics; authorized real-provider and reproducible comparison protocols.

### Modified Capabilities

- `agent-messaging`: Precise transport/response transitions, historical acceptance, bounded missing-reply recovery and active-only reconciliation.
- `native-supervision`: Actionable communication escalation, finite reminder authority and low-noise cross-task attention with posture-safe retention.
- `work-visibility`: Native fleet, project-lead, communication and decision views derived from authoritative observations.
- `project-leads`: Explicit delegated intake/scheduling authority, transactional accounting, revocation and lifecycle recovery. This intentionally extends the present proposal-only boundary.
- `batch-work-intake`: Atomic delegated admission with retained grant provenance and idempotent budget accounting.

## Impact

Primary owners are `src/workflow/{messages,message-contracts,attention,leads,lead-contracts,sessions,obligations}.ts`, `src/opencode/{runtime,guards}.ts`, `src/work/{intake,graph}.ts`, the existing scheduler/monitor, and `src/visibility/`. Reporting remains the existing Vite/Solid implementation. Tests extend existing unit, SQLite integration and disposable native journeys; documentation and generated schema change only where implemented contracts require it.

Recovery adds minimal optional request-owned attempt metadata; delegated intake adds durable grant/provenance/accounting in the existing SQLite work graph. Existing records decode conservatively with recovery unattempted and no delegation authority. No new runtime service, scheduler, broker, database, UI framework, harness or external dependency is planned. Approval forms, independent Review, content fingerprints, captured models and safe retirement remain mandatory. Implementation is split into verifiable P0 → P1 → P2 increments; planning does not authorize paid-provider runs or deployment.
