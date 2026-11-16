# Proposal

## Why

The frontend audit reproduced unreadable offline Kanban cards, vendor CSS overriding owned typography, destructive multiselect editing, invisible date-time defaults and diagram failures that evidence refresh cannot retry. The shared component migration also left generator, theme, React-check and rendering-performance gaps that passing flow tests do not detect.

## What Changes

- Correct shared widget layouts and move shared presentation styles out of web-only CSS. Exercise every catalog widget in live, frozen and portable hosts, including disabled navigation and legacy HTML previews.
- Restore owned typography and semantic theme precedence across workspace and portals; initialize theme before first paint; standardize status colors, tab states, fonts, Lucide icons and the report theme control.
- Preserve raw custom-choice text until answer preparation and implement explicit date-time display/serialization semantics without changing native form definitions or bindings.
- Route exact diagram preparation through the existing typed HTTP atom boundary with deduplication, cancellation and working retry. Use mutation results directly where export UI currently duplicates them in React state.
- Isolate composer updates from transcript rendering, index message associations, preserve historical message state and skip offscreen historical rendering work. Measure and reduce the complete initial JavaScript graph, then enforce a reproducible budget.
- Repair shadcn monorepo configuration; enforce relevant React/hooks/accessibility checks and exercise effect lifetimes under development StrictMode. Remove unnecessary state synchronization without replacing valid DOM, subscription or transport effects.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `application-branding`: Consistent owned theme, typography, icons and component-source ownership across web and portable presentation.
- `work-visibility`: Lossless form editing, recoverable exact diagram requests and isolated conversation rendering.
- `report-template`: Readable shared catalog widgets and usable isolated HTML previews across live/frozen/portable hosts.
- `continuous-integration`: Enforced React correctness and reproducible visual, lifecycle and performance acceptance.

## Impact

Affected owners are `apps/web/src/{workspace,use-workspace,data,main,theme,attention,request-state,diff-renderer,inspector}.tsx` and their actual `.ts` counterparts, `workspace-state/`, presentation actions, `apps/web/components.json`, `packages/presentation/src/{ui,styles,tokens,surfaces,diagrams,work-widgets}`, `apps/report/src/`, package manifests/exports, Vite/lint/build configuration, notices and frontend/testing/verification documentation. Reuse existing typed endpoints and disposable browser/export/development fixtures. No server payload, durable report schema or controller policy change is planned.

## Scope and Choices

### Current source and specification ordering

Build on the current working tree, including completed but unsynced `make-chat-the-primary-workspace`, `strengthen-opencode-agui-and-surface-bindings` and `enable-mermaid-rich-reports-and-dashboards`. Canonical report requirements still describe retired manual TSX authoring; those changes already replace that behavior. This change adds narrowly named requirements and does not restore that pipeline, duplicate their new capabilities or rewrite their deltas. Reconcile application order before eventual sync/archive. Preserve unrelated concurrent controller work.

### One presentation owner

`@abracode/presentation` owns primitives, widget layout, reusable semantic classes, tokens and icon exports. App CSS owns shell layout. Keep Base UI-backed shadcn components and valid native select/details/table elements; add no second primitive library. Narrow vendor reset scope or precedence rather than accumulating element-specific overrides. Use the existing system font stack consistently and remove the unloaded DM Sans promise; introduce no remote font dependency. Keep verified diagram canvases explicitly light with readable framing in dark mode, rather than recoloring captured SVG. Ordinary status colors use shared light/dark semantic tokens.

### State and request ownership

Typed resource atoms own request/result state; the native observation adapter owns AG-UI ordering, reconnection and admission evidence. Local edits/disclosures remain local, derived values are computed, and effects retain real external-system synchronization with cleanup. Split composer subscriptions from transcript subscriptions. Where Ask actions need cross-component draft writes, use one registry/session-scoped draft atom with setter-only callers; preserve existing storage bounds and recovery identities. Export preview remains local while export pending/error/result comes from its mutation atom.

The web host supplies an exact, typed diagram-resource adapter to shared presentation; portable callers supply prepared assets and never acquire a live client. Retry targets the selected resource and cannot substitute a newer revision, recapture evidence or admit a prompt. Do not replace the existing optional Streamdown chat Mermaid implementation or the trusted server compiler.

Custom multiselect editors retain raw newlines, duplicates and caret position until submit-time normalization. Offset-bearing date-time defaults display the same instant in browser-local time with an explicit timezone label; an untouched field submits its original value. Edited valid local values serialize to ISO with an explicit offset/UTC; reject impossible local times instead of silently normalizing them. Existing zone-less supported values retain their documented local interpretation. No native schema migration is needed.

### Performance and proof

Use stable message identities, memoized unchanged message boundaries and preindexed associations. Apply offscreen containment to historical messages while keeping their mounted controls and browser find/accessibility behavior; do not silently discard history, native forms or edits. Verify render locality with deterministic counts separately from browser latency.

Before implementation changes, capture the initial empty-chat and populated-chat script/modulepreload graph with the supported pinned toolchain. Reduce total initial gzip JavaScript against that matched baseline, remove proven unnecessary eager imports, and retain a checked-in byte ceiling for the resulting complete graph. Never pass by renaming chunks, excluding preloads or dropping supported Markdown/diff/report behavior.

The earlier audit's 694 passing tests, extra export pass and scratch screenshots establish symptoms, not final acceptance. Reproduce focused failures, add meaningful assertions for geometry/computed styles and retained state, then run `pnpm check`, `pnpm test:all` and relevant extended offline/HMR/native-boundary journeys on final source with Node 26.4+ and the pinned pnpm. This planning request grants no implementation, service restart, lifecycle, publication or delivery authority.
