# Proposal

## Why

An agent in a fresh worktree can recover its assignment but has no scoped way to find a lesson from an earlier issue or another project. Operators already capture ideas in private Memos. They need a deliberate way to make selected knowledge available to future agents.

## What Changes

- Offer a self-hosted Basic Memory installation that AbraCode uses over local stdio MCP. Store ordinary, Obsidian-readable Markdown outside managed worktrees, with one collection per stable registered repository and one explicitly shared across projects.
- Give Abra and eligible managed workers two on-demand tools, `abra_memory_search` and `abra_memory_read`. Project leads use read actions through their existing dispatcher. Return bounded results and revision-aware citations. A provider outage affects memory operations only.
- Let the operator ask Abra to remember or revise a lesson, or choose **Remember for…** on a selected Thoughts excerpt. Show whether the destination is a named repository or all projects. Share the selected wording independently of work intake. The Memos notebook stays private.
- Ship a package-owned `abra-memory` skill covering retrieval before repeating work, checking sources, reporting a verified lesson, linking a correction to an existing revision, and proposing a reusable procedure through ordinary development work.

## Capabilities

### New Capabilities

- `agent-memory` covers deployment, scoped notes and citations, reliable publication, and promotion from Thoughts or evidence-backed work.

### Modified Capabilities

- `worker-policy` gains optional, assignment-scoped memory reads and role-specific operating guidance.
- `project-leads` gains memory lookup through the existing management action for one authorized repository at a time.

## Impact

Changes touch personal settings and setup in `packages/runtime`, typed contracts, the OpenCode tool/authorization paths, `packages/agents` definitions and bundled skills, the existing Thoughts view, and operator verification. Build on the existing MCP SDK, `PersonalThoughts.get`, durable request identity pattern and authenticated workspace command path. The in-flight `add-memos-thoughts-inbox` change supplies the notebook contract. The new promotion behavior belongs to `agent-memory` and also works with zero issues.

## Scope and Choices

Use one operator-enabled local provider per installation. Pin Basic Memory 1.0.0 and document an isolated install on Linux and macOS. Launch the installed executable on demand with an explicitly local configuration. Persist the vault, project mappings and private provenance independently of process lifetime. Keep SQLite work status, OpenSpec planning and OpenCode sessions with their existing owners. [Local installation](https://docs.basicmemory.com/local/local-install) · [Provider configuration](https://docs.basicmemory.com/reference/configuration)

Use text search as the dependable baseline and allow hybrid lookup with locally provisioned models. Upstream supports project-qualified search, compact hits, explicit target paths and revision-checked writes. Verify these against the pinned binary before wiring tools. The same-user Apply shell retains its existing trusted-process boundary. [Basic Memory MCP contract](https://docs.basicmemory.com/reference/mcp-tools-reference)

Workers can cite and recommend a lesson in their existing reports. An operator-directed save through Abra publishes it. Runtime skill promotion follows the usual reviewed package change. Automatic transcript ingestion, cloud routing, a graph service, fleet-wide notebook access and autonomous skill installation are outside this change.
