# Proposal

## Why

OpenCrew can publish a reviewed PR, wait for CI and merge approval, and run scoped correction rounds, but new CI failures and review discussions do not reliably reach that correction path without manual supervision. Complete the loop so delivered work progresses through actionable feedback with quiet deterministic monitoring, bounded diagnosis and repairs, and clear strictness settings.

## What Changes

- Continuously observe owned open GitHub PRs while delivery or human merge approval is pending, retaining fresh head-bound CI and discussion evidence with backoff and restart recovery.
- Ingest check attempts, bounded failing-job evidence, submitted review verdicts and bodies, inline review threads/comments, and ordinary PR comments, including edited feedback and unresolved feedback originating at an older head.
- Persist feedback identity, revision, applicability and handling disposition; deduplicate unchanged observations and admit one durable Supervisor diagnostic batch for new actionable evidence.
- Route accepted in-scope findings through the existing finite correction controller, preserving independent Review, verification, archived planning, PR identity, and fresh merge authorization for every changed head.
- Add explicit `strict`, `standard`, and `quick` quality profiles with independently configured repair budgets, delivery and merge authority. Preserve unprofiled registrations and execution snapshots; never infer a lighter workflow from filenames or repository type.
- Add draft publication and guarded ready-for-review transitions, configured reviewer suggestions/requests, evidence-backed public replies and optional thread resolution, and finite policy-controlled GitHub Actions reruns. Persist and reconcile every outward action before retrying it.
- Integrate the installed no-mistakes runtime as an optional controller-driven validation engine with exclusive branch custody, supported machine-output decoding, bounded gates/fix work and fresh native verification/Review after custody returns. Keep publication and merge in the OpenCrew controller.
- Show feedback, freshness, correction/rerun budgets, draft/reviewer/discussion action state, external-validation progress, policy provenance, answer owners and next actions in the existing native TUI. Keep reads separate from authorized controller actions.

## Capabilities

### New Capabilities

- `pr-feedback`: Durable, bounded GitHub CI/discussion observation, feedback applicability and disposition, and merge coordination for owned delivered PRs.
- `pr-automation`: Configured GitHub draft/ready transitions, reviewer requests, evidence-backed discussion replies/thread resolution and finite CI reruns with durable action evidence.
- `external-validation`: Optional no-mistakes execution, gate decisions, exclusive branch custody and verified result adoption before native delivery gates.

### Modified Capabilities

- `delivery-evidence`: Coordinate feedback processing with exact-head merge readiness and retained corrective rounds.
- `native-supervision`: Admit deduplicated diagnostic attention for PR feedback independently of ordinary approval/delivery waits.
- `work-policies`: Resolve and snapshot explicit quality profiles while retaining workflow selection, conservative defaults and separate merge authority.
- `work-visibility`: Present PR feedback, correction progress and effective policy through existing native ticket views and controller routes.

## Impact

- Extend the existing Effect-based TypeScript server plugin and TUI plugin; reuse their central leadership, native sessions/forms, RPC invalidations and controller ownership. Do not introduce another daemon, work graph or worker publisher.
- Expected areas: `src/git/{forge,findings,readiness,delivery}.ts`, new focused feedback observation/reconciliation contracts, `src/workflow/{attention,advancement,corrections,finalization,execution}.ts`, configuration/onboarding, work intake/model/SQLite request persistence, retained record codecs, tool contracts, and visibility projections/components.
- Add GitHub review-thread/comment and Actions failure-evidence reads plus guarded draft, reviewer, discussion and rerun writes through the forge adapter. Add a version-probed no-mistakes process/protocol adapter; its absence is a blocker only when explicitly selected. Keep the OpenCode 2.0.28 integration and validate newly consumed native contracts against `docs/supported-apis.md` and installed declarations.
- Add temporary-repository forge fixtures, controlled-clock recovery/concurrency tests and native integration/TUI coverage. Update configuration and operations/recovery documentation. Required implementation checks remain `pnpm check`, `pnpm test`, and `pnpm test:e2e`; tests must never push to user remotes.
- No breaking defaults or automatic migration to a profile. The user explicitly selected GitHub only; GitLab, Forgejo/Gitea, Gerrit and external review-upload systems are not targeted. Each new outward automation and the external validation engine is separately configured and disabled by default; profile selection alone does not enable it.
