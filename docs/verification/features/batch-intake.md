# Atomic batch intake

Follow the [disposable native prerequisites](../README.md). Run the full journey
for batch receipt recovery across the later service restart:

```sh
mkdir -p /tmp/abra-batch-native-20261018
REPORT_CHROMIUM_PATH=/path/to/compatible/chrome \
ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-batch-native-20261018 \
  pnpm test:e2e > /tmp/abra-batch-native-20261018/native.log 2>&1
```

The 2026-10-18 run at that path passed both tests in 218.60 seconds. Retained
`native-engineering.json` reports `result: pass` and `cleanup_complete: true`,
with `batch_intake` and `batch_restart` recording the same three local-key/issue
pairs. The actual registered tool checks structured-output equivalence, forward
local and existing dependencies, conflicting retry refusal, worker denial and
no dispatch from intake. The focused engineering recipe creates/retries the
batch but exits before the later restart; it is not that restart proof.

`work-graph.test.ts` exercises real SQLite transactions, competing processes,
second-event rollback, schema 3/4 upgrades, failed-migration rollback and future
version refusal. Original single-item request inputs remain unchanged. Tests also
reject changing request kind between single/batch intake and conflicting adoption
of batch-owned item identities. `batch.test.ts` covers schema bounds/strictness,
policy/scope validation, normalized ordering, lost-response controller restart,
retained research-report references and creation without worker admission.

The integration gate passed `pnpm check` and `pnpm test` (399 tests in 63 files),
then the native suite separately. All remotes/providers are disposable local
fixtures. This proves atomic intake and retry identity; fair automatic dispatch
and the two-slot parallel journey belong to the next scheduler milestone.
