# Proposal

## Why

Abra can list local work and open GitHub items. A developer choosing where to spend the next hour needs a defensible recommendation and a way to act on it in the same conversation.

## What Changes

- Answer an explicit prioritization question with one actionable recommendation, the decisive evidence and, when meaningful, why another candidate can wait.
- Reassess that choice when the developer challenges an assumption. Treat a changed deadline as conversational context until the developer asks to update tracked work.
- Resolve an explicit follow-up to the referenced GitHub item and use existing pickup or private review behavior.

## Capabilities

### New Capabilities

### Modified Capabilities

- `work-visibility` gains on-demand recommendations and contextual follow-through in Abra chat.

## Impact

Update the bundled Supervisor instructions and orchestration skill in `packages/agents`. Exercise the existing GitHub inbox and assignment contracts and document the exchange in the workspace guide.

## Scope and Choices

Use current work observations, including dependency waits, outstanding decisions and GitHub coverage. Keep ranking in the conversation so a user can challenge the reasoning. Durable personal memory, background alerts, new UI, model selection and controller policy changes are outside this increment.
