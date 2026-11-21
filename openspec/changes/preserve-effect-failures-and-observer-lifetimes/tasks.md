# Tasks

## 1. Give each observation its own lifetime

- [x] 1.1 In `opencode/agui/adapter.ts`, allocate the projection cursor and run terminal state per subscription. Keep one native admission per stable input and preserve the shared upstream feed. Extend `fast/web-agent.test.ts` by subscribing twice to the **same** returned Observable, both concurrently and after the first completes. Verify each baseline, later updates, input-correlated run completion, admission count and independent teardown.
- [x] 1.2 Validate outgoing events at the Effect/RxJS bridge and observe the stream's full exit. Retain the existing domain-level run error protocol. Test malformed outgoing events, producer defects, clean EOF and unsubscribe during a live stream. Assert one terminal notification to a live subscriber, bounded diagnostics, released subscriptions and zero implicit native Stop calls.
- [x] 1.3 Keep the post-commit invalidation loop alive across transient lock failures. Reuse `Invalidations.publish` and `mergeChanges` to requeue a consumed scope with bounded delay inside the scoped worker. Preserve the post-commit barrier, bounded coalescing, best-effort native emit and periodic fallback. With a test clock and controlled barrier, fail the first pass, publish a second scope during backoff, then confirm both scopes reach the observer after the barrier succeeds. Close the scope during retry and assert the worker exits.

## 2. Classify inbox failures where they originate

- [x] 2.1 In `work/inbox-index.ts`, decode stored scan and summary text via `decodeSync(Schema.fromJsonString(...))`. Expose typed index operations to `GithubInbox` and admission, including failure-recording writes. Give native SQLite failures a bounded local diagnostic. Keep synchronous source lookup and link creation inside the work graph's existing transaction. Exercise malformed data, a failed page write, and a failed source-link write in `integration/github-inbox.test.ts`. Verify rollback, unchanged remote cooldown/access state, preserved prior links and same-request retry.
- [x] 2.2 Map expected inbox read outcomes at the registered `githubInbox` and `githubItem` handlers using the existing visibility error contract. Map `INBOX_PROJECT` to `invalid_selection`. Map remote access/authentication, cooldown, unavailable central location and local read failures to `resource_unavailable` with the original diagnostic code. Cover changed remote identity and malformed remote payloads explicitly. Keep partial per-project coverage where supported and genuine unexpected defects distinguishable. Exercise handler-to-client error decoding, bounded text and successful reads for an unaffected project. Use `fast/web-native-errors.test.ts` and the inbox integration fixtures.

## 3. Decode external evidence before acting

- [x] 3.1 Use the shared typed decoder for the fetched object ID in `RepositorySources.fetch`, following `Git.head`. With a stub runner, cover malformed successful output plus valid SHA-1 and SHA-256 output. Assert the invalid case yields `INVALID_DATA` and cannot produce a retained base ref.
- [x] 3.2 In managed clone recovery and OpenSpec schema checking/creation, use the existing entry-aware filesystem predicate and validate present entries before adoption. Check the managed onboarding path that can lead to clone recovery. Extend `integration/lifecycle-filesystem.test.ts` with missing entries, permission/I/O errors and dangling links. Assert the failing paths preserve evidence and issue no dependent creation command, and valid absent paths still initialize.
- [x] 3.3 In `ReportExports.verified`, decode the original receipt text with `decodeJSON`. Translate malformed required embedded JSON in the snapshot and document HTML validators into the existing report-integrity failure. Preserve size bounds, digest checks and each format's exact-content comparison. Exercise corrupt receipts and embedded payloads through report read/recovery and export validation, alongside successful historical reads in the existing report tests. Assert typed failure and unchanged files.

## 4. Record preparation only when its dependencies are available

- [x] 4.1 Make the catalog a dependency of fresh configured capture and preparation. Keep legacy selection explicit and permit valid completed receipts to be read without a live catalog. For fresh preparation, establish the dependency before the durable start claim, and recheck the receipt under coordination before invoking the provider. Extend `unit/prepared-agents.test.ts` to remove and restore the catalog, retry with the same prompt, and assert zero then one provider call. Keep the concurrent and interrupted preparation cases passing.
- [x] 4.2 Decode preparation receipts as started/complete variants with the existing execution, generation, role, session and prompt schemas. Require the captured prepared value on completion and retain assignment and revision equality checks. Test valid existing receipts, missing completed payload, mismatched identity and an uncertain start. Assert the caller can distinguish each failure and malformed or uncertain records never cause automatic provider replay.

## 5. Verify the integrated change

- [x] 5.1 Run `pnpm exec openspec validate preserve-effect-failures-and-observer-lifetimes --strict`, `pnpm check` and `pnpm test:all`. Record suite results separately from focused retries and use disposable test repositories for Git and SQLite scenarios.

## Verification

- Strict OpenSpec validation and `pnpm check` passed.
- The initial `pnpm test:all` run passed 882 of 889 tests. Four scenarios timed out while a second suite shared the workspace. Three fixtures assumed legacy worker selection and were updated to exercise the configured path.
- Focused retries passed all 14 tests across diagram authorization, selected readiness, research restart and finishing. The native workspace journey also passed independently.
- The final `pnpm test:all` run passed all 889 tests across 146 files in 214.54 seconds, including the renderer integration. Git and SQLite regressions used disposable repositories and databases.
