# Browser parity and terminal presentation retirement

## Frontend performance and rendering acceptance

Run the production browser fixture with the pinned toolchain from `mise.toml`:

```sh
mise exec -- pnpm web:build
ABRACODE_TEST_EVIDENCE_DIR=/tmp/abra-frontend-final \
  mise exec -- pnpm test:one packages/runtime/tests/e2e/frontend-performance.test.ts
```

The fixture opens separate empty and 1,000-assistant-message contexts, waits for
the composer and populated Markdown, counts every fetched JavaScript asset
(including eager shared/modulepreload chunks), and compresses each response with
`node:zlib`'s default `gzipSync`. AG-UI retains an open stream, so network idle is
not used as a readiness signal. React's DevTools commit hook counts performed
work on content-bearing boundaries before/after 100 typed characters and one
streamed message update. Counts and typing latency are separate observations;
multiple nested content boundaries can contribute to one message's count.
The actual supported renders remain mounted, rather than replacing Markdown
with a measurement stub. No typing operation submits a prompt.

Before product edits, run the same command with
`ABRACODE_FRONTEND_BASELINE=1` to record existing work without enforcing render
locality. This is a baseline-capture mode, not an acceptance substitute. Evidence
records Node/pnpm versions, Git source and tracked diff, exact asset paths and
byte/gzip totals, per-content render counts and timing. Place it outside fixture
roots; registered teardown closes only owned browser contexts and HTTP scope.

The 2026-11-17 pre-edit baseline used Node 26.13.0/pnpm 12.21.0. Empty chat loaded
542,534 gzip bytes; populated chat loaded 754,623. The 1,000-message probe counted
7,000 initial content-boundary renders and 207,000 after typing, taking 6,030.6ms
on that run. Timing is descriptive, not a portable pass threshold. Retained raw
evidence is `/tmp/abra-frontend-apply-20261117/baseline-corrected/frontend-performance.json`.
These baseline results establish neither final acceptance nor native authority.

The commit probe compares fiber identity with the preceding committed tree in
addition to the performed-work flag; reused unchanged fibers can retain that flag.
The corrected baseline was recaptured from a disposable archive of the recorded
source commit, using the same fixture and toolchain. The earlier count-only
scratch baseline is superseded. Current proof records 3,000 initial content
boundary renders, the same 3,000 after typing, four additional boundary
renders for the changed message only, and three for the newly appended message.
A native recent-window rollover retains 1,001 loaded messages and unchanged
historical identities. Latency on the final full-suite run was 879.2ms;
this remains descriptive, not an enforced timing threshold.

[The checked-in budget](frontend-budget.json) caps complete initial gzip JavaScript
at 536,000 bytes for empty chat and 748,000 for 1,000 messages, both below the
matched baseline. The final run observed 535,030 and 747,125 bytes. The normal
E2E project (included by `pnpm test:all`) enforces it and checks that every declared
script/modulepreload is counted. Update the ceiling only after retaining a new
complete graph and explaining an intentional capability change; renaming/splitting
eager chunks or excluding preloads is not a reduction. The metadata split and
conditional attention UI remove actual eager paths; renderer capabilities remain.

Offscreen containment keeps historical controls mounted and text in the DOM.
Geometry assertions wait for Markdown and painted content before recording a
reading position, rather than comparing provisional offscreen size estimates.
Browser-find, keyboard navigation, history anchors and narrow layouts must remain
in acceptance; DOM presence alone is not an accessibility proof. Browsers without
`content-visibility` support retain the ordinary fully rendered transcript.

The new focused pre-edit regressions reproduced the audit on this source:
`web-coherence.test.ts` observed custom text `alphabeta` instead of two lines,
an empty ISO date-time default, and a 14px/400 heading; `mermaid-views.test.ts`
timed out after an evidence refresh left the failed preparation unretried;
`react-report-export.test.ts` rejected the offline card title's 7px column.
`web-native-form.test.ts` also rejects normalization until custom empty/repeated
values are handled before selection constraints. Logs are retained alongside
the baseline in `/tmp/abra-frontend-red-{forms,dates,rendering,normalization}.log`.

The browser is the work presentation surface. The native CLI still attaches to the retained Abra session; its own UI and transitive terminal dependencies belong to OpenCode. AbraCode no longer registers a custom sidebar, footer, work panel/route or terminal commands. This change preserves native observation/RPC, documents/diffs, classification, invalidations and controller gates.

This map transfers the behavior previously exercised in `tests/tui/sidebar.ts`. Native lifecycle/authority tests remain required alongside browser DOM tests; removing a renderer does not remove its underlying obligations.

| Retained behavior                                                                                       | Browser/native proof                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current work, priority, closed history, search and repository filters                                   | `web-coherence.test.ts`: chat/finder paging; fleet/project totals; `work-discovery.test.ts` and `fleet.test.ts`: complete-population counts and completion timestamps               |
| Running, native queued, capacity, dependencies, human/supervisor and unknown activity                   | Browser fleet/project totals and owned-session tests; `fleet.test.ts`, `supervision.test.ts`, `visibility.test.ts`: exclusive classes, coverage and blockers                        |
| Attention beyond the loaded page, plan approval without incidents, handled/superseded history           | `work-attention.test.ts`, finder/fleet tests and zero-task lead attention browser test                                                                                              |
| Decisions, expired waits, ownership and exact current approval links                                    | Browser typed communication and policy-specific planning; `web-checkpoints.test.ts`, native `workspace.ts`: stale Git approval rejection and form recreation                        |
| Unanswered recovery after worker failure/restart, zero/one attempt, admission versus response           | Browser typed communication; `response-recovery.test.ts`; real native `reply-recovery.ts`/`crash-windows.ts` and retained message projections                                       |
| Markdown plans, custom artifact paths, lightweight/research scope, independent cleanup/delivery/closure | Browser policy-specific planning; `visibility.test.ts`, `delivery-outcome.test.ts`, `finishing-decisions.test.ts`                                                                   |
| Read-only native session tools/history and queued/unavailable state without a worker composer           | Browser owned-session paging and updates; `web-worker-history.test.ts`; native `workspace.ts` reads retired worker history                                                          |
| PR/external checks, uncertain actions, unsubmitted preflight, pending reviewers and stale observations  | Browser typed-reviews pagination and retained-review-actions tests; `action-*.test.ts`, `pr-feedback.test.ts`, native external validation journeys                                  |
| Lead scope, enabled/stopped/recovery/session state, unanswered requests, proposals and assigned work    | Browser Activity/disabled-lead history and zero-task attention tests; `lead-observation.test.ts`, `leads.test.ts`, native `leads.ts`                                                |
| Safe documents and historical changes                                                                   | Browser Pierre/navigation/policy tests; real Git `ticket-diff.test.ts`, archived-plan visibility tests                                                                              |
| Lazy immutable reports, legacy HTML and optional portable exports                                       | Browser artifact-page/chat/canvas tests; JSON publication/legacy unit tests; React report integration and native workspace/research journeys                                        |
| Focus, Back/reload, narrow layout, themes, draft/chat scroll and text input                             | Browser finder, inspector, stale-selection, forms and tool-card tests at desktop/375/390px; development HMR journey                                                                 |
| Offline freshness, late responses, reconnect and missed events                                          | Browser observation-outage, selected-off-page and late-response tests; retained values remain labeled and use the server fallback                                                   |
| Disposal and service lifetime                                                                           | Fixture close scopes dispose HTTP/AG-UI/browser resources; `web-agent.test.ts` cancellation; real installation/development/workspace shutdown preserves native sessions and service |

## Reconciliation with harden-operational-maturity

The active change's Native Work requirements are carried forward through native-backed browser reads. Its planning artifacts remain unchanged. No native/controller authority moves into React.

| Required scenario                                            | Preserved behavior and proof                                                                                                                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native session idle with pending inbox work                  | Owned sessions and typed communication show queued/unanswered work; native idle is not a correlated answer. Browser sessions/communication tests and native recovery journeys cover it.             |
| Message history exceeds a view bound                         | Communication pages 20 entries with totals/continuation and worker transcripts page 8. Browser pagination and shared native contract tests cover both.                                              |
| Reminder admitted but unanswered                             | Recovery retains attempt one of one, original response requirement and transport status. Browser communication and `response-recovery.test.ts` retain that distinction.                             |
| Worker asks for input                                        | The existing decision key/generation routes to its retained question/current native form. Browser communication and checkpoint tests prove there is no duplicate question or read-triggered reply.  |
| Several tasks need different management actions              | Fleet classes and compact task cards preserve blockers and independent outcomes. Browser finder/fleet/policy tests plus native supervision/attention tests cover them.                              |
| Native evidence unavailable                                  | Last data/obligations remain visible with stale/unavailable native activity; no successful or idle inference. Browser outage and worker-history tests cover this.                                   |
| Fleet mixes running, native queue, capacity and dependencies | Finder totals and project breakdown display separate counts; task rows retain wait reasons. Browser fleet/project and native fleet classification tests cover this.                                 |
| Closed-history page changes                                  | Fleet/completed-today use complete retained population and timestamp/day boundary, independent of visible rows. Browser fleet paging and native fleet tests verify stable counts.                   |
| Attention exists off page                                    | The persistent dock uses aggregate attention, not finder membership. Unit attention tests and browser off-page/zero-task lead cases verify coverage and truncation.                                 |
| Lead has pending work or becomes disabled                    | Scoped lead evidence remains lazy/read-only with historical requests and accepted-work links after disable/scope change. Browser Activity/lead attention and real native leads journeys cover this. |

Additional report/PR management shortcuts are not introduced by this parity work. Human-owned approvals use existing native forms; conversational requests return to Abra. See the [verification recipe](README.md) for required complete checks and the limits of deterministic-provider proof.

## Integrated acceptance on 2026-11-16

The required checks passed: `pnpm check`, 560 unit/integration tests in 95 files, 27 end-to-end tests in five files, build, configuration schema, license evidence and strict OpenSpec validation. The fresh frozen installation attaches/reattaches to the native Abra without a custom TUI export and preserves service/session state after frontend shutdown. Native workspace acceptance saves JSON, explicitly exports HTML without a provider call, restarts, reopens the exact export and frozen pending checks, and inspects owned sessions/decisions/communication/checks through typed routes.

Retained proof lives under `/tmp/abra-frontend-coherence-20261115/`: `current-goal-verification.json` maps commands, exits and log digests; `browser-native-acceptance.json` records browser cases and screenshots; `final-acceptance/` retains the full run’s screenshots, portable JSON/HTML and three native journey JSON results, each with cleanup complete. `current-final-e2e-fixed.log` records the complete 27-test pass. Earlier failing footer/selector fixtures remain separate and are superseded by that run. The scoped diff review preserves the original dirty baseline and makes no delivery/archive claim.

## Frontend setup acceptance on 2026-11-17

Node 26.13.0 and pnpm 12.21.0 passed `pnpm check`, `pnpm test:all`
(713 tests in 124 files), and all three extended installation, development/HMR
and React report export journeys. License evidence matches 1,374 locked
components and 31 distributed source files; strict validation of
`fix-frontend-state-rendering-and-consistency` passes.

Retained evidence lives under `/tmp/abra-frontend-apply-20261117/`.
`final/frontend-performance.json` records the complete graphs, frontend source
digest, matched render counts and actual toolchain. `final/` retains browser
screenshots and the native workspace journey's passing cleanup receipt;
`final-rendering/` captures the live catalog after scrolling the cards into the
transcript's reading area. `final-extended/` retains desktop/narrow light/dark
portable screenshots and JSON proof of offline HTML, an empty external-request
list, opaque-frame isolation and the development journey's cleanup receipt. That
journey preserves draft/form edits and selection across HMR, observes one active
HTTP observer and leaves the native session usable after shutdown.
`final/verification.json` maps command exits and log digests. Owned generator and
baseline source copies were removed; measurements and logs remain outside them.
The failed/interrupted intermediate runs are superseded by these named passing
runs, rather than being counted as successful acceptance.
