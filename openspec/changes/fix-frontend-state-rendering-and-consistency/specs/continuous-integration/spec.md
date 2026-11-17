# Spec Delta

## ADDED Requirements

### Requirement: Enforce frontend correctness in normal contributor checks

Normal contributor validation SHALL check frontend hook ordering and dependencies, render purity, unsafe state synchronization and actionable accessibility violations across both applications and shared presentation. Known valid exceptions SHALL have narrowly scoped explanations. Global disables or automatic fixes MUST NOT conceal defects or weaken existing Effect and package-boundary checks.

#### Scenario: Contributor introduces a hook or render defect

- **WHEN** a frontend edit introduces invalid hook usage, an unexplained dependency omission or an impure render operation covered by the configured rules
- **THEN** the normal static check fails with an actionable source location

#### Scenario: Contributor introduces an inaccessible action

- **WHEN** a covered owned control loses its accessible name or another enforced accessibility rule is violated
- **THEN** normal validation fails instead of requiring a separate audit command

#### Scenario: Accessible scroll region needs a justified exception

- **WHEN** a keyboard-scrollable region or reusable primitive triggers a rule that does not represent an accessibility defect
- **THEN** a narrow documented exception preserves its intended behavior while unrelated rule violations still fail

### Requirement: Exercise frontend setup and cleanup diagnostics

Supported development entries SHALL exercise repeated render and effect setup/cleanup diagnostics. Subscriptions, generated-view processors, timers, pending reads and local persistence SHALL remain correct across that lifecycle and source refresh. Diagnostics MUST NOT duplicate submissions, form replies, native Stop requests or active observers, and disposal MUST NOT stop native work.

#### Scenario: Development lifecycle repeats setup and cleanup

- **WHEN** the workspace is mounted under development diagnostics and a generated surface replaces a revision
- **THEN** the active view remains usable with one active observer per owner and no disposed processor reused as the current view
- **AND** timers, listeners and reads from retired owners are released

#### Scenario: Hot refresh occurs while input is being edited

- **WHEN** supported frontend source refresh occurs with a composer draft, native form edits and retained selection
- **THEN** the documented development flow preserves their supported state without replaying admission, replies or tool calls

### Requirement: Verify presentation with behavioral geometry and style assertions

Frontend acceptance SHALL cover shared widgets in live, frozen and portable hosts at desktop, 375px and 390px widths in both themes. Regressions SHALL assert relevant computed typography, geometry, selected states, editing and retry behavior in addition to retained screenshots. A visible component or passing export build alone MUST NOT establish readable rendering.

#### Scenario: Widget title is constrained to a decorative column

- **WHEN** a layout regression makes an offline task title occupy a 7px column
- **THEN** the portable catalog acceptance fails even if all expected text exists and the HTML build succeeds

#### Scenario: Vendor reset replaces owned typography

- **WHEN** a vendor style resets owned heading size, weight or font family
- **THEN** computed-style acceptance fails in the affected ordinary or portalled host

#### Scenario: Input or retry behavior regresses

- **WHEN** typed custom-choice newlines disappear, a supported date-time default renders empty or evidence refresh no longer retries failed diagram preparation
- **THEN** the corresponding user-interaction acceptance fails with the observed mismatch

### Requirement: Enforce the complete initial JavaScript budget

Production browser acceptance SHALL measure the complete initial script and modulepreload graph for fixed empty-chat and populated-chat fixtures under the same toolchain and compression settings. This change SHALL reduce total initial gzip JavaScript below its matched baseline and retain a checked-in ceiling. Later checks SHALL fail when that ceiling is exceeded.

#### Scenario: Main entry is split into several eager chunks

- **WHEN** a build moves code from the main entry into eagerly requested shared chunks
- **THEN** all those bytes remain included in the measured total and splitting alone does not count as a reduction

#### Scenario: Optional capability is deferred

- **WHEN** optional report, Markdown or diff code is removed from an unnecessary initial path
- **THEN** matched initial totals decrease and opening the capability still proves its supported behavior, pending state and failure recovery
- **AND** no supported renderer is removed or replaced solely to meet the budget

#### Scenario: Verification machine differs from the audit machine

- **WHEN** final performance evidence is collected
- **THEN** it records the supported Node/pnpm versions, source identity, fixture, compression, graph and actual before/after totals
- **AND** the earlier audit's unsupported Node version and individual chunk sizes are not treated as a comparable baseline

### Requirement: Prove long-conversation render locality

Frontend performance acceptance SHALL distinguish deterministic message-render work from elapsed latency using a retained long-conversation fixture. Composer edits and single-message updates SHALL be checked independently. A reduction obtained by omitting history, disabling tools or removing accessibility MUST NOT count as success.

#### Scenario: Composer editing is measured

- **WHEN** acceptance types 100 characters with 1,000 retained messages loaded
- **THEN** unchanged historical message-content render counts remain unchanged and measurements identify the fixture and command
- **AND** draft persistence, focus and submission recovery remain independently verified

#### Scenario: History and streaming are measured

- **WHEN** acceptance appends one streaming update and loads another history page
- **THEN** unchanged message contents avoid a whole-transcript render, message order and anchors remain correct and older content stays reachable
