# Self-hosted memory journey

Use the [disposable native fixture](README.md) and a separate loopback Memos 26.11.1 instance with a temporary account and private token file. Provision the pinned Basic Memory 1.0.0 executable in its own Python environment. The fixture creates its own Memos entry, checkouts, controller state, vault and browser session. Keep the evidence directory outside the fixture.

```sh
pnpm exec agent-browser skills get core
ABRACODE_TEST_BM=/absolute/path/to/venv/bin/bm \
ABRACODE_TEST_MEMOS_ORIGIN=http://127.0.0.1:PORT \
ABRACODE_TEST_MEMOS_TOKEN_FILE=/absolute/path/to/disposable-token \
ABRACODE_TEST_EVIDENCE_DIR=/absolute/path/to/new-evidence \
ABRACODE_TEST_JOURNEY=agent-memory \
pnpm test:one packages/runtime/tests/extended/native.test.ts
```

The phone view selects a single sentence for the registered API repository. After restart, the deterministic Research worker invokes both memory tools and must receive the saved revision and exact excerpt. The frontend repository sees the note only after a separate shared publication. The fixture edits the Markdown on disk, waits for reindexing, rejects the earlier citation, restores the vault and receipts in a fresh location, verifies the shared receipt after rebuild, and removes only its own executable link to exercise an outage. The Ctrl+K picker searches the API repository and opens the same revision on the phone. Check `memory-search.txt`, `remember-phone.txt` and the observations and cleanup result in `native-engineering.json`. The fixture closes its own browser session and removes its own installation. Stop the disposable Memos instance after verification.

For provider-only checks, set `ABRACODE_TEST_BM` and run `pnpm test:one packages/runtime/tests/integration/agent-memory.test.ts`. For UI retries at two viewport sizes, build the web app and run `pnpm test:one packages/runtime/tests/e2e/thoughts.test.ts`. The [API probe](../supported-apis.md#basic-memory-100) records the Linux offline test and macOS prerequisites.

On November 22, 2026, this journey passed on x86-64 Linux with Basic Memory 1.0.0 and Memos 26.11.1. The native Supervisor also published through an exact operator chat directive before any issue existed. The agent used the deterministic loopback model. The separate provider probe verified text and staged hybrid retrieval with external networking disabled. macOS prerequisites were examined from package metadata and source.
