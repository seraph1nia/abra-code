# Full-spec approval and behavioral proof

## Sub-features

Portable offline skills, role permissions, plan approval, scoped diagnosis, configured controller checks, independent Review, branch preservation and dependent-work readiness.

## How to get to it (user POV)

Create/start an issue for a registered disposable repository using `abra_work_create` and `abra_work_start`. The fixture registers three local targets, advances one remote after onboarding, and verifies provisioning uses its freshly fetched base. The native harness owns setup and health checks; use the [recipe](../README.md), not manual operator-service commands.

## Driving it with the native harness

Run `pnpm exec vp test run --project e2e packages/runtime/tests/e2e/native.test.ts` with `ABRACODE_TEST_JOURNEY=engineering` and `ABRACODE_TEST_EVIDENCE_DIR` set as shown in the recipe. The main “Sample API” issue loads applicable engineering skills through native tool calls. Explore source edits and post-loading management/delegation calls are rejected. Plan approval is required, preserved through a service restart, and replied to through Abra's native form.

Apply writes `sample-proof.mjs`, observes its consumer fail against `original`, changes the scoped source to `sample`, and reruns the original consumer successfully. Configured controller checks include that proof. Review reads `source.txt` and the untracked proof; the test records unstaged/untracked status before Review and matching check/review receipts. The expected final state is completed/closed with a preserved local branch and no registered native worktree. No skill invocation alone can establish that state.

The separate unavailable-evidence issue loads verification guidance, cannot read runtime evidence, reports correctness `not_verified` and uncertain scope, and retains an open decision without delivery. Accepted planning stays unchanged; no automatic recipe or host installation is performed. Existing local skills and foreign control files remain intact (the main issue's explicitly requested AGENTS navigation edit is checked separately).

## Gotchas

The provider scripts decisions; this does not evaluate autonomous diagnosis quality. A fake forge and loopback provider replace external systems at their existing interfaces. No live provider account, remote authorization or production environment is tested. Output paths inside the fixture are removed; only the named external evidence files survive.

OpenSpec 2 instruction-refresh coverage also lives in
`packages/runtime/tests/integration/openspec-update.test.ts`. The controller refreshes the stale
shared generated skill before Explore and preserves its custom worker procedure.
A second real-CLI case makes all six generated workflows stale, then requires one
refresh to restore their expected content while preserving all custom skills and
role profiles. A second refresh must leave the tree byte-for-byte unchanged and
the legacy command/copy directories must remain absent throughout.
Run `pnpm exec vp test run --project integration packages/runtime/tests/integration/openspec-update.test.ts`
for that bounded proof; it supplements the full native journey above.

## Compact routine loop and retained gates

Use `ABRACODE_TEST_JOURNEY=simplify-loop` with the same native test command and a
fresh external `ABRACODE_TEST_EVIDENCE_DIR`. This journey opts in only its
disposable installation to attended automatic supervision. It commits the owned
compact schema only into disposable targets and uses their local bare remotes.

The routine issue crosses valid compact planning with no plan form, fails an
actual configured source check, consumes one in-scope repair round, passes
same-content checks and independent native Review, archives without design, and
stops at the unanswered human merge form. A selected detailed issue with
`require_plan_approval: true` stops before Apply across service restart; its form,
policy and schema binding survive and its dependent issue stays unclaimed.

Other issues prove repeated-finding refusal, a distinct exhausted-budget failure,
changed/uncertain scope decisions, and confirmed pause across restart. The test
waits for asynchronous native stop confirmation. Unanswered decisions, prior
archives and owned resources remain; reads admit no replay inbox entry. A separate
branch-preservation issue completes valid native `skip_specs: true` planning and
archival without inventing a delta. Branch preservation is separate from the
routine PR's pending merge gate.

Retained `native-engineering.json` observations record actual forms, selected
schemas, round counts, matching receipts and stop reasons; `resources.json`
records teardown. The default E2E suite includes this journey. Its scripted
provider proves lifecycle contracts and boundaries, not autonomous planning or
repair quality, external GitHub authorization, or live-provider performance.
