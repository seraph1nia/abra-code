# Tasks

## 1. Connect an optional private notebook

- [x] 1.1 Add optional Memos instance and server-side token (inline or by file reference) to personal configuration, its generated schema, example and operator documentation. Describe running the pinned Memos service independently, reaching it from a phone, and capturing an ordinary private memo. Verify legacy settings, offline config validation, missing credentials and operation with zero registered projects. Check that effective settings, diagnostics, browser payloads and worker subprocess environments omit the token.
- [x] 1.2 Exercise Memos 26.11.1 in a disposable instance with a temporary account. Record the Streamable HTTP MCP initialization, tool names, argument/result shapes, caller-supplied memo ID, account identity and private memo permalink in `docs/supported-apis.md`. Compare create/list/get with the versioned HTTP contract. Verify a private memo created via MCP opens through HTTP and its original link, including authentication and upstream error behavior. Declare a direct runtime dependency if using the MCP SDK already present in the lockfile.

## 2. Share scoped queries and reliable capture

- [x] 2.1 Define Effect schemas for source reference, query, summary, detail and page in `packages/contracts`. Implement one scope and filter builder and common response decoding for MCP and HTTP. Bind detail to the configured instance, current owner, private visibility and personal scope. Escape literal text and tags, use a defined creation-time range and stable newest-first ordering, and bind continuations to their scope and query. Compare both transports over identical fixture data, including quoted text, tied timestamps, multiple pages, a changed account, out-of-scope notes and an unavailable service.
- [x] 2.2 Implement save using exact content and a caller-stable request ID scoped to the account and instance. Reconcile an uncertain create against the same memo identity and payload before reporting success. Return a conflict or unresolved result when the original effect cannot be established. Exercise concurrent retries, response loss and process restart, distinct intentional saves of identical text, and changed input under the same key.

## 3. Give Abra three notebook operations

- [x] 3.1 Register `abra_thought_save`, `abra_thought_search` and `abra_thought_get` at the existing central tool and authorization boundary. Map only to the allowed Memos operations. Add the bundled `abra-thoughts` skill and guidance to the Supervisor definition in `packages/agents`. Test actual tool visibility and invocation for Supervisor, coding workers and automated diagnostic turns. Verify that asking for a note cannot write one, dispatch work or execute instructions embedded in its text.
- [x] 3.2 Carry the selected source identity and agreed excerpt through ordinary `abra_work_create` in the chosen repository. Reuse its request identity, atomic intake and policy checks, and preserve historical requests without a source. Exercise a missing target, repeated explicit intake, a later edit to the memo and review of the accepted excerpt after restart. Document chat examples for save, lookup, discussion and explicit pickup.

## 4. Search and select thoughts directly in the workspace

- [x] 4.1 Add authenticated typed list and detail reads along the existing workspace HTTP, backend and plugin RPC path. Implement the desktop and phone Thoughts destination next to work discovery with recent items, text/tag/date filters, pagination, detail, original link and retry. Test programmatic calls and the browser against a fixture with zero registered projects, including superseded queries, returning to results and distinct unconfigured, empty and failure states. Assert zero model submissions and that the view contacts only the AbraCode backend for its data.
- [x] 4.2 Add an Ask Abra about this action that carries the exact scoped memo reference into the session draft and preserves typed text until Send. Resolve the reference on use. Verify same-snippet selections, reorder, deleted or newly out-of-scope memos, and phone navigation before submission. Document the browse-to-chat flow in `docs/web-workspace.md`.

## 5. Verify the full capture journey

- [x] 5.1 Follow the disposable native verification recipe with the pinned Memos service. Save an untagged thought through its phone-facing UI while AbraCode is stopped, start AbraCode, find it in Thoughts, and discuss that exact note in chat. Then explicitly create work in a disposable registered repository and verify it retains only the accepted source and excerpt. Retain steps, snapshots and evidence with the project-local agent-browser CLI in a task-owned session. Run strict OpenSpec validation, `pnpm check` and `pnpm test:all`.
