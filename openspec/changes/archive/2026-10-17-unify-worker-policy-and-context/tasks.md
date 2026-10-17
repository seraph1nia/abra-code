# Tasks

## 1. Shared role policy and native enforcement

- [x] 1.1 Add the closed typed role policy and native permission/tool projections in `src/opencode/role-policy.ts`, preserving all five existing role boundaries; verify behavior tests cover Supervisor management access, Explore change-only edits, read-only Review/Research, Apply shell access and forbidden delegation/delivery tools.
- [x] 1.2 Wire session creation, context filtering and execute-before authorization to that policy, retaining realpath, protected-control-file and patch move checks; verify the existing patch-guard suite plus direct forbidden-tool and replaced-session regression cases pass.
- [x] 1.3 Replace duplicated central Markdown/config permission tables with derived permissions for already registered native profiles, while retaining prose and native discovery metadata; verify central Supervisor restrictions and a cross-repository `build` worker through native fixtures without copying agent files into the target repository.
- [x] 1.4 Document the policy owner, Markdown/runtime distinction, native profile fallback and trusted-shell limit in `docs/architecture.md` and the central role guidance; verify examples agree with the enforced behavior and retain the current full-spec Review verification contract.

## 2. Capability declarations and worker-location skill resolution

- [x] 2.1 Extend worker configuration schemas with bounded `required_skills` identifiers and `required_tools` alternative groups, additive policy defaults and source-specific validation; verify existing configurations still decode and invalid/empty/forbidden alternatives are rejected.
- [x] 2.2 Add worker-location required-skill resolution to native preflight using the existing skill inventory and loading contract, including usable-content checks and required-source diagnostics; verify central-only, missing and unusable skills block before submission while the registered portable full-spec skill resolves in a foreign worktree.
- [x] 2.3 Select policy-required skills/tools by workflow without changing native registration ownership; verify lightweight and research assignments require no fictional OpenSpec setup, and a skill reference does not enable an otherwise forbidden tool.
- [x] 2.4 Add supported configuration examples and remediation steps to `projects.example.yaml`, `docs/configuration.md` and `docs/supported-apis.md`; verify the examples decode and distinguish prerequisites, permission grants, skill availability and observed loading.

## 3. Retained assignment context and recovery

- [x] 3.1 Add schema-derived worker-context, requirement-resolution and observation contracts plus optional execution/admission references; verify malformed records produce bounded diagnostics and legacy records decode without invented provenance.
- [x] 3.2 Implement the context assembler beside `WorkerSessions`, capturing assignment, role guidance, resolved agent/model, scope/artifact/instruction references, retained decisions and required capabilities; verify full-spec, lightweight and research fixtures produce policy-appropriate context and preserve target repository instructions.
- [x] 3.3 Persist immutable admission payloads and their execution/role references before native prompt submission, including pre-session failure evidence, and include them in the existing export/backup path; verify interrupted payload/pointer writes do not imply admission and exported records preserve readable context after worktree retirement.
- [x] 3.4 Use captured prompt text and role guidance for uncertain admission recovery, checking native inbox/transcript evidence first; extend lost-submission/lost-response tests to change source guidance and issue text between attempts and verify the same prompt identity/payload is reused without duplicate admission.
- [x] 3.5 Bind fresh turns, explicit retries and corrective rounds to new manifests while fencing stale observations by generation/session/prompt; verify a replaced callback cannot overwrite current evidence, configuration refresh does not rewrite old payloads, and paused/external-custody work is not resumed by context capture.
- [x] 3.6 Document context provenance, legacy handling, backup and policy-incompatibility recovery in `docs/operations.md` and `docs/recovery.md`; verify the documented paths correspond to exported evidence and never recommend replaying an admission whose outcome is unknown.

## 4. Effective request capability checks

- [x] 4.1 Validate required tool groups in the managed context hook after native tool shaping and role filtering, loading captured role guidance and recording actual tool/model/freshness observations; verify a permitted-but-missing required tool prevents the provider request and records a specific blocker.
- [x] 4.2 Represent editing and shell prerequisites using allowed native alternatives and preserve execution-time ownership independently of capability resolution; verify GPT-family patch-only editing succeeds while forbidden tools and escaping patch destinations remain rejected.
- [x] 4.3 Keep definitely unsubmitted prerequisite failures distinct from uncertain admission and release compute capacity only when non-submission is established; verify inventory failure, admitted-prompt inventory drift, request-time failure and incompatible policy recovery preserve prompt identity, claims, owned resources and conservative reservations.
- [x] 4.4 Update `docs/supported-apis.md` and `docs/testing.md` with evidence for the two validation stages and hook behavior; verify the deterministic-model harness distinguishes no queued prompt from an admitted prompt that failed before its provider request.

## 5. Context diagnostics

- [x] 5.1 Extend `Queries.diagnostics` and existing native output schemas with role context summaries and prerequisite blockers even when no session exists, preserving existing session/error/model fields; verify native structured output and JSON content agree for pre-session failures and ordinary managed sessions.
- [x] 5.2 Add bounded projections for context/policy identity, instruction and scope references, skill resolution, actual tool observations and clearing actions; verify missing native inventory, retired worktrees, oversized collections and legacy context remain distinguishable without exposing stored prompt bodies, credentials, environments or provider response bodies.
- [x] 5.3 Verify diagnostics reads leave approvals, context payloads, worker admission and issue state unchanged, and document how to inspect these fields in `docs/operations.md`; use before/after state assertions covering an unresolved decision and missing-capability blocker.

## 6. Integrated acceptance

- [x] 6.1 Extend native E2E coverage in disposable foreign repositories for default/custom agent selection, portable and missing skills, patch-only editing, missing effective tools, denied management calls, native restart and retained context diagnostics; verify all scenarios use deterministic providers and local remotes without pushes to user remotes.
- [x] 6.2 Run `pnpm check`, `pnpm test` and `pnpm test:e2e`, retaining results and resolving failures attributable to this change; verify existing approval/delivery, capacity, legacy-record and spec-verification Review scenarios still pass.
- [x] 6.3 Run `openspec validate unify-worker-policy-and-context --strict` and review implementation evidence against every delta scenario; verify all tracked tasks are complete and no failed or unverified applicable requirement is presented as passed.
