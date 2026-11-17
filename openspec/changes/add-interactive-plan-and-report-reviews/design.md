# Design

## Context

The app already renders bounded A2UI surfaces and immutable reports, associates presentations with native messages and admits user input with durable receipts. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:** compose accessible review controls, retain exact source/preview identity, preserve drafts and reuse admission recovery.

**Non-Goals:** change offline controls, execute generated callbacks, replace native checkpoint forms or grant new worker authority.

## Decisions

- Add a separate A2UI review catalog and pure shared renderer. A typed review definition compiles to a complete A2UI surface; owned component implementations use existing primitives. Expanding the evidence catalog would change frozen/offline behavior, so reviews are live adjuncts instead.
- One native review owner manages immutable publication, bounded current-head discovery, response reservations and replay-safe receipts. Pending heads repair publication/association interruptions. Exact reads verify hashes and ownership; observation never repairs state.
- Source selections are a closed union of surface, report and plan identities. Capture the reviewed plan text for later agent inspection, and recheck its hash and generation before first submission. Saved report/surface references resolve their exact retained bytes.
- Capture regular contained raster files into hash-addressed native storage; validate signatures, byte limits and digests on capture/read. Lazy authenticated image retrieval returns verified data to the host, not external URLs. Native storage survives worktree retirement.
- Response submission validates retained fields server-side, reserves immutable answers and queues a deterministic message through WebAdmissions. The same request reconciles its receipt without revalidating a changed source; conflicting payload reuse fails. A follow-up review can carry responds_to to expose actual revision evidence.
- Browser draft state is shared by exact review identity and backed by localStorage. Pending request identity is persisted before sending. Use the existing observer's presentation invalidation to refresh review availability and receipts.

## Risks / Trade-offs

- Stored previews increase native storage → 2 MiB/image and 8 MiB/review, bounded review heads and lazy retrieval.
- Lost publication/admission responses → pending publication records, immutable response reservation and existing native message identity reconciliation.
- Newer planning content can invalidate a draft → retain it, refuse first submission and expose the current review separately.
- Browser storage can be unavailable → keep mounted drafts usable, but refuse submission when durable client recovery identity cannot be saved.

## Migration Plan

Additive review namespace and attachment variant; no rewriting old report or surface records. Existing offline renderer remains unchanged. Existing application readers cannot consume new review associations; upgrades must keep the compatible app/runtime together.
