# Proposal

## Why

The Work finder puts local tasks, GitHub items, two kinds of state filter, capacity, a personal notebook and administrative links in one narrow column. Finding a known worker or thought still requires knowing its parent, especially on a phone where Canvas can reopen an unrelated inspection.

## What Changes

- Make Chat, Work, GitHub, Thoughts and Attention distinct destinations. Put Settings at the foot of the desktop rail. On phones provide Chat, Work, Thoughts and More, with Search and Attention in the header. Keep one Abra conversation and draft across destinations. On wide desktop every task or evidence selection opens beside the live chat and composer, including selections from Work, global Search, direct links and browser history.
- Give Work its own task list, Sessions, Capacity and Recently inspected. Give GitHub its own filters, cached inventory and linked item reader. Move appearance, licenses and repository onboarding into Settings.
- Give chat and the right reader one draggable, keyboard-adjustable divider. Remember a single reader percentage per browser and app origin across tasks, views, sessions, open tabs and reloads.
- Make ⌘/Ctrl K and touch Search find durable items, workspace destinations and actions. Discover workers across tasks, open exact evidence, identify which sources were searched and keep results usable when a source fails.
- Give palette actions and frequent composer slash aliases one command catalogue. Expose Open, Attach to chat, Prepare draft and Open form as distinct outcomes. Preserve existing text, attachments and submission identity.
- Carry a verified Memos source card through save confirmation, draft, sent question and accepted work. Include a bounded, read-only “Used in work” lookup after the card and work discovery are available.

## Capabilities

### New Capabilities

- `workspace-discovery` covers cross-source search, exact result navigation and shared palette/composer command behavior.

### Modified Capabilities

- `work-visibility` covers collection destinations, responsive evidence navigation, capacity placement, Attention and the relationship between an accepted thought and its source.

## Impact

The routing and composer changes live in `apps/web`. Shared search controls live in `packages/presentation`. New read contracts span `packages/contracts`, the runtime web gateway and the native owners of retained work, sessions and evidence. Existing task discovery, notebook, GitHub, Settings and inspector reads remain the starting points. Add one shared shadcn Base Nova Resizable component for the chat/reader divider. Reuse the installed search dialog, tabs, sheet and form controls for the rest of the layout.

## Scope and Choices

The approved [inventory and layout decisions](../../../docs/design/workspace-layout/index.html) and [interactive desktop and phone mockups](../../../docs/design/workspace-layout/mockups.html) are implementation references. The desktop mockup demonstrates the shared split for every task and evidence entry, including Work and Search. Plan, Diff, Verification, worker sessions, Reports and generated evidence retain the live conversation and composer. Back restores the originating collection. Drag or focus the mockup divider to try the browser-wide preference.

The design supersedes placement described by the active phone navigation, compact header, chat-first workspace, GitHub inbox, Memos inbox and command palette changes. Preserve their source semantics, single native conversation, bound approvals, focus, bookmark, pagination and recovery guarantees. Reconcile overlapping delta headings against the baseline at integration so a later archive cannot reinstate the old finder or phone tabs.

Use authenticated owner-scoped metadata for discovery. Preserve original digests/generations and resolve results again when opening them. The notebook integration uses an AbraCode preview and an original link with the operator’s own Memos login. Full-site embedding and automatic writes back into private notes are outside this change.

### Coordination with `simplify-workspace-theme-and-chrome`

Use the operator-supplied theme brief for the companion task. This layout owns destination names/order, pane geometry, the shared divider, search placement and navigation behavior. The companion owns shared Light/Dark/System colors, a near-black and neutral-grey palette, a small muted forest-green Abra mark, semantic statuses, independent high-contrast focus, type, spacing and idle chrome. Consume shared tokens across web and generated content and keep portable reports legible.

Give the theme task room for a composer-first empty Chat, one compact toolbar, text-labeled destinations, a single active underline, accessible outline icons and removal of the permanent idle caption and zero badge. Keep Search and Attention reachable at zero, show explicit busy/reconnecting/pending states, and use the same Onboard repository action beside an empty installation's composer. Its example phone tabs and the HTML sketches' colors are superseded by the approved destination map and theme brief respectively. Compare both tasks at 390 px in empty Chat and on desktop with a diff beside a populated conversation.
