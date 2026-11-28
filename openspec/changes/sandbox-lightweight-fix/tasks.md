# Tasks

## 1. Prove local deployment and reconnect

- [ ] 1.1 From this checkout, bootstrap and re-bootstrap an explicitly named single-server k3d cluster with pinned Substrate, its persistent stores, an authenticated local controller connection, and one ready gVisor worker slot. Document prerequisites, health checks and explicit teardown. Keep bootstrap identity separate from the client used at runtime.
- [ ] 1.2 Provide a Skaffold profile for one-shot deployment and watch mode. Show that the image digest built by Skaffold becomes a ready Substrate template revision, existing actors keep their revision through rebuild and watch shutdown, and new work can select the new revision.
- [ ] 1.3 On k3d, drop the reply to an accepted OpenCode prompt, suspend its actor, restart the submitting client with only its retained records, and reconnect. Observe the original actor/session/prompt, exactly one provider-visible assignment and one edit. Record the tested versions and evidence before building the product integration.

Bootstrap hint: upstream provisions the certificate APIs and stores on kind. Use kind to diagnose a k3d-specific failure. Apply platform manifests or upstream charts once and reconcile actor templates through the Substrate API. Keep durable components outside Skaffold watch cleanup. [Substrate quickstart](https://ate.dev/docs/get-started/quickstart/) · [Skaffold Helm](https://skaffold.dev/docs/deployers/helm/) · [Skaffold kubectl](https://skaffold.dev/docs/deployers/kubectl/)

## 2. Send an approved lightweight fix to a sandbox

- [ ] 2.1 Expose and validate repository opt-in through ordinary configuration. Prove existing installations, historical records and other workflows retain local behavior, while a newly claimed lightweight fix keeps its captured environment across configuration changes.
- [ ] 2.2 From a normal approved issue, transfer the pinned source bundle and admit the Apply role at the remote checkout. Expose progress through Work. Verify role, model and skill preflight there and exercise denied management access. The actor receives neither a host mount nor publishing credentials.
- [ ] 2.3 Prove lost-reply reconciliation through the real controller and its stored identities. Test unreachable actors, ambiguous admission, and pause during a turn. Work must distinguish a confirmed stop from an unresolved writer.

Admission hint: consumed prompts disappear from the inbox. The native observer can also inspect session evidence. [Replay audit](../../../docs/supported-apis.md#prompt-admission-and-replay-audit)

## 3. Return, check and review one candidate

- [ ] 3.1 Receive the finished Git bundle into staging, bind its contents to the approved assignment, and adopt the candidate into the owned worktree. Exercise wrong base, stale scope, unexpected local edits and interruption during adoption. Recover the same result or surface a blocker without losing local edits.
- [ ] 3.2 Run the captured verification commands on the adopted revision in a clean verifier using the released worker slot. Preserve timeouts, command results and content-mutation checks. Failures or a changed candidate must withhold verification and delivery.
- [ ] 3.3 Present the diff and verification evidence in Work. Show that independent Review and existing delivery authorization cover the same content and that cleanup preserves the evidence after retiring the owned actors and worktree.

Attribution hint: the existing Apply completion path fingerprints the local worktree. Adoption must precede recording that attribution. [Session completion](../../../packages/runtime/src/workflow/sessions.ts) · [Check receipts and independent Review](../../../packages/runtime/src/workflow/checks.ts)

## 4. Verify the developer journey

- [ ] 4.1 Run an opt-in disposable k3d journey from ordinary Abra intake to branch preservation for the parser fixture. Retain the failing baseline, one remote edit, passing check, matching Review and branch, and cleanup evidence. Use a sandbox-reachable deterministic provider and a fixture-only bare remote.
- [ ] 4.2 Run focused regressions for environment selection, admission and adoption failures, then `pnpm check` and `pnpm test:all`. Document the separate cluster journey so routine tests work on machines without k3d.
