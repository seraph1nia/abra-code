# Lightweight correction

## Sub-features

Short accepted contract without OpenSpec setup, role-specific skills, native reporting, required checks, independent Review and finite corrections.

## How to get to it (user POV)

The native harness registers a repository with OpenSpec removed and creates a `lightweight-fix` issue linked to its completed research report. Start it through the controller; no planning package is generated.

## Driving it with the native harness

After the [recipe prerequisites](../README.md#prepare-and-check-health), run `pnpm exec vp test run --project e2e tests/e2e/native.test.ts`. “Small native fix” fails the initial independent Review, takes one approved in-scope correction and completes with verification, Review and delivery receipts and no archive path. “Exhaust native correction budget” remains blocked with one round and an open budget-exhaustion decision. Both load applicable engineering skills before reporting; loading cannot reset that budget.

Expected health and isolation are the same as the full-spec recipe. Native assertions and the runner's result are the evidence; retain the runner log outside teardown using the recipe invocation.

## Gotchas

These are deterministic model-scripted reports and local branches. They do not measure agent ability to identify an arbitrary real bug. A missing recipe does not trigger writing one; existing documented checks remain valid. Lightweight Review keeps its short report contract rather than inventing full-spec assessment fields.
