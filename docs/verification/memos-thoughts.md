# Private thought capture from a phone

Use the [native fixture prerequisites](README.md) and a disposable Memos 26.11.1 instance published on a random loopback port. Keep its account, token and browser session separate from personal installations.

1. Start the disposable notebook before starting the AbraCode fixture. Open it with the project-local agent-browser CLI in a task-owned session at a 390 × 844 viewport. Create a temporary user. In their personal notebook choose Private and save the following untagged memo exactly once.

   > Road notebook: make time for weekly planning. Keep this second sentence personal.

2. Retain a browser snapshot of the saved entry. Issue a personal access token for the temporary account, store it in a private file, and close the capture session.
3. Run the selected native journey with the notebook's loopback origin, absolute token-file path and an evidence directory outside the installation fixture.

   ```sh
   ABRACODE_TEST_JOURNEY=memos-thoughts \
   ABRACODE_TEST_MEMOS_ORIGIN=http://127.0.0.1:PORT \
   ABRACODE_TEST_MEMOS_TOKEN_FILE=/absolute/path/to/temporary-token \
   ABRACODE_TEST_EVIDENCE_DIR=/absolute/path/to/evidence \
   pnpm test:one packages/runtime/tests/extended/native.test.ts
   ```

4. The fixture starts the pinned OpenCode service and workspace, opens the phone Canvas finder, searches Thoughts, and submits a question about the selected reference. Its deterministic provider calls the real Supervisor lookup through Memos MCP. It then registers its temporary repository and explicitly invokes ordinary work intake twice with the same request ID. The issue overview must retain the chosen reference and excerpt. The second sentence stays outside the issue.
5. Review the captured phone memo, Abra detail and chat snapshots, and the retained issue overview. Stop the disposable notebook and remove its temporary token file.
