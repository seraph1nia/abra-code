# Design

## Context

See `proposal.md` for motivation and the delta specifications for behavior. The relevant existing mechanisms are:

- `src/opencode/skills.ts` loads central `.agents/skills/<name>/SKILL.md` files and registers `abra-*` identities through the pinned native skill transform. Foreign locations currently receive execution and browser guidance without copying repository control files.
- `src/opencode/role-policy.ts` owns tool permissions and workflow/default capability prerequisites. `resolveSkills` checks exact native IDs and records path, digest, source and `loading: unobserved`.
- `WorkerContexts.prepare` captures role Markdown, generated prompt and the selected environment before submission. `NativeRuntime.preflight` reconciles native admission before inventory checks, but its captured-profile branch currently feeds retained configured requirements back through current role defaults. Adding defaults therefore needs a recovery regression, not just a longer registration list.
- Explore can edit only its change. Review and Research are repository-read-only and have browser-only shell access. Apply has development shell authority but no supported delegation or lifecycle management tools.
- Controller verification binds successful configured commands to a worktree fingerprint. Independent Review uses the existing full-spec dimensions or lightweight report. There is no general durable Apply proof-report API, and a progress summary or inaccessible scratch path is not a substitute for one.
- Native E2E installs current source into disposable homes, uses local repositories and a fake forge, and already tests native skill loading, browser tools, approval, correction and restart behavior.

## Goals / Non-Goals

**Goals:** Make the five techniques available and actionable through explicit role-specific pointers; preserve captured-admission compatibility; provide a concrete reusable verification recipe; and validate actual native discovery/loading and unchanged role restrictions.

**Non-Goals:** Importing either collection's router, ticket tracker, orchestration, model-selection, autonomous loop, review panel, shipping or cleanup workflows; adding TDD, grilling, retro or a new code-review skill; changing approval/correction policy; introducing a proof storage service, report schema, phase or skill-completion gate; and implementing the separate finishing change.

## Decisions

### 1. Ship five self-contained, namespaced adaptations

Author `.agents/skills/{codebase-design,domain-modeling,diagnosing-bugs,verification,blast-radius}/SKILL.md` and register them as the five `abra-*` IDs in the proposal. Use the existing `registerSkills` mechanism at both central and worker locations. Keep required procedure content self-contained or in explicitly reachable installed references; do not leave upstream `Task`, Cursor rule, global-home or unavailable skill dependencies behind.

Record the upstream URLs, inspected immutable revisions, adaptation differences and attribution in `docs/engineering-skills.md`. Preserve supplied notices and extend `THIRD_PARTY_NOTICES.md`, `licenses/inventory.json` and license texts where content is copied or adapted under upstream terms. The implementation must inspect actual source/license evidence rather than assume a blog's package description establishes rights. No runtime upstream fetches or package installation are necessary.

Alternative: install whole upstream packages into managed repositories. Rejected because it duplicates workflow ownership, assumes unavailable tools, and mutates foreign control files. Local user skills retain their own IDs and remain available; the bundled names use the existing AbraCode namespace.

### 2. Resolve role defaults, load procedures conditionally

Keep a small shared role-to-skill selection, used by capability resolution and prompt generation rather than maintaining independent lists that can drift:

| Role / workflow                  | New default prerequisites                      | When guidance is used                                                                                                                                       |
| -------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explore, full-spec               | codebase-design, domain-modeling, verification | Design/ownership decisions, ambiguous domain terms, and planning observable acceptance proof                                                                |
| Apply, full-spec or lightweight  | all five                                       | Design changes, scoped terminology changes, difficult bugs, relevant behavioral verification, and changes with a concrete safety assumption beyond the diff |
| Review, full-spec or lightweight | codebase-design, verification, blast-radius    | Read-only assessment of applicable design and runtime proof against the current verified content                                                            |
| Research-only                    | none from this suite                           | Existing read-only research contract and optional browser guidance continue                                                                                 |

Entries above abbreviate the `abra-*` IDs. Default prerequisites guarantee availability, not mandatory invocation of every skill. Role prompts explain the triggers and load relevant leaves through the native skill tool. Trivial changes do not acquire a compulsory architecture review, multi-hypothesis investigation or recipe-generation task. Existing workflow/configured requirements remain additive, and `abra-openspec-execution` remains required for full-spec work.

Adjust role Markdown and generated prompts with concise conditional references; extend shared execution guidance only where needed to explain the handoffs. Avoid copying complete skill bodies into always-loaded context. Central Abra can discover the suite, but the references explicitly direct shell/edit work to the assigned role; central availability grants no implementation tools.

Alternative: expose the skills without integrating role guidance. Rejected because discoverability alone would not implement their place in the loop. Requiring every technique for every task would add cost without corresponding evidence.

### 3. Preserve captured prerequisites during recovery

For a new prompt, derive defaults from its role/workflow and merge configured requirements as today. For a retained captured prompt, validate the exact captured requirement groups and skill IDs instead of expanding them with new defaults. Preserve their existing provenance; do not relabel a default as a user-configured requirement merely to reuse a resolver. Continue checking actual tools before provider work and current permission-policy compatibility. A permission-policy mismatch remains a blocker, not a reason to restore forbidden capabilities.

Do not alter the permission-policy hash merely to add guidance. Do not migrate old captured contexts, infer historical skill consumption or replay an already admitted prompt. A deliberate new turn obtains the current skill selection and a fresh captured identity. Tests must cover both lost-response/admitted recovery and captured-but-not-admitted recovery with an inventory that lacks the newly shipped suite.

Alternative: let role defaults expand on every preflight. Rejected because the same retained prompt would acquire new admission prerequisites after an upgrade, despite its captured environment remaining unchanged.

### 4. Adapt each inner loop to its existing authority

- **Design:** Start with caller use, interface obligations, ownership and observable tests. Record alternatives in the actual planning artifact; no parallel design agents or extra implementation approval mechanism is introduced.
- **Domain modeling:** Read the repository's vocabulary and decisions first. Explore proposes definitions and documentation tasks in its change. Apply updates a glossary/ADR only within accepted scope; Review reads them. Existing vocabulary files are respected without forcing a new `GLOSSARY.md` layout on every repository.
- **Diagnosis:** Establish a red-capable reproduction of the specific symptom, constrain nondeterminism, test hypotheses and rerun the original case. Use the appropriate actual interface; superficial tests that cannot express the bug are not proof. Missing environments and out-of-scope findings use existing questions/progress/waits and finite correction policy.
- **Verification:** Choose relevant repository commands or recipes, observe the actual result and preserve useful proof artifacts. Apply may start isolated scoped instances. Browser-only roles use existing browser permissions and report unavailable instances; they do not start arbitrary servers or scripts.
- **Blast radius:** Identify a concrete safety dependency such as old record decoding, retry convergence or external contract compatibility. Produce a small rerunnable test/script or application observation in authorized scope. Record proven, cleared and unproven cases; do not manufacture probabilities or expand scope into unrelated repairs.

Skill examples use the actual native tools and explicitly leave commit, archive, push, merge, disposal and issue closure to the controller. Temporary verification cleanup means the process/browser/scratch resources that run created, not native execution retirement or arbitrary repository deletion.

### 5. Use repository recipes without another skill registry

The portable `abra-verification` skill defines a short recipe format and how to discover a relevant existing recipe through repository instructions or local native skills. It also explains how to author a recipe when that is explicitly part of accepted Apply scope. It does not run a generator automatically when a recipe is missing.

Seed AbraCode's recipe as `docs/verification/README.md` with a small `docs/verification/features/` map, linked from existing testing documentation and a concise instruction pointer. The map describes full-spec approval/implementation, lightweight correction and supported preservation/retirement/restart journeys. Each entry names its existing harness path or supported command, setup/health preconditions, meaningful expected state, retained output location and limitations. Use the existing test runner and E2E fixture lifecycle rather than launch the operator's `pnpm start` service or duplicate a test framework. This recipe is documentation consumed by `abra-verification`, not a sixth portable skill advertised in foreign repositories.

The recipe must be exercised once end to end. Document existing fixture controls and failure-artifact behavior accurately. If a documented invocation needs a small harness improvement to expose a reliable result or retain evidence outside teardown, that change remains inside the existing isolated harness. Never mark synthetic model-scripted acceptance as a measurement of autonomous model quality.

Alternative: automatically create per-repository verification skills or globally register `verify-abracode`. Rejected because absent recipes do not grant write scope, and AbraCode-specific journeys would be misleading at unrelated worker locations.

### 6. Assess proof through existing content and receipts

Prefer reproducible tests/scripts within accepted scope that the configured controller checks exercise. Review reads those files, accepted scenarios and matching command receipts; permitted browser observations can supplement them. The review instructions explicitly include current staged, unstaged and untracked content and do not prescribe upstream `git diff <base>...HEAD` as the complete changeset.

Apply can summarize ad hoc observations through its normal reporting tools, but this change does not claim those summaries are automatically copied into Review or durably attached. A proof that exists only in an inaccessible transcript or deleted scratch file remains unavailable. Required evidence must be made available through existing authorized content/check mechanisms or reported as not verified. Full-spec Review keeps its existing dimension statuses/conflicts; lightweight Review reports against its scope. Suggestions do not become new accepted requirements.

This keeps enforcement in the controller's existing fingerprints, required checks and report validation. Instructions improve procedure; neither skill registration nor successful loading proves compliance. A broader retained Apply evidence contract is intentionally outside this change.

## Risks / Trade-offs

- [Additional context and procedural overhead] → Use short descriptions and role-specific triggers; load leaves conditionally, with explicit cheap paths for trivial changes.
- [Instructions cannot guarantee agent judgment] → Test real loading and observable controlled journeys, retain independent Review, and label scripted acceptance accurately. Do not promise a measured quality improvement without evaluation data.
- [Upstream workflows leak authority through examples] → Adapt all tool names, write locations and completion actions; exercise negative native calls after skill loading and review the shipped content for unsupported dependencies.
- [New defaults change old admissions] → Resolve retained contexts without recomputing defaults and test recovery with absent new skills and changed source files.
- [Proof modifies the tree after verification] → Keep configured checks non-mutating under the existing fingerprint rule; capture scratch output outside source or prepare authorized test artifacts before controller verification.
- [Verification map drifts] → Keep it small, link real harness entry points and require any change to a mapped journey to update its documentation in the same scoped work.
- [Concurrent finishing work changes recipe expectations] → Reuse behavior and commands available at the implementation baseline; do not claim incomplete finishing behavior or edit that change's artifacts.

## Migration Plan

1. Bundle and attribute the adapted skills, then register them using the supported native transform.
2. Add role selection and recovery-safe captured-requirement handling before enabling the new default pointers. Existing config files need no new field or setup command.
3. Add the scoped procedures and AbraCode recipe, exercise native foreign-location loading and execute a mapped isolated journey.
4. Run the repository checks and strict change validation. Deploy through the normal service update path after implementation review; retained prompts keep their captured environment and new turns use the suite.

Rollback removes the new default selection and guidance before removing bundled assets. Retain assets while captured admissions still reference them, or surface a normal explicit capability blocker and request a deliberate new turn. Do not rewrite captured history or replay native prompts to force rollback completion.
