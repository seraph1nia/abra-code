# Proposal

## Why

The review of commit `5089c89` reproduced four gaps in PR follow-through: merge can omit configured actions, job findings can duplicate one workflow rerun, name-only joins can promote advisory checks to blocking, and failed reads can strand approved actions before any write. The same change expanded the lifecycle coordinator past 1,000 lines; fixing these gaps needs clearer ownership and action models rather than more special-case branches.

## What Changes

- Derive required PR actions from snapshotted policy and current evidence once, and use the same calculation for automatic scheduling and every controller merge route. An absent required action remains pending even before the next monitor tick.
- Give action kinds explicit semantic targets. Deduplicate workflow reruns by repository, PR/head, run and source attempt, retaining all contributing finding revisions as evidence and one finite reservation per logical rerun.
- Carry canonical current-check identities, application bindings and required/advisory classifications from readiness into feedback. Remove the second name-based reconstruction; keep optional Actions detail separate from authoritative check policy.
- Separate read-only action validation, durable send admission and result reconciliation. Retry definitely unsubmitted work under its retained authority while keeping uncertain writes observation-only.
- Preserve existing action IDs, approval bindings, reply markers, history and conservative recovery for legacy records. Reflect retryable preflight failures accurately in existing tools and ticket views.
- **BREAKING for runtime rollback:** Newly admitted actions use a versioned target/submission contract. Supported old records remain readable, but a runtime that does not understand the new version must preserve it as unavailable rather than downgrade it or resend its effects.
- Move complete feedback/action operations and external capacity/custody coordination out of `Advancement`, keeping lifecycle gates in the controller. Split the oversized terminal feedback fixture without adding pass-through abstraction layers.

## Capabilities

### New Capabilities

None. This change strengthens existing delivery and contract boundaries.

### Modified Capabilities

- `delivery-evidence`: Require policy-derived PR action clearance on every merge route and preserve canonical check provenance across readiness, feedback and retry admission.
- `typed-contracts`: Specify semantic action targets, attempt-level rerun reservations, submission-stage outcomes and compatible retained-action decoding.

## Impact

- Affects `src/workflow/{advancement,pr-actions,feedback,finalization,external-validation}.ts`, action/feedback and readiness contracts, GitHub adapters, retained records, tool/observer projections and terminal action views. Add focused modules where they remove responsibilities from existing coordinators.
- Extend action, readiness, feedback, storage/recovery, controller, native-server and terminal fixtures. Update architecture, testing, supported API and recovery documentation where contracts change. Implementation acceptance requires `pnpm check`, `pnpm test`, `pnpm test:e2e` and strict OpenSpec validation, using only disposable repositories and fake external services.
- Follow-up to the implemented but unarchived `add-continuous-pr-feedback`. Add narrowly named requirements to canonical capability paths rather than replacing its pending deltas or duplicating `pr-automation`/`pr-feedback`. Preserve both changes' requirements when their specs are synchronized; this proposal does not archive either change.
- No new dependency, native integration, daemon, forge permission, automation opt-in or policy default. Existing human approval, exact-head merge, bounded correction, custody and preservation gates remain mandatory. The lifecycle and terminal fixture decomposition is implementation work, not a new behavioral capability.
