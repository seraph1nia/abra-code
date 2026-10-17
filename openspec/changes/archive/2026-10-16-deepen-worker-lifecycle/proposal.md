# Proposal

## Why

Worker admission is implemented in `WorkerSessions`, while observation, uncertain admission recovery, capacity release and stop confirmation are spread through `Advancement`. Keeping both halves of a native worker turn behind one interface will reduce the places that must understand session and prompt identity, improving locality without weakening OpenCrew's durable execution guarantees.

## What Changes

- Deepen the existing `WorkerSessions` module to own native worker admission, outcome observation, recovery of retained session/prompt identities and confirmed stopping for Explore, Apply, Review and Research.
- Replace worker-specific native state handling in `Advancement.checkpoint`, `reconcileOne` and pause handling with calls through that module; share stop confirmation between foreground pause and restart reconciliation.
- Keep role selection, planning and verification gates, explicit retry/resume authorization, phase changes and issue status updates in the controller. Preserve the different behavior of explicit advancement and background reconciliation.
- Preserve existing capacity limits, reservation semantics, model selection, public controller commands, native adapter contracts and versioned execution records.
- Verify behavior through existing controller scenarios, adding focused coverage only where the moved lifecycle decisions lack protection; update architecture and recovery documentation to reflect the final ownership.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a behavior-preserving refactor of requirements already described by `execution-coordination`, `native-supervision` and `work-policies`. The change declares `skip_specs: true`; no delta specs are needed.

## Impact

- Primary implementation: `src/workflow/sessions.ts` and the worker-related portions of `src/workflow/advancement.ts`.
- Supporting integration: existing `Capacity`, `Operations`, `Coordination`, `Records`, worker diagnostics and the native `Runtime` interface; these remain authoritative for their current concerns.
- Validation: controller fixtures and lifecycle, coordination, capacity, policy and restart tests, followed by `pnpm check`, `pnpm test` and `pnpm test:e2e` against disposable repositories.
- Documentation: `docs/architecture.md` and `docs/recovery.md` as needed to explain module ownership and retained admission versus a new worker turn.
- No new dependencies, database or record-schema migration, workflow engine, policy redesign, delivery changes or implementation of the other architecture-review candidates. Existing policy snapshots and historical records remain readable without rewriting them.
