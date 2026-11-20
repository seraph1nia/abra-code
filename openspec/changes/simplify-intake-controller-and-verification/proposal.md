# Proposal

## Why

Creating one issue in a disposable graph of 1,000 issues hydrated 1,001 issue rows to explain its readiness. A subsequent one-item batch hydrated 1,001 rows before insertion and 1,002 afterward, while the default controller test graph accepted a claim with an open dependency that real SQLite refused.

## What Changes

- Let intake and start ask for readiness by issue ID. The query owns dependency selection, blocker calculation and current population evidence. Fleet scheduling keeps its ordered population query.
- Let SQLite batch intake prove graph integrity incrementally. Validate local edges and referenced existing IDs inside the transaction, with a full integrity check when the existing graph cannot be trusted. Retire the ordinary full-graph sort and the duplicate dependency traversal.
- Make SQLite in memory the default graph behind controller tests. Give scenarios simple setup operations for creating issues and dependencies. Retire the general-purpose map implementation as its callers migrate.
- Have phase transitions and worker reservation writes express their intended changes once. Move the typed patch through the whole call chain, including shared setup capacity handling. Return the committed execution to the next step.
- Register fixed workspace reads with a typed adapter that owns native response encoding, error translation, request metrics and Effect context. Start with Overview and Detail, then migrate reads that use the same conventions. Keep each browser projection explicit.
- Let the parallel and acceptance journeys own their provider behavior and synchronization. Share the small wait/release operation and the fixture's existing process lifetime, restart and cleanup.
- Construct the controller in dependency order. Route lead batch intake directly to its owner and let admission and recovery return immediate lifecycle decisions for the controller to execute inside its existing operation scope. Remove callbacks into a partially constructed advancement module.
- Build the checkout's web assets once in routine Linux CI and run the browser tests against those bytes. Preserve standalone local commands and independent disposable installation builds.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `execution-coordination` gains bounded issue reads for selected readiness and preserves fresh global admission checks.
- `batch-work-intake` gains a bounded ordinary validation path with the existing complete-graph integrity guarantee.
- `continuous-integration` gains graph-faithful controller verification and reuse of the checkout's built web assets in routine CI.

## Impact

The work touches the runtime work graph, queries, admission, execution storage and transitions, native observer registration, controller construction, contributor fixtures, package scripts and the Linux CI job. Existing database formats, retained operation identities, native methods, browser payloads and local command names remain compatible. The implementation uses the installed SQLite, Effect, OpenCode and test tooling.

## Scope and Choices

Judge each change by what its caller can stop knowing. Intake supplies IDs, a transition supplies its intended changes, a read supplies its schema and handler, and a journey supplies its behavior. Locks, freshness, serialization and cleanup belong to the module that can enforce them. Extend the existing execution patch and selected-read work in `simplify-worker-lookup-execution-writes-and-inspection`; its already implemented behavior is the baseline.

Three illustrative caller interfaces guide review. The implementation can follow existing project naming.

- `readinessFor(ids)` returns results keyed by issue ID. Callers can explain one ticket or assemble a batch response directly.
- `move(execution, phase, changes)` returns the committed execution. A caller can hand that value to the next step without separately mutating an object, listing field names or synchronizing a stale copy.
- `recover(execution)` yields the completed result or the specific next action. The controller consumes it under operation ownership. The caller installing recovery supplies no callbacks into its own future instance.

Land the graph fixture and intake changes together in small steps. Migrate writes and workspace reads independently. Do controller construction last, after the committed-value contract is exercised. Keep lifecycle decisions transient inside the controller's existing operation scope. The execution record remains the source for recovery after a crash.
