# Preserve source baselines across controlled replanning

## Why

Controlled replanning currently compares Explore output with the original commit rather than the legitimate dirty Apply content retained before Explore. This falsely attributes retained Apply work to Explore as `EXPLORE_SOURCE_EDIT`; accepting today's tree implicitly would instead erase the distinction between attributable work and genuinely unknown content.

## What Changes

- Retain an exact, attributable, execution-bound source baseline before controlled Explore admission, using private-index Git objects without changing the real index, files or HEAD.
- Compare subsequent planning changes against that immutable baseline, including separate staged and working content, untracked paths, modes, links and both sides of moves. Preserve initial Explore, correction, synchronization, pause, custody and admission boundaries.
- Add explicit guarded pre-delivery planning recovery: inspect independently retained historical content first; when insufficient, offer native human adoption of the exact current tree as a **new** baseline, never as reconstructed history.
- Bind adoption to exact content and ownership, preserve historical violations and approvals, and require fresh plan authorization, configured checks and independent Review afterward. Adoption grants neither implementation nor publication/merge authority.
- Keep baseline attempts, request identity and failure history durable across interruption, response loss and restart. Retry must not recapture content after a violation.
- Make refusal of a busy writer nonmutating at the existing `Advancement.advance` failure-reflection seam. Retain the same `WRITER_BUSY` failure, without changing phase/claim or replacing the writer; do not add a UI workaround.
- Include the proven minimal renderer prerequisite: exclude installation-local `.abracode` metadata by installation-relative path segments, not absolute ancestors. Preserve containment, realpath and symlink checks.
- Document and test compatible persistence, disposable native recovery, backup/rollback and separately authorized activation of an independently reviewed exact candidate.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `execution-coordination`: durable controlled-planning baselines, source-delta enforcement, nonmutating busy refusal and explicitly authorized pre-delivery recovery.
- `typed-contracts`: validated immutable baseline/adoption evidence, lossless legacy compatibility and safe activation/rollback requirements.
- `report-template`: installation-relative renderer input discovery needed for the configured build in owned nested worktrees.

## Impact

Primary seams are `packages/runtime/src/workflow/advancement.ts`, `sessions.ts`, `authorization.ts`, `execution-recovery.ts`, existing obligations/native disposition collection, `storage/contracts.ts`, `storage/store.ts` and `git/repository.ts`. Extend the existing Supervisor control contract and native form binding projections; do not create a parallel workflow engine or approval system. No dependency/workspace changes are proposed. Documentation and focused/unit/real-Git/native regression coverage are included.

The baseline uses existing Git-defined content/fingerprint semantics, with separate index/candidate trees where needed. No raw-content manifest, full filesystem snapshot, general ignored/cache inventory, hidden-flag detection or reconstruction engine is included. Existing native role/path guards and unsupported-state refusals remain authoritative; these limits do not authorize unknown content.

### Actual repair base and bounded prerequisites

Controller-routed operator observation at 20:34 on 2026-11-18 identifies branch `work/abra-6de9f301-62ad-4306-b4a0-23c4b0494dc1`, HEAD/base `d03cc0864cad82f1ad05b7c1b16317df06282fcc`, and only this assigned change's `.openspec.yaml` in short status before planning. Explore inspected the source but did not independently run Git or checks.

The operator's clean-base `mise exec -- pnpm build` exited 1 after successful web compilation: `REPORT_SHELL: Renderer manifest lacks a required source input`. The retained log is `/home/bart/Projects/abra-code/.abracode/evidence/agents-20261118-uS1liM/controller-repair-clean-base-build.log`. Actual source `apps/report/scripts/renderer-manifest.ts:29` filters every absolute `/.abracode/` ancestor, including this installation. This justifies only the relative-segment fix and regression, not a broader renderer refactor.

Busy-refusal preservation is part of the repair's ownership contract: `Advancement.advance` currently reflects `WRITER_BUSY` through `transitions.fail`, which can block the running assignment. The parent evidence index records the corresponding lifecycle RED/GREEN. Its minimal controller-only correction will be reproved here. Inspector detail-query coalescing/dirty freshness, UI changes and all agents-package work are excluded: no actual repair-base mandatory-check evidence currently requires them.

### Preservation and authority limits

Parent issue `abra-dad34efb-f0af-4ccc-9655-f4540c2593e3`, execution/worktree `abra-203fda5d-0e15-4a27-8a5d-17095c826d3b`, remains `recovery_required`. Its `docs/verification/agents-acceptance.md` records prior preservation fixes and proof; retained operator evidence is under `/home/bart/Projects/abra-code/.abracode/evidence/agents-20261118-uS1liM`. Those observations are not this repair's passing check receipts or proof of historical baseline bytes.

The corrected operator account establishes that parent Explore changed only its assigned `design.md`: four table-formatting hunks and a trailing comma in a TypeScript documentation example, all inside that file. Its byte equality with the retained formatter candidate is operator-verified. Legitimate source WIP pre-existed from approved Apply; the old-base guard produced a false-positive allegation, not proof of an outside-source comma edit. No complete exact historical baseline with original binding is currently established. Preserve the original allegation/error unchanged; use supported prospective human adoption if historical evidence remains insufficient. Separate negative fixtures must still reject real outside-source mutations.

Preserve all parent source, staged/unstaged/untracked content, resources, identities, receipts, historical allegations/errors and original approval history; do not recover/adopt it during this repair. Preserve unrelated paused issue `abra-35d041d1-a717-4f01-9637-83f3ad0e030a`, setup state, settings, models, capacity and all other retained work. This repair has no dependency on parent completion. Planning approval does not authorize activation, parent recovery, publication, merge, service restart or installation into the running controller.
