# Tasks

## 1. Open and dismiss Search across workspace routes

- [ ] 1.1 Compose the shared shadcn Base UI Dialog with an inline, open Autocomplete list. Wire a single palette into the web shell with a visible Search button, platform shortcut hint and phone tap target. In the existing web coherence suite, exercise both shortcut variants, touch on a direct Settings subpage, keyboard highlight, Enter, Escape and focus restoration. Check that another modal keeps keyboard ownership and that loading Settings alone does not bootstrap Chat. Document the entry points in `docs/web-workspace.md`.
- [ ] 1.2 Connect Chat, Work finder and Settings destinations through existing navigation. Check desktop and phone selection, Back/Forward after navigation, and cancellation from a populated composer without an extra history entry, lost attachment, scroll jump or prompt submission.

## 2. Search retained work and continue in the finder

- [ ] 2.1 Give an exact issue ID precedence before pagination in the SQLite discovery query. Keep existing filters, totals, offsets and priority/ID ordering among remaining matches. Exercise the existing discovery tests with an exact closed issue preceded by more title matches than the page limit, and verify successive pages contain every match once.
- [ ] 2.2 Query the existing bounded finder read for nonempty search text across all projects and states. Debounce input, respect the discovery query bounds, show project and status, and open the selected task through the existing inspector navigation. Verify partial titles, pasted IDs, delayed responses, empty and failed reads, and selection of a task outside the bootstrap list in the browser suite.
- [ ] 2.3 Pass the current query to the full finder when **See all results in Work** is selected. Apply all projects, all states and the first page together. Verify the handoff from Settings and from a finder with different filters, then verify the filters remain editable. Document the search scope and handoff alongside the existing finder guidance.

## 3. Resume inspection and reach pending decisions

- [ ] 3.1 Derive Plan, Diff, Verification and Reports commands from the selected task and show its title on each row. Reuse the exact Canvas selection remembered for this tab and session for the empty-query resume command. Test all four destinations, resuming a specific file, and opening Search in a session with no saved target.
- [ ] 3.2 Use the workspace’s pending human decisions to offer **Review pending decisions** and open Attention. Verify applicable and absent suggestions, preservation of edits to a current form and zero decision submissions from the palette. Document the review and resume commands in the workspace guide.

## 4. Verify the integrated journey

- [ ] 4.1 In a disposable workspace, follow the project browser verification recipe on desktop and at phone width. Start with a draft and attachment, search for a task, inspect its diff, return to Chat, and check the draft, focus and transcript anchor. Retain the steps and snapshots. Run `openspec validate add-workspace-command-palette --strict`, `pnpm check` and `pnpm test:all` before handoff.
