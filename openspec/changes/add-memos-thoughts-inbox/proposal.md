# Proposal

## Why

A thought captured on the road can be worth keeping long before it belongs to a project. An operator should be able to save it while AbraCode is off, find it directly in the app later, and decide whether to discuss it or turn it into work.

## What Changes

- Connect one optional, independently hosted Memos notebook. An untagged private memo saved from the phone appears in AbraCode when the operator next opens Thoughts.
- Give the central Supervisor three tools, `abra_thought_save`, `abra_thought_search` and `abra_thought_get`, and one bundled `abra-thoughts` skill for capture, retrieval and explicit handoff to existing work intake.
- Add a Thoughts view alongside the Work finder. Show recent notes, search by text, tags and date, page through results, inspect a note, open its original, or attach its reference to an editable Abra draft. Browse and search without a model turn.
- On an explicit request with a goal and target repository, retain the selected memo reference and accepted wording with ordinary coding work. Capturing, reading and discussing a memo are useful outcomes in their own right.

## Capabilities

### New Capabilities

- `personal-thoughts` covers the private notebook connection, scoped capture and retrieval, and explicit handoff of a selected thought to work.

### Modified Capabilities

- `work-visibility` gains a project-independent Thoughts destination and selected-memo handoff in the existing workspace.

## Impact

Add typed memo references and queries to `packages/contracts`, connection settings and a Memos adapter to `packages/runtime`, Supervisor guidance to `packages/agents`, and a view in `apps/web`. Follow the GitHub inbox's authenticated workspace read path and existing controller intake. Document optional operator setup, including an independently reachable Memos host, a private notebook, and a server-side token (inline or by file reference). Existing installations can omit the connection.

## Scope and Choices

Target the documented Memos 26.11 API and pin the first compatibility check to 26.11.1. The runtime wraps the three upstream MCP operations for Abra and uses Memos HTTP list/get for the view. Both paths share the account scope, typed filters, reference validation and result projection. Keep the credential in the service. The browser and agent supply typed arguments. [MCP operations](https://usememos.com/docs/integrations/mcp) · [Versioned HTTP API](https://usememos.com/docs/api/26-11)

Start with the connected user's private, personal memos outside shared Spaces. Tags are optional search filters. Identify a memo by instance, account and resource name. Bind a selection to a digest of its wording and require reselection after a change. A save preserves the user's wording and uses a stable identity across retries. Read Memos live on demand. SQLite retains the accepted work request and source reference when a thought becomes coding work. [CreateMemo](https://usememos.com/docs/api/26-11/memoservice/CreateMemo) · [ListMemos](https://usememos.com/docs/api/26-11/memoservice/ListMemos)

Phone capture uses the ordinary Memos client against a reachable Memos service. Device-offline syncing, an Abra mobile capture client, notebook replication, multi-note synthesis agents and a new assistant runtime are deferred. Existing engineering workers receive only the excerpt accepted for their task.
