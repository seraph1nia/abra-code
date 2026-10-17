# Tasks

## 1. Baseline and central CLI setup

- [x] 1.1 Confirm `unify-worker-policy-and-context` is complete/synced and read the canonical `worker-policy` requirement before implementation; verify this change's dependent replacement still matches its source and retain the predecessor's artifacts without editing them.
- [x] 1.2 Pin `agent-browser@0.39.1` in the root development dependencies, allow its reviewed native postinstall in `pnpm-workspace.yaml`, and update `pnpm-lock.yaml`; verify a frozen dependency installation, the absolute central executable's `--version`, and `skills get core` work without a global installation.
- [x] 1.3 Add `browser:install`, extend `scripts/doctor.ts` with the central CLI version check and actionable setup guidance, and document service-user Chrome/system-browser setup in `docs/configuration.md` and `docs/operations.md`; verify routine diagnostics invoke no browser install/launch/repair command, missing native binaries produce actionable failures, and the documented CachyOS route does not rely on unsupported pacman handling in `--with-deps`.
- [x] 1.4 Add explicit browser provisioning to `.github/workflows/test.yml` for its Ubuntu runner and document local E2E prerequisites in `docs/testing.md`; verify the provisioning command uses the pinned CLI and browser-dependent acceptance fails clearly instead of silently skipping when setup is absent.

## 2. Shared browser skill and worker capability requirements

- [x] 2.1 Create the thin `.agents/skills/browser/SKILL.md` and register `crew-browser` centrally and at every worker location through `src/opencode/skills.ts`; verify frontmatter and examples, runtime loading through `agent-browser skills get core`, preservation of existing skills, and native discovery in a disposable foreign repository without modifying its control files.
- [x] 2.2 Add the browser skill and appropriate effective native shell prerequisite to the role-policy capability defaults for every worker/workflow combination; update focused capability tests to verify missing browser guidance or tools blocks through existing diagnostics while research/lightweight work still requires no OpenSpec setup. Document the default prerequisites in `docs/configuration.md`.

## 3. Native CLI permissions and role guidance

- [x] 3.1 Extend `src/opencode/role-policy.ts` with browser-only native shell command permissions for Explore, Review and Research while retaining Apply's development shell and the Supervisor's restrictions; verify policy tests and the pinned native tool executor permit agent-browser, reject unrelated commands including a disallowed command chained to a browser command, and retain inactive-session, native editing and management guards. Keep command scope in the authoritative policy and do not add a custom parser or browser tool.
- [x] 3.2 Replace conflicting blanket shell prohibitions in worker prompts, role Markdown and shared execution guidance with the browser exception; update `docs/architecture.md` and `docs/supported-apis.md`, and verify the guidance agrees with enforced permissions, preserves all checkpoint/report contracts, and describes trusted CLI execution without claiming filesystem sandboxing.

## 4. Worker context, browser identity and screenshots

- [x] 4.1 Include the short browser-use nudge, `crew-browser`, `opencrew-<native-session-id>` browser name and assigned screenshot directory in newly captured worker context; verify immutable-context tests preserve old admissions and show stable naming for a continuing session and distinct naming for replacement or concurrent sessions. Record the expected policy-compatibility recovery in `docs/recovery.md`.
- [x] 4.2 Supply `<home>/.opencrew/browser/<native-session-id>/` and its narrowly scoped native read permission during worker session creation; verify a captured screenshot can be read from that directory, sibling evidence directories receive no additional read grant, and browser artifacts do not dirty the managed repository. Update the skill's screenshot examples and file-location guidance with the same directory convention.
- [x] 4.3 Document and exercise direct named CLI usage, fresh browser state, closing only the assigned browser, and reporting unreachable application prerequisites through existing worker reports; verify the skill contains no shared-default-session, blanket close, automatic personal-profile reuse or arbitrary server-start instruction. Explain scratch screenshot availability in `docs/operations.md` without promising durable report attachments.

## 5. Integrated acceptance

- [x] 5.1 Extend the existing native E2E harness with all four worker roles in disposable foreign worktrees: load `crew-browser`, call the pinned CLI against a local HTTP fixture, inspect a snapshot, interact with a fixture control, save/read a screenshot, and close the named browser. Verify all roles actually execute the CLI, two concurrent browser sessions retain separate navigation/state, closing one leaves the other usable, and repositories/control files remain unchanged. Retain concrete native/browser acceptance evidence in `docs/supported-apis.md` and `docs/testing.md`; use local remotes only and no personal browser profiles or user remotes.
- [x] 5.2 Run `pnpm check`, `pnpm test` and `pnpm test:e2e` after explicit browser setup, resolving failures attributable to this change; verify existing approval/delivery, research reporting, context recovery and role-scope scenarios still pass.
- [x] 5.3 Run `openspec validate add-agent-browser --strict` and assess implementation evidence against every delta scenario; verify the predecessor's canonical role-policy requirement is present before spec synchronization/archival and mark tasks complete only for behavior actually verified.
