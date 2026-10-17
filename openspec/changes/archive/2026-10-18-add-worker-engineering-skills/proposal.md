# Proposal

## Why

AbraCode already enforces execution and delivery checkpoints, but its workers have little shared guidance for choosing a design, diagnosing a difficult failure or proving the changed behavior. The selected AI Hero and pstack techniques can make those inner loops more repeatable without creating another owner of tasks, status or authorization.

## What Changes

- Ship five concise, offline AbraCode skill adaptations: `abra-codebase-design`, `abra-domain-modeling`, `abra-diagnosing-bugs`, `abra-verification` and `abra-blast-radius`. Preserve upstream attribution and record the inspected source revisions and any copied-source license evidence.
- Register the portable skills through the existing native skill transform at central and worker locations, preserving repository instructions and local skills. Add role-specific prerequisites and explicit conditional loading guidance for new coding admissions rather than inlining every procedure into every prompt.
- Guide Explore toward caller-facing designs, precise domain terms and planned behavioral proof; guide Apply toward scoped diagnosis, reproducible verification and targeted safety proofs; guide independent Review to assess that evidence against the exact current worktree and existing report dimensions.
- Adapt verification-recipe creation and use into approved repository work. Seed an AbraCode-specific recipe and feature map using its existing disposable-repository/native E2E harness; foreign repositories use their own documented commands and locally available recipes, with missing prerequisites reported explicitly.
- Keep domain glossary and architecture-decision updates within the assigned write scope. A terminology decision does not authorize root documentation edits during Explore or changes to accepted requirements during Apply.
- Retain current controller checks, report contracts, approvals, correction budgets, archive, delivery and resource disposal. Availability, loading and behavioral proof remain distinct observations; no new skill-completion gate or autonomous shipping loop is introduced.

## Capabilities

### New Capabilities

- `worker-engineering`: Role-aware use of the five bounded engineering techniques, scoped verification recipes and evidence assessment within the existing execution loop.

### Modified Capabilities

- `worker-context`: Select and retain the bundled role-relevant skill prerequisites and conditional guidance for new coding admissions without retrofitting historical or uncertain admissions.

## Impact

Expected implementation areas are `.agents/skills/`, `.opencode/agents/`, `src/opencode/skills.ts`, role capability selection, worker prompt/context assembly, a repository-owned verification recipe, documentation and native/unit acceptance fixtures. Existing native skill registration and report submission APIs suffice; no new service, provider configuration, model panel, permissions, workflow policy, tool endpoint or storage migration is planned. The independent `complete-work-reliably` change retains ownership of finishing behavior; this work documents and exercises only behavior actually present in the implementation baseline. Implementation validation includes `pnpm check`, `pnpm test`, `pnpm test:e2e`, copied-source license checks when applicable, and strict OpenSpec validation. Tests and recipe runs must use temporary repositories and local/fake remotes.
