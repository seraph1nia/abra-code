# Retained-history reconciliation measurements

Executed 2026-10-18 against the uncommitted P0.2/P0.3 implementation at HEAD
`d38274bb72697a92cd0fdd52bab4cd065a3688dd`. The retained pre-change production
patch and source hashes identify the measured intermediate source; HEAD alone
is not its content fingerprint. No paid/native network request was made.

Run `pnpm exec tsx tests/benchmarks/reconciliation.ts > /tmp/reconciliation.json`.
The existing disposable fixture seeds one current worker and 35 independent
cases: 1/10/25/100/200 requests in seven distributions. Each case resets retained
records and native context before one warmup plus five measured samples. The
real `NativeRuntime` uses counted public API stubs. Every sample additionally
observes the assignment independently of message reconciliation. Counts are
asserted equal across the five samples. Inputs contain no secrets or provider
bodies; output includes only counts, timings and memory observations.

At 200 retained requests, API/storage columns are
`session get / inbox / context / exact message / history / controller store get / set`.
Durations below are fixture milliseconds, **not service/provider latency**.

| Distribution         | Before counts       | After counts  | Before mean / max ms | After mean / max ms |
| -------------------- | ------------------- | ------------- | -------------------- | ------------------- |
| answered             | 201/401/401/0/0/0/0 | 2/2/2/0/0/0/0 | 193.59 / 210.48      | 3.10 / 4.35         |
| acknowledged         | 201/401/401/0/0/0/0 | 2/2/2/0/0/0/0 | 186.50 / 187.82      | 4.47 / 6.07         |
| terminal_one_pending | 201/400/400/0/0/4/2 | 2/2/2/0/0/4/2 | 226.12 / 229.36      | 43.93 / 48.77       |
| admission_uncertain  | 201/401/401/0/0/6/3 | 2/3/3/0/0/6/3 | 247.20 / 257.92      | 75.76 / 93.02       |
| unanswered           | 201/401/401/0/0/0/0 | 2/3/3/0/0/0/0 | 186.58 / 187.98      | 3.68 / 5.40         |
| mixed_generations    | 101/201/201/0/0/0/0 | 2/2/2/0/0/0/0 | 96.77 / 98.99        | 3.60 / 7.38         |
| superseded           | 1/1/1/0/0/0/0       | 1/1/1/0/0/0/0 | 0.67 / 0.70          | 0.88 / 1.14         |

[Before JSON](reconciliation-before.json) and [after JSON](reconciliation-after.json)
retain all 35 cases and raw samples, including RSS and heap deltas. Heap deltas
may be negative from GC; RSS includes shared process overhead. Timings are not
isolated microbenchmarks and vary with concurrent verification. Pending admission
still validates and serializes retained history (four store reads/two writes in
this fixture); constant native calls do not imply constant total runtime.

The benchmark isolates Messages. Coordination-lock occupancy and scheduler delay
are **unavailable**, not zero: it does not drive concurrent central admission or
model network waits. They remain operational-suite measurements. Exact lookup
and bounded history costs are zero in this un-compacted fixture; separate native
adapter regressions verify those fallback paths and error/refusal semantics.

The native adapter batches exact intent observations with one inbox/context
snapshot and indexed IDs. Messages reuses one session observation and one batch
until a native prompt/wake/recovery can invalidate it. Answered/ack-resolved
requests skip admission reads when the observed inbox does not retain their ID;
queued resolved inputs remain actionable for same-ID wake. An unknown inbox
projection conservatively inspects history. Unresolved answer-required
acknowledgements and reminder transport remain active. A separately observed
worker outcome still owns capacity and failure semantics. There is no persistent
cache, extra transport record or database field.

The final count probe ran at 2026-10-18T11:01:21Z after the transient native
completion-observation correction. All 35 workloads retained the same API/storage
counts. The frozen pre-optimization sources are also retained as
`reconciliation-before-messages.ts.txt` and `reconciliation-before-runtime.ts.txt`,
with their hashes in `reconciliation-before-source.json`. A disposable source copy
using those snapshots reproduced all 35 baseline count sets; see
`reconciliation-before-replayed.json`. Run the already installed `tsx` executable
directly in such a copy. Do not invoke package-manager dependency reconciliation
against a copied workspace that links the original dependency directory.
