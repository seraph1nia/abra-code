# Spec Delta

## Purpose

Establish repeatable operational evidence for sustained native orchestration, safe recovery, performance and practical usefulness while isolating tests and protecting operator data.

## ADDED Requirements

### Requirement: Exercise repeated isolated operational lifecycles

The project SHALL provide an opt-in bounded operational runner reusing disposable repositories, local remotes, a deterministic loopback provider and isolated native service installations. It SHALL exercise repeated intake, fair constrained scheduling, parallel workers, forwarded findings, worker decisions/replies, Review, failure/retry, report generation, completion and cleanup. Runs SHALL declare seed, cycles, concurrency, deadlines, supported runtime versions and fault schedule. Passing SHALL require verified work/output/authority/cleanup postconditions, not process liveness or model-generated claims. Ordinary regression CI SHALL not run prolonged soak workloads or require paid access. The runner MUST NOT restart an operator service, manipulate live worktrees, push user remotes or remove user data. Teardown SHALL target only recorded child resources and preserve failure evidence outside disposable roots.

#### Scenario: Repeated parallel work reaches completion

- **WHEN** several repositories compete for constrained global/repository capacity over multiple cycles
- **THEN** every admitted task has one owner, eligible independent work receives fair admission and accepted outputs plus resource cleanup are verified

#### Scenario: Work waits on decisions

- **WHEN** workers spend a bounded interval waiting for dependencies or human decisions
- **THEN** decision identities remain durable, idle resource use is measured and unchanged observations admit no extra model turns

#### Scenario: Failure occurs during teardown

- **WHEN** any lifecycle assertion or cleanup step fails
- **THEN** the run fails with retained observations and residual resource identities rather than reporting success or deleting the only failure evidence

### Requirement: Inject communication and crash-window faults

Operational verification SHALL cover message-heavy, failure-heavy and restart workloads with stable request identities. Faults SHALL include lost admission/notification receipts, omitted replies, provider failure, interruption, unavailable native observations, adjacent contradictory idle events, event duplication/reordering/loss and queued consumption races. Isolated service/controller restarts SHALL be exercised before admission, after uncertain admission, during worker execution/required response, lead notification, report publication and delivery/cleanup. Assertions SHALL check finite recovery, no duplicate independent instructions, preserved decisions, current-generation authority and no lost accepted outcomes.

#### Scenario: Worker deliberately omits one answer

- **WHEN** a deterministic worker completes a successfully observed request turn without its required response
- **THEN** the same original obligation receives exactly one authorized reminder and either a correlated answer or one retained actionable escalation

#### Scenario: Restart overlaps external commit

- **WHEN** a disposable service restarts after native admission, lead notification or report publication but before its controller receipt
- **THEN** the existing identities reconcile without duplicate instructions, notifications or artifact publication

#### Scenario: Event stream drops a completion

- **WHEN** the runner suppresses a completion event
- **THEN** bounded periodic reconciliation discovers the actual retained outcome without relying on event delivery alone

### Requirement: Produce bounded honest operational measurements

Each run SHALL emit a versioned evidence summary recording executed scenarios, actual pass/fail/skipped status, task completion, intervention count, native supervisor/worker turns, recovery attempts, unanswered requests, duplicate admissions, scheduler waits, decision delays, completion-notification latency, mean/worst reconciliation duration, coordination-lock duration, retained-state size and residual worktrees/processes/builds/queued prompts. Native/tool call counts SHALL remain distinct from billable tokens. Provider-reported token usage SHALL be reported only when available and attributable; missing usage SHALL be labeled unknown, without invented costs. Metrics SHALL exclude prompts, credentials, secrets, raw provider responses and unbounded bodies by default. Measurement availability/coverage SHALL be explicit, and incomplete required correctness postconditions SHALL not be labeled a successful run.

#### Scenario: Provider reports no trustworthy usage

- **WHEN** execution counts are available but token usage is missing or incomplete
- **THEN** the report contains the observed counts and unknown token usage without a fabricated price or token estimate

#### Scenario: Report is inspected after temporary installation removal

- **WHEN** cleanup removes disposable runtime data
- **THEN** the external evidence summary and failure log remain readable with cleanup status and applicable resource identities

### Requirement: Benchmark retained-history reconciliation before and after changes

A deterministic benchmark SHALL measure message counts 1, 10, 25, 100 and 200 under answered, acknowledged, mostly terminal with one pending, admission-uncertain, unanswered, mixed-generation and superseded distributions. It SHALL distinguish adapter-call measurements from observed native API traffic and record session/inbox/context/exact-history reads, storage I/O, duration, memory, coordination-lock occupancy and scheduler delay where measured. It SHALL retain a reproducible pre-change baseline, compare equivalent post-change runs and explicitly state unavailable measurements. Optimization SHALL be accepted only with preserved identity/authorization/restart tests and evidence that resolved history adds no unnecessary recurring native transport I/O. Negligible improvements SHALL justify leaving unrelated code unchanged.

#### Scenario: Mostly terminal workload grows

- **WHEN** identical benchmark conditions grow resolved history around a fixed active request
- **THEN** before/after evidence shows native read counts and scheduling impact without treating mock timing as native runtime latency

### Requirement: Gate real-provider exercises explicitly

A separate optional recipe SHALL require explicit operator authorization and configured credentials before making paid or external model requests. It SHALL use bounded representative tasks in disposable repositories with no production merges or pushes to user remotes. Normal CI SHALL pass without this exercise. Evidence SHALL distinguish deterministic controller correctness from real model judgment, task quality, tool use, intervention count and available provider usage. Unexecuted exercises SHALL be recorded as not run rather than inferred from historical results.

#### Scenario: Ordinary regression run has no credentials

- **WHEN** ordinary CI or the deterministic soak runner executes without provider authorization
- **THEN** no paid provider is contacted and real-provider results are labeled not run

### Requirement: Compare practical outcomes reproducibly

The project SHALL document repeated comparisons against a pinned Firstmate revision using equivalent goals and comparable model capabilities, recording harness/workflow/approval differences. Scenarios SHALL cover parallel development, cross-worker research, omitted replies, supervisor interruption, scoped lead delegation and portable visual reporting. Results SHALL separate deterministic correctness, model judgment, token efficiency, UX, operational reliability, delivery correctness and time to accepted output. Unsupported multi-harness and remote-host infrastructure SHALL be identified as intentional non-goals, not scored as core parity failures. Missing or single-run evidence SHALL not support claims of superiority or full parity.

#### Scenario: Equivalent models cannot be selected

- **WHEN** harnesses expose different models, usage counters or approval workflows
- **THEN** the comparison records those limits and does not present the outcomes as an equivalent controlled parity result

#### Scenario: Only deterministic AbraCode fixtures ran

- **WHEN** mocked/deterministic native tests pass without repeated Firstmate/model exercises
- **THEN** the report states established controller behavior and unmeasured practical parity separately
