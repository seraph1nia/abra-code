# Proposal

## Why

OpenCrew already uses the pinned OpenCode and Effect runtimes extensively, but duplicated contracts and custom runtime glue obscure native tool failures, discard validated type relationships and repeat observer work. Implementing audit findings 1–23 will make those boundaries more reliable and easier to maintain while preserving controller-owned lifecycle authority.

## What Changes

- Implement all eleven OpenCode findings, N01–N11: typed guard failures, native tool failure status, schema-defined structured tool output, native Effect tool inputs, live tool progress, upstream model/error schemas, declared observer RPC errors, post-commit observer invalidations, native TUI session data and targeted keymaps, and location-aware worker profile validation.
- Implement all twelve Effect findings, E01–E12: typed domain failures, simpler recovery combinators, JSON codecs, shared defaults/refinements, validated clock-derived timestamps, lazy shared client acquisition, scoped fiber ownership, application-provided platform services, request-local observer input reuse, correlated diagnostics/metrics, phase-specific evidence contracts and schema-owned work creation.
- **BREAKING**: rejected custom tool actions will be native failed tool calls with safe error metadata rather than successful content containing `ok:false`. Successful tool content retains its existing success envelope while also exposing schema-validated structured output; explicit routine waits remain successful domain values.
- Preserve existing JSON omission/null semantics, valid timestamp strings, additive retained evidence, normalized request identity, policy snapshots, native session/worktree/form identities and exact-content approval/delivery gates. Strengthened validation exposes malformed records without silently rewriting them.
- Add focused contract, lifecycle, observer, native renderer and real-server coverage, and update API/architecture/testing documentation after implementation.

## Capabilities

### New Capabilities

None. The change extends established integration and observer capabilities.

### Modified Capabilities

- `typed-contracts`: native tool input/output and failure contracts, declared observer errors, validated time and normalized request representations, and preserved schema-established evidence at internal boundaries.
- `native-supervision`: location-aware worker profile checks, observable native tool progress and bounded operation diagnostics that remain separate from authority and meaningful worker activity.
- `work-visibility`: event-assisted read-only refresh, native session/pending state, host keymap navigation and request-local read reuse while preserving offline snapshots and bounded lazy reads.

## Impact

- Server integration: `.opencode/plugins/crew/index.ts`, `src/opencode/{application,client,runtime,guards,tools,diagnostics}.ts` and schema contracts.
- Effect and persistence boundaries: `src/{effect,domain,identities,decode,filesystem,process}.ts`, configuration, storage, work intake/graph and workflow validation/operation modules.
- Observer integration: `.opencode/plugins/crew/tui.ts`, `src/visibility/*`, controller query projections and post-commit notification seams.
- Validation: relevant existing unit/integration suites, `tests/tui/sidebar.ts` and `tests/e2e/native.test.ts`, followed by `pnpm check`, `pnpm test` and `pnpm test:e2e` using disposable repositories without remote pushes.
- Keep OpenCode 2.0.28, Effect/platform-node 4.0.1, the current SQLite adapter and kernel locks. No dependency upgrade or database schema change is intended.
- Findings 24–32 / S01–S09 are excluded: compaction/retry hooks, notifications, durable preferences, codemode, native VCS replacement, alternate locks, Effect SQL and retry-policy redesign.
