# Runtime, state and workspace refactor evidence

This records implementation of
`refactor-runtime-state-and-workspace-boundaries`. An unchecked task remains
unfinished even when an earlier investigation or baseline passed.

## Source and authority baseline

The operator explicitly authorized direct implementation through Codex for this
change. This does not create a registered execution, manufacture controller
approval receipts, or change the product's controller gates. No other change is
archived, approved, delivered, retired or closed by this implementation.

The implementation baseline is commit
`66f42970486d56d508bef538582127ed4b1f6896`, with only this change's untracked
planning directory. All baseline file digests remained unchanged throughout the
measurements. Toolchain: Node 26.13.0 and pnpm 12.21.0, with frozen installed
dependencies. Evidence survives outside disposable fixtures at
`/tmp/abracode-refactor-baseline-ub2gyatj`.

The local SQLite graph was inspected using a read-only connection. It retains an
in-progress “Single-session native-backed CopilotKit workspace for AbraCode”
issue and an open “Make the AbraCode frontend coherent” issue. Neither is
evidence of delivery or closure. No controller tools are connected to this
Codex session; native execution/delivery receipts for overlapping changes are
therefore unavailable. The graph was not modified. Completed checklists in
other OpenSpec directories are not substituted for those receipts.

Implementation uses the current checked-out behavior and this accepted
proposal. In particular:

| Overlapping source                 | Effective implementation baseline                                                                                                                                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make-chat-the-primary-workspace`  | The existing React workspace, captured JSON reports and explicit optional HTML exports are preserved. Its report delta supersedes the canonical manual-template description for this implementation; no conversion to manual TSX/Solid authoring occurs. |
| `simplify-openspec-execution-loop` | The configured compact schema and captured schema/approval contracts remain intact. Direct Codex authorization for this refactor grants no standing authority inside the product.                                                                        |
| `complete-work-reliably`           | Existing synchronization, cleanup preflight, exact human dispositions, independent Review and restart behavior remain required.                                                                                                                          |
| Operational and feedback changes   | Existing uncertain-effect, feedback and retained-history behavior is retained. Deferred management autonomy is excluded.                                                                                                                                 |

Canonical/delta reconciliation and any delivery of these overlapping changes
remain separate work. Their unavailable delivery evidence does not authorize
rewriting their artifacts or histories. The additive refactor deltas do not
replace their pending requirement modifications.

## Sequential baseline

The runner retained `source-before.json`, `run.json` and separate numbered logs.
These are pre-implementation results, not acceptance of the refactor.

| Command                                            | Result                     | Wall time |
| -------------------------------------------------- | -------------------------- | --------: |
| `pnpm check`                                       | Passed                     |  15.153 s |
| `pnpm test`                                        | 578 tests, 97 files passed | 343.082 s |
| `pnpm test:e2e`                                    | 29 tests, 5 files passed   | 614.924 s |
| `pnpm build`                                       | Passed                     |   2.925 s |
| `pnpm config:schema`                               | Passed; no source drift    |   0.476 s |
| `pnpm licenses:check`                              | Passed                     |   1.113 s |
| `pnpm exec tsx tests/benchmarks/reconciliation.ts` | All 35 cases passed        |   2.817 s |

Native/browser results and named screenshots are retained in `journeys/`, outside
the installations removed by fixture teardown. Communication counts use the
existing 1/10/25/100/200-history distributions, one warmup and five counted
samples per case. They measure public API invocation counts with a real adapter
and stubbed native observations, not network latency or lock contention.

Additional probes used the same unchanged source and built assets:

| Probe                                               | Observed baseline                                                                             | Evidence                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------- |
| Empty chat, 1440×900                                | 4 requested JS assets; 3,339,297 raw bytes; 970,937 gzip bytes                                | `initial-load.json`     |
| Chat with TypeScript/code/table rendering, 1440×900 | 13 requested JS assets; 3,737,836 raw bytes; 1,053,422 gzip bytes                             | `initial-load.json`     |
| Unchanged mounted finder for 11 seconds             | 2 fallback snapshots and 2 redundant work-query fetches after initial readiness               | `unchanged-load.json`   |
| Selected task among 76 retained active executions   | 2 readiness passes, 75 unrelated native session reads, 4 storage scans, including 1 lead scan | `task-read-counts.json` |
| Two distinct documents, one renderer identity       | 2 application compiler invocations; one per document                                          | `export-counts.json`    |

Initial-load probes include every requested JavaScript file and modulepreload
through composer/transcript readiness plus one second. Gzip uses Node's level 6
for each asset; the baseline server itself sends uncompressed responses. Both
empty and populated fixtures must improve by at least 20% on identical settings:
at most 776,749 and 842,737 gzip bytes respectively, without dropping deferred
features. The selected-task count fixture uses actual controller projections
and fake native sessions sharing a disposable worktree; it grants no mutation
authority. Direct renderer counts deliberately bypass the artifact cache to
measure reuse across distinct documents; diagram preparation is counted
separately from application compilation.

## Ownership and migration inventory

`write-callers.json` records 109 direct production record calls across 22
modules: 62 full saves, 3 setup saves, 2 control saves, 7 owned saves, 13 finishing
saves and 22 current-state updates. It includes callbacks passed to provisioning,
approval and retirement. Wrapper owners such as `ProjectSetup.save` must migrate
with their callers. New execution creation and coordinated control-generation
replacement remain explicit full-record operations.

| Fields/evidence                                                  | Owning operations and callers                                               | Required protection                                                                             |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Record identity, revision, schema, captured configuration/policy | `Records`, execution creation, schema binding and explicit control revision | Strict revision checks; captured evidence and legacy originals remain immutable.                |
| Phase, error/recovery, retry/resume, operation                   | transitions, operations, advancement, scopes and corrections                | Current generation/operation; own only the intended transition fields.                          |
| Native session/prompt/context, worker failure, capacity and stop | sessions, capacity, attention and external validation                       | Assignment identity and independently committed diagnostic evidence survive delayed completion. |
| Decisions, waits, progress and attention                         | obligations, attention and current-state worker report operations           | Compute against current state; preserve append-only replies and unrelated obligations.          |
| Message intents, admissions, replies and dispositions            | messages and worker sessions                                                | Stable native identities, exact input and immutable communication history.                      |
| Verification, Review, archive, delivery and finishing            | checks, finalization, finishing, synchronization and disposition            | Exact checked/published identities, current human bindings and preserved uncertain effects.     |
| Feedback, forge and external custody                             | feedback, PR actions, PR feedback and external validation                   | Scoped updates; no loss of independent history or custody evidence.                             |
| Canonical reports, exports and notices                           | reports, report documents and visual reports                                | Frozen inputs, exact bytes, append-only identity and publication recovery.                      |
| Repository setup                                                 | setup and shared capacity/workspace operations                              | Same concurrency contract without converting setup into a work-graph issue.                     |

`package-consumers.json` records 84 cross-package source import sites in 30 app
files, including runtime and type-only imports. `installation-paths.json` records
13 installation-root/path assumptions. These inventories include app build
configuration, report aliases and `.opencode` entry points. Relocation also needs
the source-copy recipes in `tests/e2e/install.ts` and report integration tests,
licensing source/use classification, TypeScript include paths, CSS scanning and
development watcher roots.

Procedure ownership is role identity/permissions in `packages/agents`, reusable
runtime procedures in `packages/agents/assets/skills`, task facts in worker assignment
prompts, planning artifacts in schema templates, and enforced lifecycle gates in
the controller. Research's retired Solid guidance and duplicated execution,
verification/report procedures migrate under task 9.1; supplier-generated
OpenSpec skill bodies remain unchanged.

The proposal's finding matrix and tasks map all twelve findings to behavioral
proof: persistence (2.1/4.1), receipt history (2.2), EOF (2.3), synchronization
(5), read scope (4.2–4.4), packages (3/6.3), frontend (7), exports (8), workflow
interfaces (6.1/6.2/6.4), procedures (9.1), dependencies (9.2), and verification
(1/10). Final evidence must identify the implemented source separately from this
baseline.

## Admission and observation fixes

`WorkspaceFeed` now repeats its native subscription after both clean EOF and
failure, with a one-second delay. Controlled-clock tests prove a second
subscription receives changes, fallback refreshes continue, and disposal during
the live stream or backoff cancels owned work without a native prompt or stop.

Exact receipt reads use one native storage key, independent of display-history
scans. They preserve missing/uncertain/conflicting evidence and do not invoke
admission recovery. The browser checks request ID, text and delivery before
clearing pending state; a separate draft survives recovery.

The focused unit/HTTP run passed 23 tests. `pnpm check` passed with zero Effect
diagnostics, and the rebuilt frontend passed both lost-response/same-ID recovery
and old-receipt/restored-draft browser regressions. Browser evidence survives in
`/tmp/abracode-refactor-receipt-browser-20261116`.

The real disposable workspace journey passed on unchanged captured source in
`/tmp/abracode-refactor-receipt-native-siwx3unc`. Its `source-digests.json` and
empty `source-changes.json` identify the exercised source; `run.json` retains
the focused tests and 56.773-second native run. `native-engineering.json` records
`result: pass`, `cleanup_complete: true`, 101 later receipts, zero replayed
inputs, native restart and foreign-session refusal. Named screenshots include
`native-exact-old-admission-after-restart.png`. Existing plan authorization,
saved report/export recovery, delivery and retirement assertions also passed.
The initial attempt at `…-9r8rm1gt` exposed Playwright's single-page convenience
context restriction; the fixture now creates an explicit shared context for
two tabs. Its failure evidence remains retained rather than relabeled a pass.

These are intermediate implementation results. Final integrated acceptance is
still required after the remaining refactor stages.

## Revision-safe persistence checkpoint

Full execution/setup replacement now compares the submitted revision under the
existing commit lock and refuses stale data without mutation. Explicit owned
updates merge only named fields into current state; finishing updates retain
their nested ownership. The existing generation, operation, immutable histories,
legacy-original and unknown-additive-evidence protections continue to apply.
Rejected ordinary/control writes also preserve their caller object.

Regressions exercise newer retry instructions, independent field deletion,
operation replacement, pause generation, unknown/future evidence, report
publication and immutable correction history. A real two-process barrier test
uses the production `Records` and `FileLocks` with a disposable atomic JSON store:
disjoint owned updates both commit, while competing stale full replacements
produce one commit and one explicit conflict. This proves the cross-process
repository/lock contract; the JSON store is a test seam, not a storage migration
or a claim that native storage supplies transactions.

The strict contract exposed two necessary production caller migrations.
Verification's output callback can commit progress before command completion;
command-wait and verification/Review receipt writes now own only those fields.
Worker recovery can publish an attention incident during native observation;
the completion write now owns only capacity observations, preserving the
incident and the correct failed/interrupted transition. The new output-progress
regression failed before its caller migration and passed afterward. Tests that
formerly expected a stale full save to merge automatically now assert refusal
and explicit owned recovery; immutable-history tests obtain a current revision
so they continue to exercise the history gate itself.

The consistency checkpoint at
`/tmp/abracode-refactor-consistency-_n5yr_d9` passed sequentially on frozen
source: `pnpm check` (15.432 s), `pnpm test` (591 tests, 98 files, 347.673 s),
and the real native workspace journey (56.585 s). Its source-digest manifest and
empty source-change list identify the exercised implementation. Native evidence
records a pass, completed cleanup, 101 later admissions, zero replay, preserved
draft, foreign-session refusal and restart. Existing browser plan authorization,
delivery, retirement, saved report/export recovery and offline 375/390-pixel
report assertions passed in the same checkpoint. Retained screenshots were
checked after teardown, including the restored draft/composer image.

This completes the reproduced consistency-fix checkpoint before mechanical
extraction. The remaining production caller migration, removal of legacy
stale-save merging code, package extraction and final acceptance remain tracked
work; these passes do not establish their completion.

## Contracts and presentation extraction

The shared workspace checkpoint is retained at
`/tmp/abracode-refactor-workspaces-6_q0uz8m`. Its source manifest identifies the
dirty implementation over revision `66f42970486d56d508bef538582127ed4b1f6896`;
the sequential run records no source changes. `pnpm check` passed (15.530 s),
web build passed (2.555 s), 33 focused contract/boundary tests passed (8.096 s),
both relocated frozen-source report integration tests passed (16.209 s), all
23 web coherence tests passed (42.972 s), the engineering native journey passed
(180.952 s), and license checks passed (1.202 s). This checkpoint does not
claim the full unit/integration or complete default e2e suite was rerun.

`@abracode/contracts` owns 45 browser-safe schema/data modules through explicit
exports. Root host forwarders retain source compatibility; host policy resolvers,
execution/native projections and backend capabilities remain outside the shared
package. Common count fields and web DTO aliases have one definition. Existing
transport/document malformed-input, omission/bound, identity and catalog tests
exercise those definitions through native/root and browser-facing consumers.

`@abracode/presentation` owns the shared primitives, tokens, styles, cards,
captured evidence/work bindings and upstream A2UI renderer. The web and portable
entries consume its exports without cross-app imports or report aliases back
into the web implementation. The same captured fixture renders through both
entries. Retained 375/390-pixel screenshots were inspected after teardown;
portable tests cover keyboard theme focus/toggling, filter/disclosure behavior,
opaque origin, no network, no external script/style assets and no page errors.
Native evidence records `result: pass`, `cleanup_complete: true` and removed
fixture resources after real worker/skill loading, lifecycle gates and restart.

Oxlint uses its supported JS-plugin AST interface for package boundary checks,
including imports, re-exports, literal dynamic imports and TypeScript import
types. A disposable contributor-lint probe refuses relative/alias escapes,
private exports, filesystem type imports, undeclared dependencies and build-only
source dependencies, then accepts public contract imports in all supported
forms. Both shared packages and both apps pass their own TypeScript checks.
Source-installation fixtures copy `packages/` and use frozen supplier copies,
replacing development-checkout dependency symlinks in both report tests.
License reachability follows relative workspace links, with cycle/missing-link
tests; moved adapted components retain supplier source/notice evidence. A
reachability-only refresh refuses supplier resolution/evidence changes.

Runtime extraction, final dependency cleanup, renderer-shell reuse and final
performance acceptance remain separate tracked tasks.

## Complete execution writer ownership

Production execution/setup replacements have been migrated to named aggregate
or nested-finishing updates. Capacity owns initial creation separately, operation
preparation compares its displaced owner, workspace callbacks declare their
fields, and phase transitions receive explicit pending caller fields. Setup uses
the same scoped contract at its independent key. The obsolete stale-field merge
whitelist is removed. Full replacement remains a strict revision-checked
repository primitive, while control changes retain their distinct generation
and revision gate. The architecture ownership table documents each writer.

The frozen-source run `/tmp/abracode-refactor-owned-writers-8rocli8n` passed
`pnpm check` and all 594 unit/integration tests in 99 files, including real
cross-process disjoint updates/competing replacements, old/future records,
append-only histories, pause/replan, setup and lifecycle coverage. Its native
workspace journey failed and is retained as a failure with completed cleanup.
A delayed explicit Advance raced scheduler completion and tried to validate an
already-retired path. A bounded controller regression reproduced the exact
ENOENT after real fixture retirement
(`/tmp/abracode-refactor-retired-advance-red.log`). Completed checkpoint handling
now returns the retained completed execution before worktree access; an owned
operation that starts completed no longer rewrites its old operation status.
The regression also asserts unchanged retained state, native admissions and
publication counts. The focused lifecycle/recovery rerun passed 34 tests.

The follow-up checkpoint at
`/tmp/abracode-refactor-owned-recovery-0ujykcp6` passed contributor checks,
focused record/lifecycle/coordination/finishing and real setup/process integration
tests, and the original native workspace journey (56.527 s). Its manifest records
no source changes; native evidence records pass and completed cleanup after
restart, exact old receipt recovery, approvals, delivery, retirement and offline
exports. The full 594-test result applies to the pre-edge-case-fix tree; the
follow-up checks and focused tests establish the final edge-case fix, with the
complete final acceptance still tracked separately.

## Coherent retained observations

Captures now share a read lock against exclusive retained-state commits and
validate the graph event-sequence revision around issue/record reads. An opaque
source version, capture time and record revisions stay with the request-local
bundle. Three nonblocking attempts, 500 ms capture deadlines and bounded
off-lock retry backoff refuse sustained contention instead of publishing a mixed
bundle. A shared section cannot upgrade into a write; native/session projections
run after capture. The graph revision is read-only and changes no schema.

`retained-observation.test.ts` uses real in-memory SQLite to force an intervening
graph commit and continuous contention, then exercises slow storage, cancellation
and pause availability. Actual independent `flock` helper processes prove shared
reader coexistence, exclusive writer refusal/release and refused upgrades. The
shared-capture checkpoint at
`/tmp/abracode-refactor-coherent-shared-xya8iwux` passed contributor checks and
66 focused visibility/discovery/lifecycle/coordination/SQL tests in six files on
unchanged source. Its native result is retained as a failure, with completed
cleanup: a temporary work-query failure also failed the entire workspace snapshot.
The earlier exclusive-reader attempt at
`/tmp/abracode-refactor-coherent-6c0fg0kl` is likewise retained as a failed native
result, not reported as acceptance.

The planned local-resource handling was brought forward from query separation:
`NativeWebBackend` retains one decoded last-valid work view, exposes an optional
unavailable label and continues live native conversation/form/permission reads.
No lifecycle or report-capture owner reads that presentation cache. Newly
generated backend observation timestamps use the supplied Effect clock.

Contributor checks passed after that change. The original native invocation,
`ABRACODE_TEST_JOURNEY=workspace pnpm exec vp test run --project e2e tests/e2e/native.test.ts`,
then passed in 59.33 s with evidence retained at
`/tmp/abracode-refactor-coherent-local-work-20261116` and its sibling `.log`.
It now deliberately holds the real exclusive controller lock, verifies retained
work and native messages remain available, reloads the browser into a usable
composer with the local unavailable label, releases the lock, and verifies valid
work/label restoration before continuing approval, delivery, restart and export
assertions. Native evidence records pass and completed cleanup. The source
manifest there was captured after validation and is explicitly labeled as such;
it does not claim a before/after freeze comparison. Final integrated acceptance
remains tracked.

## SQL batching and bounded finder queries

`SqliteWorkGraph.list` now hydrates issues/dependencies in two SQL reads.
Finder filtering/counting and bounded row selection run in a read transaction,
then hydrate only selected dependencies. JavaScript Unicode lowercase matching
and literal substring behavior remain; a request-local matching-ID rank preserves
legacy Node collation before SQL selects complete rows. The ID ordering pass
remains O(N log N), explicitly documented in `work-graph.md`; this does not claim
sublinear metadata sorting. Additive indexes retain database version 7 and do not
rewrite normalized requests. Intake, batch recovery and claims batch their
dependency/request lookups inside the existing atomic transaction.

Closure metadata is read in one query by latest event sequence. Closure times,
completion totals and finder pages join the revision-validated retained capture,
removing per-row history reads and keeping aggregate counts with their issue
population. Capture retries now use Effect's bounded retry/schedule facilities.
The existing file-backed graph tests and new query tests share a scoped real
database fixture; coherence tests also use its in-memory owner.

The checkpoint at `/tmp/abracode-refactor-sql-u_w93uax` passed 69 focused tests
in seven files (43.573 s) and the native workspace journey (85.663 s), including
real worker gates, held-observation recovery, restart, delivery and exports;
native evidence records pass and completed cleanup. Its initial contributor
check failed on an externally added, generated APM lockfile's formatting.
`apm.lock.yaml` and `.gitignore` changed outside this implementation during the
run, as recorded in its source comparison; it is not a wholly frozen-source pass.
The external owner formatted its lockfile. The follow-up `pnpm check` passed;
`postcheck.json` retains its result/output tail and `postcheck-source.json`
identifies the subsequently checked tree. Those unrelated files were not edited
or reverted by this implementation.

The retained `query-count-followup/sql-query-counts.json` and sibling log record
three passing real SQL query regressions after adding metric retention: 161
issues list with two prepared SQL operations; populated pages use four and
empty/out-of-range pages use one. Tests compare complete page values, Unicode
and literal search, off-page totals, legacy mixed-case/punctuation ordering,
normalized request bytes and dangling-dependency refusal. Existing independent
process ownership/batch tests passed in the focused checkpoint. Final integrated
checks and performance comparisons remain tracked separately.

## Selected observations and typed web operations

Task detail among 75 unrelated active workers now performs no collection scans,
fleet-readiness passes or unrelated session/lead reads. Regression probes refuse
those operations rather than relying on timing. Exact historical communication,
future-record preservation, local unavailable native activity and complete finder
aggregate totals remain covered. Full fleet observations reuse their readiness
rows instead of calculating them twice; finder skips lead overview.

The web adapter exposes fixed named operations whose decoded input/output types
come from the owning HTTP endpoints. Numeric queries stay numeric; path, identity,
optional-field and output codecs remain at the transport boundary. Newly generated
adapter times use Effect Clock; retained native times and identities pass through.
Forty focused tests across visibility/discovery/coherence/SQL/HTTP/feed files passed
with root and contracts typechecks on 2026-11-16. This is implementation evidence,
not final integration acceptance; native/browser and complete checks remain in
section 10 of the task tracker.

## Scoped and ordered synchronization

The scoped feed/commit batch passed 46 focused tests in six files, with root,
web and contracts typechecks. Controlled time proved exactly one fallback read
per five-second interval, three unchanged intervals producing freshness events,
coalesced off-page hints and cancellation with no native stop/admission. An actual
AG-UI client consumed a contiguous state/text delta, duplicate suppression,
gap baseline and new-epoch baseline across regressing wall times, preserving
native message identity. Native-envelope fixtures cover controller-home and
session attribution across locations, nested form creation and broad legacy
recovery. Commit probes observe durable records before notifications and refuse
publication after failed saves. The complete native/browser acceptance remains
pending in tasks 5.4 and 10; these focused results do not claim that proof.

## Lifecycle composition and use cases

Application composition now constructs all lifecycle services. Controller ports
cover admission, execution/planning, publication/retirement, verification/correction,
external validation, communication/obligations, reports and read-only queries.
No public controller signature traverses `Advancement` internals. `WorkAdmission`
owns intake/claims/capacity/provisioning; `ExecutionRecovery` owns retained-state
reconciliation and uncertain-effect recovery. `Advancement` contains phase/control
coordination. Existing role, finishing-readiness and synchronization policy remains
pure. Distinct captured setup/issue authorities keep separate policy gates around
the shared workspace/publication owners.

The first composition/admission batch passed 59 tests in seven focused files.
The recovery batch passed 74 tests in seven files, including communication,
combined restart, finishing, coordination, correction, preservation and retirement.
Root typecheck passed after the final explicit dependency-interface cleanup.
Restart fixtures now use production application composition. The operational
harness receives actual owners through its disposable composition instrumentation,
rather than reaching into private controller fields; it introduces no production
instrumentation import. The host-capability boundary probe was restored after
an over-broad import cleanup altered its source string; its focused test passed.
Native instrumentation/relocated installation proof remains in final acceptance.

## Runtime workspace relocation

Host implementation and its unit/integration/native fixtures now live together
in `packages/runtime`. Existing root commands and native plugin registration are
thin consumers of explicit runtime exports. Installation-root, assets, watcher,
source-copy and disposable instrumentation paths were updated; host configuration
and native skill/session/storage identities retain their prior contracts.
A frozen install in the development checkout and runtime/root typechecks passed;
42 focused tests in six files passed after relocation, including SQLite,
independent-process records, actual plugin registration and boundary probes.
This is not relocated native-installation/build/HMR proof. That expensive proof,
license reachability refresh and the complete final checks remain pending.

The bounded architecture comparison inspected pinned Effect 4.1.4 workflow,
activity, deferred and cluster-engine declarations and their official API pages.
It retains current storage/execution mechanisms for this change, explains exact
external-effect uncertainty and human approval bindings under either alternative,
and specifies separately scoped migration/rollback proof. No engine, ORM or
physical execution-store migration was added.

## Frontend owners, loading and instructions

Browser observation/admission/draft/history owners and navigation/viewport owners
were separated while preserving their existing mounted state and transport cleanup.
Web typecheck passed. Optional inspector, generated-view, report and Markdown code
now has retryable lazy boundaries; tool/observation hooks use the supported
CopilotKit headless entry. This is implementation progress, not the final 20%
byte-graph or narrow-screen interaction proof; those tasks remain unchecked.

Hashed static assets now receive immutable caching and the pinned Effect HTTP
compression middleware. Runtime typecheck and 12 HTTP tests passed, including a
raw compressed response round-trip/size check, old/new asset URLs, private/mutable
`no-store`, report sandbox and same-origin behavior. Browser cache reuse remains
pending alongside final interaction acceptance.

Role leaves and assignment prompts now delegate reusable procedures to their
owning project skills. Native IDs/required capability selection stay unchanged;
retired Vite/Solid research instructions now name captured JSON/React exports.
Twenty-one focused tests in four files passed, including engineering registration,
role capabilities, retained worker context and the actual pinned OpenSpec refresh
regression. Generated upstream workflow bodies were not edited. Source inventory
hash refresh for the two adapted project skills remains part of dependency/license
finalization, rather than repeating the license suite during implementation.

## Reusable portable renderer

The prepared renderer now has a shared v2 ABI and a content-addressed verified
shell cache. Compilation records actual module/style inputs and package links;
separate Mermaid preparation sources/dependencies and required notices participate
in identity. Normal build/explicit preparation and lazy first export use the same
coordinated owner. Per-document export injects escaped canonical JSON and separately
prepared SVG, preserving existing document and publication owners.

The focused real-compiler test passed in 20.42 s, with no browser/native service.
It simulated incomplete compiler output and verified no cache publication/scratch
leak, then proved two concurrent renderer owners share one successful application
compilation and a second distinct hostile-title document adds none. It retained
exact documents, kept identity across backend-only and unrelated lock metadata,
changed identity for renderer/notice edits, and refused a tampered shell without
overwriting it. A missing whole derived cache entry can rebuild; complete damaged
entries remain refused/preserved. The subsequent ABI/limit constant consolidation
passed runtime, report and contracts typechecks.

Six publication tests in two files passed after extracting shared exclusive,
private, flushed staging and non-overwriting-link primitives. They preserve exact
request/digest/byte authority, concurrent capture, lost-receipt reconciliation,
occupied output and immutable old artifacts. SVG/opaque-frame behavior, final
compiler/read/byte comparisons and original native journeys remain pending. None
of this focused evidence is presented as final integrated acceptance.

## Dependency ownership and contributor feedback

The direct dependency audit moved host SDKs to runtime, renderer/UI dependencies to
presentation, and contributor executables to the root owner. Proven unused app
entries were removed. Frozen installation and all five package typechecks passed.
Seventeen focused package identity/native-contract/catalog tests passed. Registry
metadata confirmed current AG-UI 1.0.4, CopilotKit 1.88.0, A2UI 0.15.0 and Effect
4.1.4 pins; React type packages advanced to 19.3.0. Exact runtime identity checks
verify one Effect, React and A2UI core instance across applicable consumers.
CopilotKit runtime's Zod 3 peer remains explicitly supported; no global override
forces incompatible Zod 4 consumers onto it. The two new DefinitelyTyped MIT
supplier texts were read and retained with Microsoft attribution. Incremental
license refresh reuses only unchanged resolution/fingerprint/actual notice bytes;
new or changed suppliers still require explicit review. Complete license acceptance
remains a final gate.

Thirteen fast files now hold the same 48 pure/in-memory scenarios previously in
unit/integration (including actual SQLite finder/query counts). Full `pnpm test`
includes fast, unit and integration exactly once; CI runs fast before provisioning
browser prerequisites and the remaining projects afterward. The first fast run
passed all 48 in 5.98 s without starting Git/native/browser/repository lifecycle.
The common scoped SQLite fixture replaces the need for query-specific graph fakes;
the controller fault-injection graph remains where tests deliberately edit states
and count failures. File-backed/reopen/multiprocess cases retain integration owners.

`vp check` already ran the configured type-aware lint; the previous additional
`lint:effect` repeated it. Final check now runs one strict lint and one formatter,
then pnpm's dependency-ordered package typechecks and the root entrypoint check.
Report scripts belong exclusively to the report tsconfig. Effect diagnostics target
the relocated runtime sources/tests. CI's separate formatter repetition was removed.
Native pnpm dependent selection for contracts was inspected: contracts, presentation,
runtime, web and report are all selected. The browser fixture setup was extracted
from its assertions into the existing shared helper layer, preserving its body and
all journey cases. Comparable final check/full-suite timings remain pending.

## Final acceptance in progress

External receipts, per-command source manifests and surviving journey evidence are
under `/tmp/abracode-refactor-final-fkv2j2r_`. HEAD remains the baseline revision;
the manifests identify the complete uncommitted implementation, including new
workspaces. Failed attempts are retained rather than presented as passes.

The complete check passed in 13.491 s (baseline 15.153 s), including all five
packages/root, strict lint, formatting and 357 Effect-diagnostic files with zero
warnings/errors. The initial full build passed; the subsequent measured web fix
reran only the affected web build, web/runtime typechecks and changed-file strict
lint. The original main CopilotKit UI entry kept optional renderers eager. Its
public headless context plus the existing shared composer controls and direct
Streamdown use corrected that boundary. The rejected intermediate graph remains
recorded as `initial-load-before-finder.json`.

The same complete requested-JavaScript measurement now passes: empty chat is
537,588 gzip bytes (44.6% below 970,937), and populated TypeScript/table chat is
832,188 (21.0% below 1,053,422). Readiness plus one second and all modulepreloads
remain included, with gzip level 6 and the same viewport/data. Browser reload
observed public-asset cache hits in both fixtures; private/mutable header assertions
retain their focused HTTP evidence. This does not yet claim deferred interaction
or native journey acceptance.

The full fast/unit/integration invocation completed in 393.163 s: 612 passed and
three failed out of 615 in 105 files. Two eval subprocesses resolved Effect from
the retired root dependency owner; their working directory now uses runtime.
The third was a stale export assertion treating all subprocesses as independent
application builds. Its replacement requires exactly one application build, two
unique per-document diagram inputs and the same bounded parallelism/output limits.
Only those three cases are being rerun. The 103 passing files include the actual
renderer cache/identity/interruption test and 1 MiB/8 MiB acceptance/rejection
boundaries. The offline relocated opaque-frame report exercised prepared SVG,
filtering, local feedback and 375/390 px themes/focus with zero network requests
and zero browser errors; its JSON/screenshots survive outside fixture teardown.

Final browser retries passed all six previously failing cases in 17.687 s. A broad
notification's `work_all` directive had been lost while unioning scopes; the merge
now retains it and promotes coalesced issue hints rather than losing off-page
updates. The pure ordering/feed regressions passed. Malformed SSE proof now holds
the replacement bootstrap long enough to assert retained widgets/error, then
releases it and requires restoration. The optional-chunk retry test respects the
narrow inspector's modal accessibility boundary. Visual inspection confirmed its
375 px error panel and recovered desktop composer retain the draft.

The subsequent native retry passed reply recovery and compact continuation, and
the browser/native workspace retry passed complete approval/report/retirement/
restart/old-receipt behavior. The broad native journey uncovered missing-issue
classification and ordinary coherent-read contention in old success assertions.
Missing semantic failures are preserved; only exhausted coherence errors are
reported as temporarily unavailable. Read-only native success assertions may
retry that exact temporary class for five seconds, with no mutation replay.
The work-list/status tool projections were also consolidated onto the same capture
owner (including requested raw backup/history) and carry additive retained-source
qualifiers. Fourteen focused coherence/real plugin integration tests and runtime
checking passed after this final boundary correction. Its original native journey
is still pending; no failed native attempt is counted as a pass.

## Final integrated result

All 615 unit/integration cases and all 31 E2E cases have passing coverage across
the full attempts and their affected reruns. The required full commands were run
once during final acceptance; failed checks/cases and checks affected by fixes
were rerun selectively. Initial failures remain recorded. This is not a claim that
the first full invocations were green. The broad native journey finally passed in
339.005 s; reply recovery, compact continuation, browser/native workspace, frozen
installation and development/HMR also passed. Native JSON records report cleanup
complete; the separate resource inventory confirms every named native fixture root
was removed. Fixture Review exercises the product workflow and does not constitute
independent Review of this implementation.

Final Effect diagnostics checked 359 files with zero errors/warnings. Required
build, configuration-schema, license and strict OpenSpec checks passed. A later
renderer optimization reran only runtime typing, strict lint and the three affected
real-renderer/concurrent-publication/offline-frame tests, all passing. The opt-in
communication benchmark now uses the public Messages constructor instead of the
removed private controller field; all 35 identical cases retain exactly the same
API/storage invocation counts as baseline (2.798 s command versus 2.817 s baseline;
that timing difference is noise, not a claimed improvement).

| Measurement                                           | Sequential baseline                                                            | Final measurement                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Empty initial complete JavaScript, gzip 6             | 970,937 bytes                                                                  | 537,472 bytes (44.6% less)                                                        |
| Populated TypeScript/table initial JavaScript, gzip 6 | 1,053,422 bytes                                                                | 832,066 bytes (21.0% less)                                                        |
| Initially requested scripts, empty/populated          | 4 / 13                                                                         | 6 / 17; complete graph counts retained                                            |
| Initial observation/work finder reads                 | 2 / 2                                                                          | 1 / 1                                                                             |
| Two unchanged five-second fallbacks                   | 2 work refetches                                                               | 0 work refetches, 0 state/message events, 2 freshness events                      |
| Transcript-only work refetches                        | Broad invalidation                                                             | 0                                                                                 |
| Selected task among 76 executions                     | 4 collection scans, 2 readiness passes, 75 unrelated native reads, 1 lead scan | 1 exact record get; zero scans/readiness/unrelated reads                          |
| Application compilers for two distinct exports        | 2                                                                              | 1 cold preparation; 0 for either document afterward                               |
| Fast pure/in-memory tier                              | No named tier                                                                  | 48 cases, 5.908 s with optional Git/native/browser executables explicitly refused |

The final export probe recorded a 3.085 s cold shell preparation and 2.836/2.040 s
for its two SVG documents. Baseline documents took 2.194/2.167 s each with separate
application compilations. Thus the compiler-count requirement passes, but the
cold two-document total remains slower (7.961 s versus 4.361 s); no whole-pipeline
latency improvement is claimed. Avoiding duplicate source verification and bounded
eight-file parallel reads improved the new route while retaining final fresh
source/cache byte validation. Tests explicitly refuse a source change after an
in-memory verified shell was obtained and refuse corrupt on-disk cache bytes.
SVG preparation and full input verification remain visible costs.

`acceptance-summary.json`, command receipts, product-source digest, source
manifests, benchmark comparison and cleanup summary in the external evidence root
are the final handoff index. Config/schema and licensing passed concurrently; the
external logger initially allocated a shared receipt slot. Their actual successful
exits and mixed-prefix log are retained with an explicit provenance note and a
recovered config receipt; those overlapping durations are excluded from sequential
performance comparisons. No successful check was repeated merely for that logging
repair.

Independent Review submission remains a controller action. No Supervisor/controller
tools are connected to this Codex session. The completed source and proof are
prepared for that handoff; no approval, archive, commit, delivery or issue closure
was fabricated.

## User acceptance

On 2026-11-16, after the remaining controller Review submission was identified as
the sole blocker, the user explicitly accepted the result and requested success.
Task 10.5 is closed under that acceptance; independent Review submission was
waived. This records user acceptance, not an independent Review report or a
controller approval, archive, commit, delivery or issue closure. Product code and
its retained verification evidence are unchanged.

## Finder pagination and initial browser graph follow-up

The comparison exercises the real SQLite finder before and after indexed locale
ordering. The base graph implementation is from `9b7990b`. Both runs used
Node 26.13.0 with the default en-US collation, a fresh synthetic v7 database per
population, and one warm-up followed by seven measured calls per case. Fixture
IDs are sequential, priorities rotate across five levels, 10% are closed, two
repositories alternate, and one quarter of titles use “ÉTUDE example”.
The later offset is 10% of the unfiltered population. Times are medians in
milliseconds for SQL ordering, count, offset and page hydration combined.
Exact counting and later offsets still incur SQL scanning, especially for
case-insensitive substring matching.

A sortable-key prototype compared 265,980 short supported identifiers. It
matched en-US in that sample and disagreed with the Czech and Danish locale
comparators. The shipped index assigns durable order using the actual runtime
comparison and backfills legacy identifiers on open.

| Population | Active filter | Offset | Limit | Matching | Before ms | Indexed ms |
| ---------: | ------------- | -----: | ----: | -------: | --------: | ---------: |
|      1,000 | active        |      0 |     1 |      900 |     0.928 |      0.212 |
|      1,000 | active        |      0 |    50 |      900 |     1.344 |      0.781 |
|      1,000 | active        |    100 |     1 |      900 |     0.828 |      0.183 |
|      1,000 | active        |    100 |    50 |      900 |     1.160 |      0.639 |
|      1,000 | repository    |      0 |     1 |      400 |     0.490 |      0.158 |
|      1,000 | repository    |      0 |    50 |      400 |     0.833 |      0.747 |
|      1,000 | repository    |    100 |     1 |      400 |     0.535 |      0.294 |
|      1,000 | repository    |    100 |    50 |      400 |     1.035 |      0.818 |
|      1,000 | substring     |      0 |     1 |      200 |     1.446 |      0.649 |
|      1,000 | substring     |      0 |    50 |      200 |     1.710 |      1.289 |
|      1,000 | substring     |    100 |     1 |      200 |     1.667 |      0.879 |
|      1,000 | substring     |    100 |    50 |      200 |     3.024 |      1.697 |
|     50,000 | active        |      0 |     1 |   45,000 |    38.846 |      1.851 |
|     50,000 | active        |      0 |    50 |   45,000 |    39.014 |      2.167 |
|     50,000 | active        |  5,000 |     1 |   45,000 |    44.989 |      5.279 |
|     50,000 | active        |  5,000 |    50 |   45,000 |    44.788 |      5.495 |
|     50,000 | repository    |      0 |     1 |   20,000 |    20.668 |      4.400 |
|     50,000 | repository    |      0 |    50 |   20,000 |    21.376 |      4.067 |
|     50,000 | repository    |  5,000 |     1 |   20,000 |    27.255 |      6.055 |
|     50,000 | repository    |  5,000 |    50 |   20,000 |    28.033 |      7.056 |
|     50,000 | substring     |      0 |     1 |   10,000 |    63.959 |     35.502 |
|     50,000 | substring     |      0 |    50 |   10,000 |    63.654 |     30.318 |
|     50,000 | substring     |  5,000 |     1 |   10,000 |    80.568 |     43.728 |
|     50,000 | substring     |  5,000 |    50 |   10,000 |    84.096 |     43.570 |

Each run hydrated only the returned issue rows. The old adapter also loaded and
ranked one application-side ID per match. The indexed adapter does neither.
The page projection integration test separately observes one page-row query,
zero population record scans and zero native observations for a queued,
unassigned result. Selected active worker evidence may add one native
observation per selected worker. The same suite verifies bounded revision
retry and that a suspended fleet calculation cannot delay a finder read.
The browser receives revisioned, independently refreshed fleet totals.

A separate production read-model probe matched the committed base against the
new finder with no HTTP or browser overhead. It seeded the requested number
of open issues plus an unrelated retained planning execution, warmed each
query once, searched for the open issues and took one timed sample. The new
read ran with the capacity summary warmed separately.

| Matching issues | Page limit | Full issues hydrated, base / new | Page issues hydrated, base / new | Base sample | New sample |
| --------------: | ---------: | -------------------------------: | -------------------------------: | ----------: | ---------: |
|           1,000 |          1 |                        1,001 / 0 |                            1 / 1 |      156 ms |       2 ms |
|           1,000 |         50 |                        1,001 / 0 |                          50 / 50 |      163 ms |      10 ms |
|          50,000 |          1 |                       50,001 / 0 |                            1 / 1 |   66,758 ms |      16 ms |
|          50,000 |         50 |                       50,001 / 0 |                          50 / 50 |   57,243 ms |      23 ms |

Each base request scanned all project, execution and setup collections once.
The new request uses one lookup for the shared project and one execution
lookup per returned issue, with zero collection scans. No native reads were issued
for these unassigned page rows or the unrelated retained plan. The probe's
single latency samples illustrate the eliminated population work. The SQL
medians above describe the underlying adapter independently.

The production browser performance fixture was run on a disposable archive of
`9b7990b` and on the working source, both with Node 26.13.0 and pnpm 12.21.0.
The committed base used the measurement-only option to retain both graph
measurements. Working source ran the ordinary budget assertions. Review
controls and the dedicated review HTTP contract are deferred via
`interactive-review-loader.tsx` and `review-data.ts`. Browser scenarios still
exercise review, Markdown, diffs and inspection through their normal entries.

| Messages | Base fetched JS gzip bytes | Working fetched JS gzip bytes | Existing ceiling |
| -------: | -------------------------: | ----------------------------: | ---------------: |
|        0 |                    539,983 |                       533,400 |          536,000 |
|    1,000 |                    752,117 |                       745,425 |          748,000 |

The byte counts include script responses requested during startup and every
declared preload. The production fixture also exercises the retained
conversation render locality assertions. Its measured external browser graph
can differ from the sum of the HTML's own script declarations.

### Integrated verification

On 2026-11-18, `pnpm check` passed with zero Effect diagnostics.
`pnpm test:all` passed 737 tests across 130 files, including the native
workspace plan-approval journey and the interactive feedback browser journey.
The focused suites covered legacy database ordering, cross-process record
ownership, pending review reads and restart, and archive and worktree
observation failures. The OpenSpec change passed strict validation.

### Follow-ups retained from the audit

- Keep future execution write changes with the Records owner. Migrate one
  command family to explicit committed values and prove generation, operation,
  revision and field-ownership checks before expanding to other callers.
- Review the standalone diagram preparation command with the frozen exporter
  owner. Check operator callers and the renderer manifest's role in retained
  fingerprints and pending exports before retiring the script.
- Narrow remaining workflow read ports and remove private contract forwarding
  files when a caller moves to its owning interface. Keep shared schemas,
  package interfaces and stored evidence stable through those changes.
