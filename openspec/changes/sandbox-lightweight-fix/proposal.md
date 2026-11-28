# Deliver a lightweight fix from a Substrate sandbox

## Outcome

A developer asks Abra to fix a parser bug, approves its scope, and opens the returned diff and check results in Work. OpenCode edits an isolated checkout. AbraCode retains the issue, independent Review, delivery authorization, and branch preservation. [Lightweight workflow](../../../docs/operations.md#research-and-lightweight-work)

## Scope and choices

- Build here. Opt a repository into sandboxed Apply and verification for lightweight fixes. Capture the selection at claim time. Existing installations and in-flight work keep their local behavior.
- Run the controller locally. A repo-owned bootstrap creates or reuses one named k3d server node and installs pinned Substrate, its CRDs, database, snapshot store, and a one-slot gVisor pool. Use upstream installation commands or Helm charts where provided and plain manifests for project resources. [Substrate quickstart](https://ate.dev/docs/get-started/quickstart/)
- Use Skaffold to build the worker image and publish its versioned actor template through the Substrate API. Provide a one-shot deployment and a watch loop. Persistent platform resources and task actors survive both redeployment and stopping the watch. Keep administrative credentials in bootstrap and grant the local controller a scoped authenticated route. [Skaffold deployers](https://skaffold.dev/docs/deployers/) · [Substrate architecture](https://ate.dev/docs/concepts/architecture/)
- Transfer Git bundles between the controller and isolated actor. Keep the owned local worktree for diff, Review, and delivery. A fresh verifier checks the adopted candidate using the same slot. The controller holds publishing credentials. Team hosting, previews, and multi-issue scheduling are follow-ups.

## Acceptance

The first k3d proof drops an authenticated submission reply, suspends the actor, restarts the submitting controller and observes one original assignment and edit. Kind is a diagnostic reference. The disposable AbraCode journey then shows a failing parser case, the approved edit, passing checks and independent Review for the same content, and the preserved fixture branch. A stale scope, wrong base, or failed check blocks delivery visibly in Work. [Verification recipe](../../../docs/verification/README.md) · [Prompt replay audit](../../../docs/supported-apis.md#prompt-admission-and-replay-audit)

## Capabilities

- New [sandboxed-lightweight-execution](specs/sandboxed-lightweight-execution/spec.md) covers remote admission, candidate adoption, isolated checks, and recovery under the existing lightweight policy.
