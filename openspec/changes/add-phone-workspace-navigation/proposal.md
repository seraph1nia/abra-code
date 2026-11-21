# Proposal

## Why

On a phone, the common task is to send Abra a prompt, glance at the evidence behind a reply, and continue the conversation. The current narrow layout opens work and inspection in sheets, and Settings has its own route. Moving between them should feel like moving around one conversation.

## What Changes

- At the existing phone breakpoint (760 CSS pixels and below), show one destination at a time beneath a compact **Chat | Canvas | Settings** bar. Open Chat on an ordinary visit. Honor direct links to evidence and Settings.
- Give the transcript the available height and keep the composer and its primary action reachable when the keyboard opens. Keep connection state and pending human decisions available from Chat.
- Open evidence from a message directly in Canvas. The Canvas button recalls the last inspected item in this tab and Abra session, or opens the Work finder on first use. Let the user choose other work from Canvas. **Ask Abra** returns the selection to the same draft for editing.
- Make the phone experience reproducible on a development machine with a documented portrait browser preview and a repeatable browser journey.

## Capabilities

### New Capabilities

### Modified Capabilities

- `work-visibility` gains chat-first phone navigation, continuity between destinations, and keyboard-aware composition.

## Impact

The changes center on the React workspace shell, TanStack Router routes and search state, the inspector and finder wrappers, workspace CSS, and the existing browser coherence suite. The current composer, evidence renderers, session and submission APIs already supply the underlying interactions.

## Scope and Choices

Use available width to select the layout automatically. A narrow desktop window and a phone running the same build should expose the same navigation. Reuse the existing tablet sheet and wide split-view behavior above the phone breakpoint.

The URL identifies the active destination and exact evidence. Keep the last inspected target separately as a per-tab, session-scoped return location. A shared navigation layout across the workspace and Settings routes must preserve the draft, attached evidence and transcript anchor, including when a reply arrives while reading Settings. Keep a direct Settings visit independent of chat initialization.

Use desktop emulation for layout, touch navigation and reduced viewport height. Identify on-device keyboard and safe-area behavior separately in verification. Network access from a phone, including tunneling, is deferred. The separate dictation proposal can use the same composer independently.
