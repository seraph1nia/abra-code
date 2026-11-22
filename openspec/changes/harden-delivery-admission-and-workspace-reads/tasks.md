# Tasks

Use the [proposal](proposal.md) for scope and the linked deltas for acceptance. Each group includes its own regression checks. Run the named test files with `pnpm test:one <path>`. Browser scenarios use built assets.

## 1. Publish the reviewed commit

- [x] 1.1 Split preparation from publication in `workflow/finalization.ts`, `git/repository.ts` and `git/delivery.ts`. Verify the immutable commit’s tree against the retained reviewed tree before binding. Pass the bound SHA through publication and restart. Keep draft and setup callers responsible for their own authorized preparation. In `packages/runtime/tests/unit/delivery.test.ts`, use a disposable bare remote to prove a mismatched tree causes zero pushes and a later local edit or branch move cannot publish different content.
- [x] 1.2 Confirm the exact destination ref after a push and the owned PR identity, base and head after create or reuse. Preserve existing predecessor, fast-forward and synchronization guards. Exercise branch delivery, mismatched post-create observations, lost push/create responses and reuse of the same binding in the delivery and finishing tests. Update the publication sequence in `docs/architecture.md` to match the [delivery requirement](specs/delivery-evidence/spec.md).

## 2. Persist native approval answers

- [x] 2.1 Reuse the durable form lifecycle in `workflow/authorization.ts` from `config/setup.ts`. Reacquire the retained receipt after creation and persist answers by the bound form, session and fingerprint through the appropriate issue or setup writer. Preserve setup PR eligibility and issue plan validation. Extend `packages/runtime/tests/unit/remote.test.ts` to reload setup after immediate approval and immediate rejection, including an approved setup still blocked by another merge prerequisite.
- [x] 2.2 Exercise pending response, lost answer-save response and restart against the original form ID for setup. Confirm a changed head cannot consume the approval and branch-only setup does not need one. Run `checkpoint-authorization.test.ts` alongside the setup cases to verify both callers satisfy the [approval contract](specs/execution-coordination/spec.md).

## 3. Show committed publication revisions

- [x] 3.1 Route publication search in `presentation/associations.ts` and `web/gateway.ts` through the commitment rules in `web/surface-publications.ts` and `web/reviews.ts`. Reuse current and legacy head interpretation, preserve the last committed predecessor, and bound metadata reads to the page. Extend `presentation-associations.test.ts` to assert session isolation, continuation past an empty filtered page, malformed-neighbor diagnostics and zero separate publication-body fetches for previews.
- [x] 3.2 Add Search assertions to the existing interrupted-write fixtures in `packages/runtime/tests/unit/surface-publications.test.ts` and `packages/runtime/tests/fast/interactive-reviews.test.ts`. At the association-before-commit point, compare Search, transcript and exact reads. After recovery verify a single discoverable, readable revision. Document the committed search window in `docs/web-workspace.md` against the [visibility requirements](specs/work-visibility/spec.md).

## 4. Require complete reservation evidence

- [x] 4.1 Make `workflow/capacity.ts` consume values and diagnostics from both execution scans. Share the interpretation of completeness with setup and selected readiness while retaining their existing lock scopes and limit calculations. In `packages/runtime/tests/unit/capacity.test.ts`, verify that either type of unreadable peer prevents reservation and native submission, including a wait retry after a previously successful readiness check.
- [x] 4.2 Retain a diagnosable retry path when capacity is unknown. Repair the peer record in the fixture, reconcile twice and assert exactly one admitted turn. Exercise retained-only setup, existing uncertain ownership and global, repository and role limits. Run the integration capacity and selected-readiness suites and update the capacity guidance in `docs/operations.md` to match the [reservation contract](specs/execution-coordination/spec.md).

## 5. Enumerate planning documents once per observation

- [x] 5.1 Keep paths, observation metadata and the bounded reader together when `workflow/queries.ts` selects the worktree or archive adapter. Reuse the archive’s existing blob reader in `visibility/evidence-discovery.ts`. In `packages/runtime/tests/unit/visibility.test.ts`, drive a discovery page over three documents in each source and assert one enumeration per issue, one archive commit resolution and the expected ordered hits and cursor.
- [x] 5.2 Keep worktree containment checks at file-open time and exact passage validation on later selection. Exercise disappearing files, symlinks, the existing size limits, stale hashes and generations, and fresh reads on a second request. Verify the [passage-search requirement](specs/work-visibility/spec.md) through both discovery and the existing exact reader.

## 6. Resolve captured tool eligibility once

- [x] 6.1 Move the legacy Review exception and the interpretation of contributions and authored denials into the existing `packages/agents` policy owner. Reuse that decision in capture validation, native permission projection and both OpenCode hooks. Preserve historical profile digests, role defaults and resource-specific native rules. Exercise historical and current Review profiles in `agent-policy-baseline.test.ts` and the agents package tests.
- [x] 6.2 Verify model visibility, execution eligibility and native permissions against the same capture for an allowed read contribution, a denied contribution ID, a denied action and an inactive worker. Keep assignment, resource and phase checks at their current owners. Run the role-policy and prepared-agent suites and align `docs/architecture.md` with the [captured policy requirement](specs/worker-policy/spec.md).

## 7. Preserve matched targets in the palette

- [x] 7.1 Update result assembly in `apps/web/src/workspace-palette.tsx` to carry owner-confirmed matches separately from locally matched previews, and merge by exact authorized target. Keep the existing ranking and per-source continuation. Exercise an ID absent from all visible text, a remote hit colliding with a local preview, two revisions with the same label and stale results after changing query or session.
- [x] 7.2 Build the web app and extend the palette journey in `packages/runtime/tests/e2e/web-coherence.test.ts` to select a committed revision by producing call ID and message ID. Assert the exact reader opens once for the chosen result. Update the search source table in `docs/web-workspace.md` to describe these lookups. Verify against the [palette requirement](specs/work-visibility/spec.md).

## 8. Carry compact diagram selections

- [x] 8.1 Expose the canonical digest on observed diagram-bearing surface revisions, deriving it on read for older records. Carry the typed selection through `packages/presentation/src/surfaces.tsx`, `diagram-resource.tsx` and `apps/web/src/data.ts`. Remove full-surface serialization from resource key construction while retaining the native digest verification in `web/gateway.ts`. Verify current and legacy reads, bounded key size as content grows, and refusal of stale revisions or wrong hashes.
- [x] 8.2 Build the web app and run `packages/runtime/tests/e2e/mermaid-views.test.ts` for shared requests, last-subscriber cancellation and out-of-order revision responses. Exercise both compact surface and report selections and a frozen report with supplied assets. Confirm the frozen renderer performs zero live requests as required by the [diagram contract](specs/typed-contracts/spec.md).

## 9. Verify the integrated change

- [x] 9.1 Run `pnpm exec openspec validate harden-delivery-admission-and-workspace-reads --strict`, `pnpm check` and `pnpm test:all`. Use the disposable native verification recipe for affected native journeys and keep Git pushes inside fixture remotes. Record command outcomes and any unresolved failures before handoff.

## Verification

- `pnpm check` passed. The package checks, root typecheck and both Effect diagnostic runs completed successfully.
- `pnpm test:all` passed all 936 tests across 148 files on the final checkout.
- The disposable `engineering` native journey passed and recorded `cleanup_complete: true`. Its Review fixture now reads the verified diff again for each correction assignment.
- The extended frozen React report export passed with supplied diagram assets and zero live requests. The browser tests also covered exact palette openings, shared diagram requests and cancellation.
- Strict OpenSpec validation passed.
