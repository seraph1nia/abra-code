# Proposal

## Why

A second subscriber to the same workspace feed can miss its baseline, and a malformed event can end the producer fiber while its subscriber waits indefinitely. The Effect 4.1.4 audit also reproduced failures where corrupt input becomes a defect or a missing catalog leaves a durable record implying that a provider started. [Audit and probe results](../../../docs/effect-v4-audit.md)

## What Changes

- Give each AG-UI subscription its own projection and terminal state. End a live subscription on producer failure with a bounded diagnostic. Preserve native admission identity and explicit Stop semantics.
- Keep the scoped invalidation consumer running after a transient commit-barrier failure. Merge the failed scope with pending hints and publish after a successful barrier.
- Return declared inbox read errors through native visibility RPC. Distinguish local index failure, remote availability and invalid selection, including when an error occurs while recording a failed refresh.
- Decode fetched Git commits, report receipts, embedded report data and inbox rows at their owning boundaries. Require evidence of actual absence before choosing the clone or OpenSpec creation path.
- Resolve the catalog for a new provider attempt before claiming its preparation receipt. Use the existing identity schemas and a stage-specific receipt decoder for recovery.

## Capabilities

### New Capabilities

### Modified Capabilities

- `work-visibility` specifies per-subscription delivery, terminal notification and continued publication after a transient barrier failure.
- `typed-contracts` specifies recoverable read failures for these inputs, local/remote inbox error classification and the evidence required for lifecycle absence decisions.
- `worker-context` distinguishes a missing prerequisite from an attempt whose provider may already have run.

## Impact

Changes touch the AG-UI adapter and plugin publisher, visibility RPC mapping, SQLite inbox adapter and callers, repository and OpenSpec probes, report readers, and configured worker preparation. Existing Effect, RxJS, Schema and OpenCode APIs suffice. The existing request, receipt and database formats stay compatible. The active inbox, native transport and agent-definition changes supply the features exercised here.

## Scope and Choices

This first change addresses observable failures with regression tests at their owning boundaries. Keep the existing one-slot wakeup queue, feed fan-out, controller generation checks and synchronous SQLite transaction for task creation and source linking. Catalog wiring can be explicit at assembly or on the fresh-attempt path, provided completed and legacy captures remain replayable.

The audit's monotonic timing, broader identity propagation, registry lifetime consolidation and diagram scheduler proposals are independent follow-ups. Diagram compilation already releases slots on cleanup failure and has observable overflow and shared-cancellation behavior worth preserving.
