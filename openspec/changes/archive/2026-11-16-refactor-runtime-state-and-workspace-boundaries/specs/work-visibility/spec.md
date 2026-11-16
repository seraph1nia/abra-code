# Spec Delta

## ADDED Requirements

### Requirement: Observe admission by exact request identity

The workspace SHALL expose read-only admission status for an exact request in its authorized Abra session independently of recent-history limits. A confirmed matching receipt SHALL clear that request's pending composer state. Missing or uncertain evidence MUST NOT authorize automatic resubmission, another message identity or access to another session's receipt.

#### Scenario: Pending receipt falls outside recent history

- **WHEN** a tab resumes with a pending request after more than 100 later receipts have been retained
- **THEN** exact lookup finds its original admitted receipt and clears that pending state without sending input again

#### Scenario: Concurrent tab continues working

- **WHEN** another tab creates later receipts while the first tab awaits acknowledgement
- **THEN** history ordering and pagination cannot prevent the first tab from observing its own exact request

#### Scenario: Receipt response is lost across restart

- **WHEN** admission succeeded but its response was lost before the service or browser restarted
- **THEN** reconciliation uses the original session/request identity and does not create another native prompt

#### Scenario: Receipt cannot be proved

- **WHEN** exact lookup has missing, conflicting or uncertain evidence
- **THEN** the browser retains an explained pending or uncertain state and offers the existing explicit recovery path without inferring admission or replaying input

### Requirement: Reconnect observation after termination

Observation SHALL reconnect after both stream failure and clean closure using bounded retry delays. It SHALL retain the last valid data with an accurate connection state and attempt a fallback refresh at intervals no greater than five seconds while mounted. Disposal MUST stop owned retries and reads without stopping native work or admitting input.

#### Scenario: Native stream ends without an error

- **WHEN** the native observation stream closes successfully while the workspace remains mounted
- **THEN** a new subscription is attempted within the documented retry bound and subsequent native changes become visible

#### Scenario: Events are missed during reconnection

- **WHEN** native state changes while its event connection is unavailable
- **THEN** reconnect or the bounded fallback obtains a fresh authoritative observation without a second browser polling loop

#### Scenario: Browser closes during backoff

- **WHEN** the observer is disposed while a retry or fallback read is pending
- **THEN** its owned work is canceled and no later callback mutates the disposed view or stops native execution

### Requirement: Apply ordered updates against a valid baseline

Live workspace updates SHALL identify their observation epoch, order and relevant source revisions. A client SHALL apply an incremental update only to its matching baseline. Duplicate, out-of-order, foreign-session or gapped updates MUST NOT replace newer valid data. Recovery SHALL request a full baseline without granting mutation authority or treating wall-clock time as causal order.

#### Scenario: Incremental update follows bootstrap

- **WHEN** a valid update follows the established baseline in the same session and epoch
- **THEN** changed state is applied while native message and tool identities, visible ordering and unchanged evidence are preserved

#### Scenario: Delta arrives with a gap

- **WHEN** an incremental update has no matching baseline or skips a required sequence
- **THEN** it is not applied and the observer obtains a full baseline while labeling the retained observation appropriately

#### Scenario: Older connection emits after restart

- **WHEN** an old connection sends an update after a new observer epoch has been established
- **THEN** it cannot supersede that new epoch's state even if its timestamp appears newer

#### Scenario: Supported legacy observation has no order metadata

- **WHEN** a supported historical full observation lacks the newer ordering evidence
- **THEN** it remains readable through its explicit compatibility path without fabricating order or silently replacing an established ordered live baseline

### Requirement: Refresh resources according to changed evidence

Observation SHALL distinguish affected task, transcript, form, admission, presentation and aggregate resources. It SHALL coalesce bursts and refresh affected mounted reads, including selected resources outside loaded lists. Unchanged fallback observations and freshness-only updates MUST NOT invalidate all work queries. Unknown change scope SHALL retain a safe broad-refresh fallback.

#### Scenario: One off-page task changes

- **WHEN** evidence changes for a selected task outside the current finder and bootstrap rows
- **THEN** that task's affected mounted evidence refreshes without refetching unrelated task documents or transcripts

#### Scenario: Workspace remains unchanged

- **WHEN** repeated fallback observations contain no semantic changes
- **THEN** freshness can update without repeated full transcript emissions or redundant mounted resource fetches

#### Scenario: Old invalidation omits affected identities

- **WHEN** a supported invalidation provides no narrower change scope
- **THEN** the observer uses bounded broad recovery and retains correctness without assuming that no work changed

### Requirement: Read selected work without observing unrelated workers

A task-detail request SHALL obtain its task and required related evidence without computing fleet readiness or observing unrelated native workers and leads. Finder results SHALL filter before pagination. Fleet counts and attention SHALL cover their documented population independently of finder pages and retain explicit unavailable or truncated coverage.

#### Scenario: One task is opened in a populated workspace

- **WHEN** a user reads one task among many unrelated retained issues and active workers
- **THEN** the read performs no native session or lead observations for those unrelated tasks and does not compute fleet readiness

#### Scenario: Search result is outside the first retained page

- **WHEN** a title or ID search matches work beyond the first unfiltered page
- **THEN** filtered pagination returns the matching work with accurate total and continuation information

#### Scenario: Finder filter changes

- **WHEN** the user changes repository, status or search filters
- **THEN** complete fleet totals remain independent of the matching page and coverage limits remain visible

### Requirement: Distinguish coherent retained state from live observations

A combined retained-state observation SHALL identify a coherent committed controller view or report that consistency is unavailable after bounded attempts. Native session evidence SHALL carry independent freshness and availability. Cached observations MUST NOT supply authorization to mutations, and unavailable native data MUST NOT imply idle state or completion.

#### Scenario: Controller commits during observation capture

- **WHEN** a controller update overlaps capture of related issue and execution evidence
- **THEN** the response uses a coherent committed capture or a bounded unavailable result rather than presenting an unqualified mixed state

#### Scenario: Native activity changes after retained capture

- **WHEN** a worker changes activity after the retained controller view was captured
- **THEN** its activity observation retains its own freshness and does not claim a single atomic native/controller instant

#### Scenario: Another process continuously changes state

- **WHEN** capture cannot establish consistency within its retry or coordination budget
- **THEN** it returns an explained unavailable observation without holding shared coordination indefinitely or blocking unrelated lifecycle work

### Requirement: Defer inactive capabilities while preserving interaction

The browser SHALL defer optional inactive inspection and report capabilities while preserving chat, drafts, scroll, URL navigation, form bindings, keyboard focus, themes and narrow-screen access. Content-hashed public assets SHALL support immutable caching. Mutable HTML, API and private report responses MUST retain their freshness and isolation requirements.

#### Scenario: User opens an inactive capability

- **WHEN** the user first opens an inspection or report capability that was not needed for initial chat
- **THEN** it loads on demand with an accessible pending or error state and the mounted draft and transcript position remain intact

#### Scenario: Browser reloads an unchanged asset build

- **WHEN** the browser requests a previously cached content-hashed public asset
- **THEN** the supported cache policy permits reuse while current HTML and API observations still receive the required freshness policy

#### Scenario: User navigates on a narrow screen

- **WHEN** a user opens and dismisses inspection at a 375- or 390-pixel viewport using keyboard or pointer controls
- **THEN** content remains reachable, focus returns appropriately and no live form answer or composer draft is lost
