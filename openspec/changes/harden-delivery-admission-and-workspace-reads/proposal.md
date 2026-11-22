# Proposal

## Why

A reviewed commit can be replaced between finalization and the Git push, and an approval answered during its first setup request can still appear pending. The same review found six narrower places where callers either lose evidence already established by its owner or repeat expensive work to recover it.

## What Changes

- Publish the immutable commit bound to the reviewed tree. Confirm the remote branch and, for GitHub delivery, the owned PR head before reporting success.
- Share approval receipt collection between issue checkpoints and setup. Persist an immediate or recovered answer against its retained form identity.
- Apply the same committed-revision test to Search results, producing-message attachments and exact reads for surfaces and interactive reviews.
- Require a complete count of issue and setup records at the moment a worker reserves capacity, including a retry after waiting.
- Enumerate an issue’s planning documents once per discovery request. Read each eligible document from that request’s owned worktree or delivered archive.
- Resolve worker tool eligibility from the captured profile in `packages/agents`. Use it for model-visible tools, execution guards and native permissions.
- Carry confirmed search matches through palette deduplication so a producing message or tool call ID can find the revision it produced.
- Supply diagram preparation with the observed surface’s digest. Keep its selection and cache key bounded as the diagram source grows.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `delivery-evidence` gains an exact-commit requirement for publication and retry.
- `execution-coordination` covers immediate setup form answers and completeness at capacity reservation.
- `work-visibility` covers committed publication discovery, retained match evidence and request-scoped plan enumeration.
- `worker-policy` makes captured tool eligibility consistent across all projections.
- `typed-contracts` covers exact, compact diagram selections for historical and current surfaces.

## Impact

The controller retains lifecycle and approval decisions. Git publishes the selected commit. Native storage retains existing receipts, profiles and publication heads. On the read side, the work touches visibility queries, the web gateway, the palette and the shared presentation package. The surface read gains a derived digest. Implementation can derive it for existing records without rewriting stored identities.

## Scope and Choices

Start with Git publication because the mismatch is currently detected after a remote write. Use a disposable bare remote and the existing forge fixture to verify the change. Implement the other seven findings as independently verifiable slices. Keep setup and draft preparation explicit, setup’s distinct record key, the existing capacity limits, search cursors and the browser’s diagram cancellation behavior.

The completed work described in `complete-work-reliably`, `simplify-workspace-publication-and-runtime` and `redesign-workspace-navigation-and-search` supplies the starting behavior. This change adds acceptance cases at the points where those features meet. It uses the existing canonical capability paths so it can be applied independently of when those earlier changes are archived.
