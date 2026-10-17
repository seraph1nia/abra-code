# Preservation, retirement and restart

## Sub-features

Preserved branch/merge evidence, conservative temporary-resource disposal, restart without repeat delivery, and retained worker-admission compatibility.

## How to get to it (user POV)

The controller owns delivery and retirement after verification and Review. An ignored fixture residue deliberately blocks removal. Inspect status/detail after restarting the fixture service; resolve only fixture-owned residue and explicitly finish through the controller.

## Driving it with the existing harnesses

After the [recipe prerequisites](../README.md#prepare-and-check-health), run:

```sh
pnpm exec vp test run --project e2e tests/e2e/native.test.ts
pnpm exec vp test run --project unit tests/unit/retirement.test.ts tests/unit/worker-lifecycle.test.ts tests/unit/engineering-recovery.test.ts
```

Native expected state: delivery is verified while cleanup remains blocked across a service restart; clearing only the known fixture residue permits retirement/closure, and the recording forge counts exactly one merge. Archived report/diff and captured context identity remain inspectable afterward. The native suite uses only local bare remotes.

Unit expected state: unknown/replacement paths survive cleanup, lost removal responses reconcile without another removal, and uncertain admissions preserve prompt/session/payload identities across controller reconstruction. Native-runtime preflight tests serialize a pre-suite capture, expose only old skill inventory, and require its exact requirements/provenance. Lost admitted responses skip inventory. Incompatible permission policy still blocks unsubmitted recovery; a deliberate fresh turn selects current defaults.

The tests own their temp roots and cleanup; preserve runner logs using the recipe's external evidence directory. Unit fixtures do not start a service and need no browser.

## Gotchas

These assertions describe exercised behavior, not all outcomes proposed in the separate `complete-work-reliably` change. Its uncompleted tasks and proposed finishing decisions are outside this recipe's claim. Scripted native acceptance and unit reconstruction are identified separately; neither establishes production restart behavior under every failure.
