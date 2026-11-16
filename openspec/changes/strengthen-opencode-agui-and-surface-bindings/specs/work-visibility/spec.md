# Spec Delta

## ADDED Requirements

### Requirement: Reconcile complete browser observation sequences

Browser observation SHALL consistently apply validation, epoch/order acceptance, retired-epoch exclusion, baseline repair and scoped invalidation across explicit refresh and live updates. Overlapping recovery requests SHALL share bounded work. Late or stale responses MUST NOT replace newer valid data, revive retired epochs or duplicate input admission.

#### Scenario: Retired epoch returns through an old baseline read

- **WHEN** the browser accepts a replacement epoch and an earlier baseline read later returns the retired epoch
- **THEN** the newer observation remains current without reviving the old epoch or replaying native input

#### Scenario: Explicit refresh overlaps event-driven recovery

- **WHEN** an explicit refresh and a gapped live update both request a baseline before the first read finishes
- **THEN** recovery coalesces bounded work, validates its result against current observation and applies affected-resource invalidation without duplicate recovery loops

#### Scenario: Baseline repair is unavailable

- **WHEN** live observation requires a baseline but the baseline read fails
- **THEN** the last valid observation remains visibly stale or unavailable and a later valid recovery can restore it without resetting drafts, admissions, history or navigation

### Requirement: Dispose browser observation independently of other owners

Disposing browser observation SHALL release its subscriptions, reconnect timers and pending recovery work and prevent late state or invalidation callbacks. It MUST NOT stop native execution, admit prompts or take ownership of drafts, admission reconciliation, history or navigation. Browser recovery MUST preserve the single server-owned periodic fallback.

#### Scenario: Browser observation is disposed during recovery

- **WHEN** its view is unmounted while a baseline read or reconnect delay is pending
- **THEN** owned work is released and subsequent completion cannot update the disposed view, invalidate queries or stop native work

#### Scenario: Connection recovers while independent UI state exists

- **WHEN** live observation reconnects while an unsent draft, pending admission and inspected resource already exist
- **THEN** recovery restores observation without submitting the draft, duplicating admission, dropping retained history or changing navigation

#### Scenario: Live updates temporarily stop

- **WHEN** the browser remains mounted but no native change events arrive
- **THEN** existing server fallback continues providing bounded freshness without a new independent browser polling loop

### Requirement: Capture each generated widget's selection independently

Each generated work widget SHALL retain its own explicit or unfiltered selection and live/snapshot mode. Capturing one surface SHALL satisfy the union of its bounded data requirements. A sibling widget or navigation link MUST NOT narrow another widget's population. Required explicit identities exceeding the capture budget MUST be refused before publication.

#### Scenario: Snapshot table shares a surface with a task-specific link

- **WHEN** two tasks are observed and an unfiltered snapshot table shares a surface with a report link for only one task
- **THEN** the table captures both tasks and the link retains its own target without narrowing the table

#### Scenario: Widgets use different task filters and modes

- **WHEN** a surface combines unfiltered snapshot work, an explicitly filtered snapshot summary and explicitly filtered live work
- **THEN** each widget resolves its own selection and mode while required captured rows are deduplicated without dropping another widget's requested data

#### Scenario: Explicit requirements exceed the capture bound

- **WHEN** valid individual widgets collectively require more distinct explicit task identities than the supported surface capture budget
- **THEN** publication returns a bounded limit diagnostic and preserves the previous valid surface instead of silently omitting required tasks

### Requirement: Resolve generated live references independently of loaded pages

A generated live widget SHALL resolve its explicitly requested authorized tasks independently of loaded finder, transcript and closed-history pages. Resolution SHALL use bounded summary reads and SHALL NOT load unrelated worker evidence or admit native input. Current values MUST NOT be substituted from a captured snapshot under a live label.

#### Scenario: Referenced closed task is outside the loaded history page

- **WHEN** a valid generated live widget selects a retained closed task outside the workspace's first closed-history page
- **THEN** that task's current summary is rendered without paging the finder or loading unrelated worker transcripts

#### Scenario: Same task appears in multiple mounted widgets

- **WHEN** several mounted generated widgets reference the same task
- **THEN** bounded resolution reuses the current summary observation rather than multiplying identical per-widget reads

#### Scenario: Explicit task cannot be resolved

- **WHEN** a requested task is missing, unauthorized or unavailable
- **THEN** the affected widget identifies unavailable requested data without revealing foreign evidence or reporting an authoritative empty population

### Requirement: Expose generated binding coverage accurately

Generated widgets SHALL distinguish observed rows, requested identities, unavailable data and truncation. Unfiltered summaries SHALL identify their documented population and bounded coverage independently of loaded history pages. Counts computed from incomplete data MUST be labeled partial or unavailable. Missing historical coverage MUST be labeled unknown rather than inferred as complete.

#### Scenario: Unfiltered view exceeds its row budget

- **WHEN** an unfiltered table or summary covers more tasks than can be returned within its binding budget
- **THEN** it reports its returned coverage and known total or explicit unknown total, and any subset count is labeled partial

#### Scenario: Valid reference remains outside the default workspace snapshot

- **WHEN** the workspace's default rows omit an explicitly requested task while a binding-specific read is pending
- **THEN** the widget shows pending or unavailable coverage instead of a zero count labeled as the complete live work graph

#### Scenario: Legacy surface has no coverage evidence

- **WHEN** a supported retained surface contains captured rows without explicit coverage metadata
- **THEN** its original rows remain readable with unknown coverage and are not silently supplemented from current work

### Requirement: Refresh generated bindings without replacing their source mode

Mounted live bindings SHALL refresh for affected task or broad-recovery invalidations, including off-page tasks. Failed refreshes SHALL preserve last valid rows with a stale label. Snapshot bindings SHALL remain captured values. Late responses for replaced selections MUST NOT overwrite the active binding, and disposal MUST release owned reads.

#### Scenario: Off-page referenced task changes

- **WHEN** a scoped change names a task used by a mounted live widget but absent from loaded finder rows
- **THEN** that binding refreshes to current evidence without refreshing unrelated planning documents or changing captured sibling widgets

#### Scenario: Live binding refresh fails

- **WHEN** the latest summary read fails after a successful live observation
- **THEN** the previous rows remain visible with stale or unavailable freshness and cannot be presented as a successful current zero

#### Scenario: User switches the surface during a slow read

- **WHEN** the selected surface revision or its requested identities change before an earlier summary read finishes
- **THEN** the earlier response cannot replace the new binding and closing the view releases its owned observation work
