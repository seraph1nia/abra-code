# Operational verification

Use the [disposable native prerequisites](README.md) and an already provisioned
compatible Chromium. The runner reuses the existing native installation, local
repositories/remotes, loopback provider, controller tools and asserted journeys.
It never invokes a paid model or the operator's service. Normal CI runs the
ordinary regression suites; repeated soak cycles are opt-in.

## Declare and run

Inspect the exact bounded schedule without starting a service:

```sh
pnpm test:soak --dry-run --cycles 2 --profile full --seed 42
```

Then select a **new** external evidence directory:

```sh
REPORT_CHROMIUM_PATH=/path/to/compatible/chrome \
pnpm test:soak --cycles 2 --concurrency 1 --profile full --seed 42 \
  --deadline-seconds 1800 --idle-seconds 10 \
  --output /tmp/abra-operational-run
```

Cycles use independent disposable installations. `concurrency` limits concurrent
installations; the existing central scheduler still owns worker capacity inside
each installation. The seed determines `mixed` profile ordering, not model
randomness. The default `full` profile runs the complete existing native journey,
including failure/retry, queued/required-response restarts, Review, findings,
decisions, report-build interruption, delivery/cleanup and the omitted-reply case.
Other profiles select only communication, parallel, reports or final product
acceptance. `crash-windows` additionally injects original-admission, lead-notice
and HTML-publication receipt loss, drops completion events and repeats/reorders
tool events. Its independent native research task must still complete through
periodic reconciliation. Its HTML artifact must recover with one render attempt.
The full opt-in profile includes that separate fixture; ordinary regression CI
does not run the additional injected-fault fixture.
Their pass means that declared subset passed. None alone establishes
every operational requirement. Native test deadlines still apply within the
overall runner deadline.

`communication` deliberately omits three worker/lead responses, asserts one
reminder each, two correlated answers, one escalation, unchanged identities across
restart and confirmed stop. `acceptance` completes three parallel software tasks,
retains a user plan gate, forwards findings, verifies independent Review/branch
delivery and preserves a portable report. It samples quiet native-service CPU/RSS
while that user gate is retained. The sample starts after native execution/inbox
and provider activity settle; initial notification activity is counted separately.
No provider request may occur during the measured unchanged-state interval.

## Read actual evidence

The exit code, `soak.json` and each cycle's `runner.json` must agree. A pass
requires successful test exit, expected named scenario receipts, fixture cleanup,
absence of the recorded fixture root, no live recorded native child PID and no
live recorded report-compiler process group. The disposable ProcessRunner copy
records report child/group identities and start ticks after scoped spawn. Every
expected fixture must retain its tracking-ready receipt; missing process evidence
cannot pass cleanup. This inventory covers owned native service PIDs and report
compiler groups, not an unrestricted host process scan.
`resources.json` is written before native startup and updated at each restart;
missing cleanup evidence cannot become a pass. `native-engineering.json` retains
bounded scenario observations and artifact references. Report HTML remains outside
the removed installation. A failed or incomplete cycle makes the run fail.

The opt-in installation injects measurement wrappers into its disposable copy of
the existing application seam. Production source has no measurement import or
additional service. Independent `measurements.jsonl` segments survive separate
plugin module instances and restarts; the runner aggregates counts, totals and
maxima without read/modify/write loss. Measurements include:

- Native SDK inbox/context/exact/history/active calls and plugin session/context
  calls. Plugin service reads and SDK calls are separate categories.
- Session/admission observations, prompt/notice submissions, controller storage
  I/O, message/execution reconciliation and scheduler tick durations.
- Controller-lock acquisition wait and time inside its callback. Kernel helper
  waiting is excluded from held time. Scheduler tick duration is not scheduling
  eligibility wait.
- Provider request and controller RPC counts/durations; quiet CPU/RSS and retained
  native/plugin state byte counts where the selected journey observes them.

Single admission calls use the batch adapter, so those counters overlap and must
not be added as independent native reads. Provider requests include tool
continuations and retries; they are neither native turns nor billable tokens.
Prompt submission counts include same-ID queue wake attempts; exact scenario
context assertions establish whether an independent admission was duplicated.
Task/recovery counts name their measured subsets. Human interventions, actual
model judgment, eligibility wait, decision/notification latency and any unavailable
metric remain explicitly unknown. No costs are estimated. The runner stores only
bounded test summaries, identities, counts and measurements; raw provider bodies,
prompt-bearing assertion messages and arbitrary stdout are excluded from default
telemetry.

Timing counters describe completed measured effects in flushed module segments.
Abrupt service death can omit an in-flight count or duration; available segment
files do not establish complete execution-event delivery. Build-attempt journals
and process inventories are separate from completed renderer timings. Retained
controller/native identity assertions establish admission/recovery correctness.

The compiler-readiness probe reads children across the owned service's threads:
Linux attributes a child to the creating task, which need not be the main thread.
It also requires observed compiler output and checks terminal report state while
waiting. A completed/failed build before the restart window is reported explicitly;
the probe never silently substitutes a successful build for an interrupted one.

Use the [comparison protocol](comparison.md) for repeated paired scenarios with
Firstmate. Deterministic native receipts do not establish practical parity.

The [reconciliation benchmark](../../tests/benchmarks/reconciliation.ts) is a
separate deterministic count probe:

```sh
pnpm exec tsx tests/benchmarks/reconciliation.ts > /tmp/reconciliation.json
```

Its 35 cases use one warmup and five counted samples with a real adapter and
public API stubs. Timing is fixture overhead, not network/provider latency. The
benchmark explicitly leaves lock contention and scheduler delay unavailable;
the native soak measures the relevant lock/tick durations separately.

## Failed deadline or interruption

The runner signals only its newly owned process group, then forces termination
after a grace period. A deadline or cancellation is always a failure. An abrupt
stop can prevent ordinary teardown; the retained manifest and missing receipt
must expose that uncertainty. Inspect the recorded process identities and fixture
root before cleaning up only those disposable resources. Never stop by executable
name, restart the operator service, remove a shared installation parent or delete
the only failure evidence. Preserve `soak.json`, cycle receipts and measurements
outside the fixture. A separate subsequent cleanup receipt must not rewrite the
failed run into a pass.

## Optional real-provider exercise

This is a separate operator procedure, **not** a runner flag. Run it only after
explicit authorization of the provider/model, finite task/turn budget, credentials
and disposable repositories. The deterministic provider is not silently replaced.

1. Create a separate source installation/config/data/cache/state and local bare
   remotes using the documented native fixture isolation pattern. Authenticate
   only inside that configuration; verify the service identity and repository
   paths read-only before submitting work.
2. Record the checked-out revision, model selections, workflow policies, human
   approval settings and budget. Use three small representative maintenance tasks
   with observable consumer tests and independent Review. Keep merge human-owned
   and delivery local; no production merge or user remote push is permitted.
3. Observe actual outputs, tool calls, interventions, response recovery, elapsed
   time and reported usage. Request an investigation report and inspect its
   retained evidence and portable artifact. Restart only the isolated service at
   one declared checkpoint; retain native/controller identities before and after.
4. Stop at the declared budget or a human-owned decision. Record failures and
   missing measurements. Report provider-reported attributable usage only; leave
   absent usage/cost unknown. Stop only owned children and verify local resource
   cleanup after preserving external evidence.

No real-provider result follows from a deterministic pass. Long-duration stability,
every publication/commit crash window, paid-model efficiency and practical parity
remain unverified until their corresponding exercises actually run.
