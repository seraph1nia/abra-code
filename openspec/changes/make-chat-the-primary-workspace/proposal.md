# Proposal

## Why

AbraCode's interface exposes projects, workflow internals, generated views and eight inspector tabs as competing destinations. The operator wants one Abra conversation with concise typed answers, direct read-only inspection, and reports retained as data plus A2UI rather than a second UI application.

## What Changes

- Make chat the permanent primary surface. Put task cards, decisions, useful tool results, generated A2UI and report attachments in the producing conversation, with an optional compact work finder and one inspector/canvas.
- Preserve native message/tool identities and ordering through AG-UI. Use CopilotKit's render-only facilities for existing OpenCode tools; keep OpenCode's model/tool loop and controller authorization intact.
- Render minimal typed task, decision, communication, worker and review/check summaries. Load full evidence lazily, with pagination, observation times and explicit unavailable/stale states. Reuse backend supervision instead of inferring activity from issue status or incident-array length.
- Add validated local navigation references for tasks, sessions, decisions, changes and artifacts. Use a shared desktop side panel/mobile sheet with history/deep links; instructions continue through Abra and human answers through existing native forms.
- Make immutable, versioned data-plus-A2UI JSON the canonical format for new generated report artifacts. Freeze all data needed to render a report and retain provenance, source references and exact message/tool association. Distinguish saved reports from live views.
- Use the same React catalog in chat, canvas and snapshot viewing. Keep portable self-contained HTML as an explicit optional export from a saved snapshot, with local interactions and no controller dependence. Preserve existing HTML artifacts and research Markdown acceptance evidence.
- **BREAKING:** retire the Solid report authoring/compiler pipeline and its manual-template-first workflow after the shared React snapshot/export path is verified. Existing retained artifacts remain readable without conversion.
- **BREAKING:** remove AbraCode's custom TUI plugin, sidebar, panels, commands and renderers after web inspection parity is verified. Preserve shared observation services, the native runtime and operator CLI operations.

## Capabilities

### New Capabilities

- `chat-workspace`: Conversation-first navigation, typed inline tool/UI attachments, shared read-only inspection, bounded detail loading and validated local drill-down actions.

### Modified Capabilities

- `work-visibility`: Move supported presentation to the browser, expose minimal typed evidence and accurate attention/activity, preserve policy/delivery/capacity/lead inspection, and remove terminal-specific navigation requirements.
- `report-template`: Replace manual Solid report authoring with immutable A2UI snapshot documents and shared React rendering; retain publication identity, restart/retirement durability, legacy HTML viewing and optional offline HTML/feedback export.

## Impact

- Frontend: `apps/web/src/workspace.tsx`, `use-workspace.ts`, `data.ts`, `navigation.ts`, `inspector.tsx`, `surfaces.tsx` and shared components. Build on the current uncommitted Markdown, Pierre diff, Effect atom, Base UI and responsive-navigation work; do not restart that refactor.
- Transport/data: `src/web/{backend,agent,wire,workspace-wire,http-api,protocol,gateway,render-tool,catalog,surfaces,surface-records}.ts`, existing visibility/RPC/query services, and typed resource/presentation contracts.
- Reports: `src/workflow/{report-contracts,report-snapshot,reports,visual-reports,report-build}.ts`, versioned retained records and `templates/reporter`; preserve research acceptance and delivery gates.
- Removal/package work: `.opencode/plugins/abracode/tui.ts`, terminal-only `src/visibility` files and tests, plugin exports, Vite pack entry, direct Solid/OpenTUI dependencies where no longer used, license inventory, operator/frontend/API documentation and disposable browser/native journeys.
- This proposal authorizes no implementation, work execution, plan/merge approval, service restart, delivery or retained-resource deletion. Registered implementation continues through Abra's existing controller checkpoints.
