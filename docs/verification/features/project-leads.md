# Persistent scoped project leads

Use [disposable native prerequisites](../README.md). Focused real-server command:

```sh
ABRACODE_TEST_JOURNEY=leads \
ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-project-leads \
  pnpm exec vp test run --project e2e tests/e2e/native.test.ts
```

`tests/e2e/leads.ts` proves static hidden native inventory, explicit complete model,
parent/location/session identity, denied direct steering and global management
access, scoped proposals without admission, correlated replies, restart retention,
Abra-only transactional acceptance, supervisor-owned blocker answering, completed
work notices, revocation/stop and explicit session rotation. The actual native
model turn executes only `abra_lead_action`. The integrated journey retains the
original human plan/merge approval and independent worker permissions scenarios.

`tests/unit/leads.test.ts` exercises retained create intent after response loss,
wrong sender/revision, conflicting identities, cross-project queries/proposals and
dependencies, duplicate admission/replies, uncertain absent admission, shared
attention capacity/budget, failed stop, revoked historical sessions, forged Abra
labels, native-tool refusals, human-question refusal, a SQLite batch commit before
its lead acceptance receipt and notification-receipt loss. Neither proposal nor
finding grants scope, execution or approval authority.

The focused proof at `/tmp/abra-leads-native4-20261018/native-engineering.json`
passed on 2026-10-18 (23.10 seconds, cleanup complete). This deterministic fixture
proves controller/native behavior, not model judgment quality. It exposed native
normalization of an omitted variant to `default`; model guards compare semantic
provider/model/variant fields rather than object serialization order. Later full
regression results supersede focused evidence when additional assertions change.

The complete M5 gate passed on 2026-10-18: `pnpm check` (zero warnings/Effect diagnostics), `pnpm test` (430 tests, 69 files, 224.58 seconds) and `pnpm test:e2e` (two tests, 298.55 seconds). `/tmp/abra-leads-full2-native-20261018/native-engineering.json` records pass and cleanup complete, including actual cross-project refusals, earlier model/parallel journeys, human approvals, independent Review, PR feedback and finishing. The first full run correctly refused scope access but exposed a test comparing an RPC error object with a string regex; the corrected assertion checks the actual error code.
