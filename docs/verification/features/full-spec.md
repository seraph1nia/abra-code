# Full-spec approval and behavioral proof

## Sub-features

Portable offline skills, role permissions, plan approval, scoped diagnosis, configured controller checks, independent Review, branch preservation and dependent-work readiness.

## How to get to it (user POV)

Create/start an issue for a registered disposable repository using `abra_work_create` and `abra_work_start`. The fixture registers three local targets, advances one remote after onboarding, and verifies provisioning uses its freshly fetched base. The native harness owns setup and health checks; use the [recipe](../README.md), not manual operator-service commands.

## Driving it with the native harness

Run `pnpm exec vp test run --project e2e tests/e2e/native.test.ts` with `ABRACODE_TEST_JOURNEY=engineering` and `ABRACODE_TEST_EVIDENCE_DIR` set as shown in the recipe. The main “Sample API” issue loads applicable engineering skills through native tool calls. Explore source edits and post-loading management/delegation calls are rejected. Plan approval is required, preserved through a service restart, and replied to through Abra's native form.

Apply writes `sample-proof.mjs`, observes its consumer fail against `original`, changes the scoped source to `sample`, and reruns the original consumer successfully. Configured controller checks include that proof. Review reads `source.txt` and the untracked proof; the test records unstaged/untracked status before Review and matching check/review receipts. The expected final state is completed/closed with a preserved local branch and no registered native worktree. No skill invocation alone can establish that state.

The separate unavailable-evidence issue loads verification guidance, cannot read runtime evidence, reports correctness `not_verified` and uncertain scope, and retains an open decision without delivery. Accepted planning stays unchanged; no automatic recipe or host installation is performed. Existing local skills and foreign control files remain intact (the main issue's explicitly requested AGENTS navigation edit is checked separately).

## Gotchas

The provider scripts decisions; this does not evaluate autonomous diagnosis quality. A fake forge and loopback provider replace external systems at their existing interfaces. No live provider account, remote authorization or production environment is tested. Output paths inside the fixture are removed; only the named external evidence files survive.
