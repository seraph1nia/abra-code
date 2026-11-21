# Proposal

## Why

Someone drafting a message to Abra may need to check a task’s diff or revisit a pending decision before continuing. A searchable command palette shortens that trip and gives keyboard and touch users the same way back to their work.

## What Changes

- Open Search from the workspace or Settings with ⌘K on macOS, Ctrl+K on Windows and Linux, or a visible button. Focus the search field on open and return focus on dismissal.
- Find active and closed local tasks across projects by title or issue ID. Put an exact ID first, show project and status, and carry the query into the Work finder when the user chooses **See all results in Work**.
- Offer **Return to chat**, **Open Work finder**, and **Open Settings**. For the selected task, offer Plan, Diff, Verification and Reports with its title. Before typing, surface pending decisions and the last inspected item when available.
- Open the existing Attention view for decision review. Preserve the user’s draft, attachments, form edits and transcript position throughout navigation.

## Capabilities

### New Capabilities

### Modified Capabilities

- `work-visibility` gains keyboard and touch access to work search, contextual inspection and decision review from the web workspace.

## Impact

The shared presentation package supplies the shadcn Base UI Dialog and inline Autocomplete composition. The web shell owns the trigger and shortcut across workspace and Settings routes. Selection reuses the existing router, inspector, Attention panel and session-scoped Canvas destination. The Work finder gains a way to accept a palette query.

## Scope and Choices

Use the existing bounded work discovery read. Its SQLite ordering currently uses priority and ID, so exact-ID precedence must apply before the result limit. Preserve priority and ID order among other matches. Keep GitHub browsing, project filters and fleet details in the full finder.

Keep the palette transient. Only choosing a destination changes navigation. Keep direct Settings visits independent of chat bootstrap, and let an already-open modal own keyboard input. On phones, provide Search alongside the existing Chat, Canvas and Settings navigation.
