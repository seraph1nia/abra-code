# Workspace navigation and search

Compare the [UI inventory](../design/workspace-layout/index.html) and [interactive mockups](../design/workspace-layout/mockups.html) with the working routes. The [workspace guide](../web-workspace.md#search-work-and-commands) lists the search owners, coverage and commands.

## Reproduce the layout checks

Build the frontend with `pnpm web:build`. Run the focused browser suites against disposable loopback workspace fixtures.

```sh
pnpm test:one packages/runtime/tests/e2e/web-coherence.test.ts packages/runtime/tests/e2e/inspector-observation.test.ts packages/runtime/tests/e2e/thoughts.test.ts packages/runtime/tests/e2e/frontend-performance.test.ts
```

For interactive capture, use a task-owned agent-browser session and the [browser prerequisites](../operations.md#browser-cli). Save a snapshot once the named control or result appears. The fixtures use synthetic task text, sessions and conversations. Use the [Memos journey](memos-thoughts.md) for the actual notebook, native admission, guarded intake and reverse lookup.

| Journey                 | Steps and observations                                                                                                                                                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty phone Chat        | At 390 × 844, open Chat without registered projects. Check Add a project beside the composer, Search and Attention in the header, and the four bottom destinations. The measured navigation targets were 44 px high and the composer input was 16 px.                                                                |
| Keyboard-sized viewport | Open Search from Settings at 390 × 450. The picker occupied the visible 390 × 450 area and focused its query. Escape restores the trigger. Exercise a native form edit across a Settings visit and an incoming message.                                                                                              |
| Desktop evidence        | At 1440 px, open a task in Work. Visit Plan, Verification and Diff. Type and send a question about source.ts. Keep the rendered patch and the admitted message in the same snapshot. Cross 1251/1250 and 761/760 with the same route and draft.                                                                      |
| Shared divider          | Open Plan and a worker transcript in two tabs on the same origin. Adjust the focused divider on Plan. The initial chat width was 61%. After one left-arrow step both tabs showed 56% chat and 44% reader. The browser suite also covers pointer dragging, reload, a separate profile and invalid or blocked storage. |
| Session search          | Enter `session:review` and choose the result identified by session, role, task and repository. Open the exact worker message beside the live main composer.                                                                                                                                                          |
| Thought and commands    | Start a draft, open Thoughts, select a memo and choose **Ask Abra about this**. Inspect the draft and its original link. Compare **add project** in Search and selecting **/onboard-repo** in the composer. Each prepares an editable message. An explicit Send admits it.                                           |
| Theme and focus         | Choose Light, Dark and System in Settings → Appearance and compare foreground and canvas. Check keyboard focus on the divider, its announced range, Search dismissal and the phone destination links. Palette and form content use the existing shared theme.                                                        |

Run `pnpm check`, `pnpm test:all` and `pnpm licenses:check` for final verification. The frontend performance suite checks the shipped assets and exercises both empty and populated transcripts.

Phone dimensions and accessibility-tree observations here come from Chromium. Physical iOS/Android software keyboards, hardware screen readers and their spoken output were not exercised.

## Run on 22 November 2026

`pnpm check`, strict OpenSpec validation and the license inventory check passed. The final `pnpm test:all --maxWorkers=2` passed all 924 tests across 148 files, including the frontend performance budgets and native workspace journey. Two workers kept the complete suite within individual test timeouts on this host. The separate disposable Memos journey passed. Measured contrast between body text and canvas was 14.56:1 in Light and 14.48:1 in Dark. System resolved to Light in the capture browser.
