# Tasks

## 1. Share phone navigation across workspace and Settings routes

- [x] 1.1 Add the compact navigation at the existing 760 px width boundary in the React shell and TanStack Router. Derive the current destination from the URL, including a bookmarkable finder state for Canvas with no selection. Keep both Settings routes directly loadable. In the existing web coherence suite, check ordinary entry, direct links, reload, Back/Forward and keyboard focus at 760 and 761 px. Document the destinations in `docs/web-workspace.md`.
- [x] 1.2 Preserve the session draft, attachment, pending submission, form edits and transcript anchor across Settings and workspace navigation. Reuse their existing owners and keep optional views lazy. Verify a Settings round trip while another message arrives, and that a direct Settings visit can render independently of chat bootstrap.

## 2. Use the full phone Canvas for discovery and inspection

- [x] 2.1 Reuse the finder and inspector content below the persistent bar. Replace their phone sheet wrappers with a single active content area, keep the nav reachable and inactive contents out of the focus order. Restore the exact validated target from the current URL or last visit as appropriate. Test first use, choosing different work, unavailable evidence, a revision-specific surface link, and resizing back through the existing tablet and desktop layouts. Update mobile sheet assertions in `packages/runtime/tests/e2e/web-coherence.test.ts` to cover the new accessible behavior.
- [x] 2.2 Route evidence attachment and return focus through the active destination. Remove the phone interaction's dependency on finding an inspector inside a dialog. Test following a file link, attaching selected lines with Ask Abra, returning to the original draft, then explicitly sending it once. Verify simply inspecting or going Back makes zero submissions. Document this phone flow alongside the existing canvas guidance.

## 3. Fit chat to a portrait viewport and verify the experience

- [x] 3.1 Size the scrollable transcript and composer for the visible viewport, browser chrome and safe-area insets. Preserve connection and attention access, long multiline editing and busy-state controls. Extend the browser suite at 375 × 812 and 390 × 844 with a reduced-height case, wide message content and a lost-response round trip. Check the visible composer, reachable action, independent transcript scrolling, horizontal overflow and original submission identity.
- [x] 3.2 Add a reproducible desktop preview recipe to `docs/web-workspace.md` using Chrome's device toolbar and the current workspace. Exercise the same Chat → Canvas → Settings → Chat journey in a disposable workspace using the project-local agent-browser CLI and a task-owned session. Retain the steps, snapshots and screenshots per `docs/verification/README.md`. Record which keyboard/inset checks were emulated and any observations from a physical device separately.
- [x] 3.3 Verify the integrated change with the repository testing skill, `pnpm check`, `pnpm test:all` and `openspec validate add-phone-workspace-navigation --strict`.
