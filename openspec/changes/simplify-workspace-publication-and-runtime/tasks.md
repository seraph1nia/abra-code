# Tasks

## 1. Commit generated surfaces before exposing them

- [x] 1.1 Give `SurfacePublications` a retained head with distinct committed and pending revisions. Reserve the native call identity before staging, write immutable revision and association evidence, then advance the committed head. Decode old completed and pending heads and latest-only layouts. Extend `surface-publications.test.ts` to suspend or fail each write during first and replacement publication. Read **before recovery**, then restart and retry the original and an older call. Assert original bytes, revision, prior current selection and immutable call identity at each stage.
- [x] 1.2 Route the gateway listing, exact and current reads, diagram preparation, review-source resolution, report saving and transcript attachment filtering through the committed selection. Include the interval after association but before head commit. Verify via the real gateway and existing workspace/report tests that a pending first revision stays unavailable, an older committed layout remains usable during replacement, and an unrelated surface survives a corrupt head. Document the commit and retry behavior in `docs/web-workspace.md`.

## 2. Share the supervisor check within a workspace refresh

- [x] 2.1 Instrument a full fallback refresh through `NativeWebBackend.observe` and the registered web gateway. Count gateway authorization, native session lookups and execution collection scans for receipts, surfaces, presentations and projects separately from fleet and per-form reads. Record the baseline and add a regression covering all four sections together, one requested section, and no requested sections.
- [x] 2.2 Add a typed, bounded, read-only gateway operation that takes the requested sections and existing message selection. Reuse existing readers and scopes. Check the supervisor once before reading any requested section. Verify at most one assignment scan for the four sections, zero for an empty selection, matching values and diagnostics, and denial of a later read or mutation after eligibility changes. Run workspace integration and observation tests, including unchanged fallback and reconnect. Document the scope of reuse in `docs/web-workspace.md`.

## 3. Shorten targeted record and checkpoint test setup

- [x] 3.1 Measure `records.test.ts` and `web-checkpoints.test.ts` with the existing timeout, fixed worker settings and repeat count. Convert the stale-replacement case first, using the actual Records writer and decoder with a minimal valid stored execution. Verify that current and stale revisions still diverge and the original disjoint evidence survives. Record repository and controller setup calls eliminated alongside matched timings.
- [x] 3.2 Migrate the other records and checkpoint cases whose assertions require only stored evidence, retaining distinct legacy fixtures and real temporary Git bytes where fingerprint changes are under test. Retain end-to-end evidence creation and restart coverage in the appropriate lifecycle suites. Re-run both focused files under their normal timeout and document the fixture choice and before/after observations in `docs/testing.md`.

## 4. Release capacity consistently after worker preparation fails

- [x] 4.1 Route the preparation interruption, preparation error and preflight error in `workflow/sessions.ts` through one `Capacity` operation that clears the reservation and persists the idle observation via the existing owned-field commit. Keep diagnostic ordering, cancellation and stale-operation checks. Run `prepared-agents.test.ts` and coordination coverage for all three exits, for concurrent unrelated evidence, and for a superseded operation. Confirm the current reservation is released only by its owner and uncertain native admission stays reserved.

## 5. Retain browser requests before sending them

- [x] 5.1 Factor exact-input persistence and restoration out of chat admission, review feedback and snapshot saving. Preserve existing keys, schema compatibility, selection checks, draft behavior and per-feature receipt semantics. Verify old pending requests restore under the matching session/selection, a conflicting receipt cannot clear an attempt, and one feature cannot restore another feature’s request.
- [x] 5.2 Make Save snapshot keep its selection and show an actionable storage error when the initial write fails. Keep the original pending input recoverable if the response or local success write is lost. Extend browser coverage in `web-coherence.test.ts` for disabled storage with zero dispatches, recovery after re-enabling storage, reload and same-ID retry, and explicit Save another snapshot after success. Run the existing chat/review reconciliation cases. Update `docs/web-workspace.md` with the operator-visible behavior.

## 6. Prepare and activate the offline exporter explicitly

- [x] 6.1 Move source and resolved-dependency verification to `pnpm report:prepare` and the build. Stage one immutable bundle containing the shell, export-time diagram preparer and its required assets, notices and integrity metadata. Activate the complete verified bundle atomically. Give the new format an explicit compatibility identity. In `renderer-shell.test.ts`, verify clean installation, concurrent preparation, interrupted replacement, relevant and unrelated edits, and detection of damaged bytes or redirected paths.
- [x] 6.2 Make CLI and workspace exports pin and verify a prepared bundle through document rendering and publication. Use its diagram code for Mermaid documents and protect in-flight bundles during replacement or cache eviction. Exercise absent, incompatible and tampered bundles, concurrent activation, new export destinations, interrupted receipt recovery, and existing v2/historical receipts and downloads. Re-run report export, real diagram and offline browser coverage with text-only and diagram documents.
- [x] 6.3 Measure normal exports on a matched fixture and report source files read, compiler invocations, prepared bytes verified, diagram work and elapsed time separately. Assert zero renderer source-tree scans or application compilations during export, including warm reuse. Update `docs/reports.md`, install/build instructions and affected test setup for the explicit preparation prerequisite. Verify a clean-install command sequence, export before and after a source edit and re-preparation, and retained HTML reopening independently of the active bundle.

## 7. Verify the integrated change

- [x] 7.1 Run `pnpm check`, `pnpm test:all`, `pnpm build` and strict OpenSpec validation for this change. Use the disposable verification recipe for the affected native workspace and portable export paths, including exact surface saving and reopening a relocated report offline. Record final source, commands, counts, timings, failures and any unverified environment alongside the relevant verification evidence.
