# Tasks

## 1. Source licensing and release evidence

- [x] 1.1 Add the root MIT license for project-owned material and matching license metadata for the root, plugin and reporter packages; verify license text/ownership and package metadata agree without replacing upstream notices.
- [x] 1.2 Produce a versioned inventory from the frozen workspace lock and actual source/native assets, distinguishing runtime, build/report-authoring, generated skills, downloaded executables and optional external tools; verify it covers all direct packages and explains the transitive MPL/EPL/Creative Commons findings and Khroma's actual license file.
- [x] 1.3 Add required third-party license texts/notices and provenance for included upstream-derived OpenSpec instructions, skills, templates and assets; verify each inventory obligation has a concrete distributed notice or source-availability disposition.
- [x] 1.4 Add a reproducible release-license check and fixtures for unreviewed components, changed versions, missing actual licenses and stale notices; verify those cases fail while a reviewed mixed-license fixture passes without assuming all components are MIT.
- [x] 1.5 Document project licensing, third-party scope and external provider/tool terms in the README and contributor/release guidance; verify links resolve to shipped evidence and no text claims blanket MIT relicensing or completed legal clearance before the audit passes.

## 2. Versioned personal configuration and model resolution

- [x] 2.1 Extend the owned input/resolved Effect contracts in `src/config/` with required `version: 1`, `models.default` and complete `models.overrides` for the five existing roles; verify default inheritance, independent overrides and omitted-variant behavior in contract tests.
- [x] 2.2 Decode user YAML with duplicate-key diagnostics and reject unknown owned settings, malformed/unsupported versions, invalid limits and missing default models; verify invalid inputs fail before runtime directory, service or database creation while additive native/durable decoders remain compatible.
- [x] 2.3 Centralize the fresh AbraCode naming/path contract, including `ABRACODE_HOME`, `ABRACODE_CONFIG`, `.abracode/` and config-relative application defaults; verify default/alternate config selection consistently reaches startup and tools and old environment names do not adopt legacy state.
- [x] 2.4 Add `abracode.example.yaml`, derive `abracode.schema.json` from the same input contract and add schema-drift validation; verify the example parses with explicit model placeholders and each documented role override is accepted without a personal provider choice in tracked host files.
- [x] 2.5 Add exact rooted ignore entries for the actual personal file and runtime directory, retaining protection for legacy local data and trackability for source/examples/schema; verify with an isolated Git fixture that personal/generated files are ignored and required tracked files are not.
- [x] 2.6 Update the configuration guide with the model precedence, native variant semantics, deterministic defaults, role mapping to Abra, secret storage and file ownership; verify documented examples with the actual config decoder.

## 3. Static diagnostics and generated native bootstrap

- [x] 3.1 Add `config:validate` and `config:show` commands with bounded text/JSON output, resolved model provenance and redaction; verify offline CLI fixtures create no state/database/service, make no network/tool-install calls and return nonzero for invalid config.
- [x] 3.2 Generate OpenCode settings beneath `.abracode/` from validated configuration and tracked prompt/plugin assets, with agent ID/default `abra`; verify generation from two fresh fixture roots contains correct absolute asset paths and no tracked personal host configuration is needed.
- [x] 3.3 Update all service/client entry points to use the same generated config, native service identity, environment and home resolution; verify isolated service start/auth/attach/stop/restart argument and environment contracts, including legacy service non-adoption.
- [x] 3.4 Compose normal `pnpm start` from service discovery/bootstrap and attach to the retained Abra session while retaining a service-only start command; verify repeated launch reuses one service/session and noninteractive invocation does not hang.
- [x] 3.5 Refactor doctor into read-only, capability-aware diagnostics using configured executables and optional live native inventory; verify no database mutation, no browser provisioning, accurate missing-core failures, optional capability warnings and explicit unverified live checks when the service is absent.
- [x] 3.6 Document the actual fresh-install/authentication/launch sequence, Linux tested versions, service-only operator commands and diagnostics limits; verify the sequence runs against an isolated installed fixture without global OpenCode/OpenSpec/Bun or author-specific paths.

## 4. Authoritative repository declarations and reconciliation

- [x] 4.1 Add a document-preserving config edit seam using the existing YAML library, a dedicated cooperating-writer lock, content-conflict detection and atomic sibling replacement; verify comments/unrelated values survive and concurrent edits, unwritable files and interrupted writes preserve valid configuration.
- [x] 4.2 Change explicitly requested repository add/update tools to persist intended settings before inspected registration while preserving omitted update values; verify a failed file write cannot yield a claimed complete runtime-only registration and a saved declaration survives a remote-inspection failure.
- [x] 4.3 Add explicit `config:apply` and its central authenticated controller route using existing onboarding/identity/setup checks; verify manual YAML edits reconcile without an LLM prompt, ordinary startup/static checks do not register repositories, workers cannot invoke the route and diagnostic attention does not supply mutation authority.
- [x] 4.4 Persist bounded declaration-digest/apply outcomes and expose declared/pending, registered/ready, setup-blocked, failed and retained/undeclared status; verify response-loss retries reuse stable IDs and equivalent SSH/HTTPS remotes cannot produce duplicate registrations/clones.
- [x] 4.5 Gate new manual/scheduled starts on current applied declarations and preserve active/retired resources when a declaration is omitted; verify removal blocks new starts without deleting or closing anything, restoration reuses history and a target-policy edit does not retarget an active PR.
- [x] 4.6 Update onboarding/configuration/recovery guidance and accompanying skills for saved-versus-applied states, explicit application, partial failure, manual-edit conflicts and omission semantics; verify examples against the tool/CLI contracts and isolated local bare remotes.

## 5. Captured model and policy settings

- [x] 5.1 Capture resolved role models, relevant worker prerequisites, repository policies and config provenance at execution creation in the existing versioned record family; verify all roles receive the configured default or complete override before first worker admission.
- [x] 5.2 Replace latest-Supervisor-message/live-worker-config selection with captured execution selections throughout native preflight/session reuse/context generation; verify an Apply override is independent of Abra's session-local UI choice and an unavailable native model/variant blocks without fallback.
- [x] 5.3 Preserve captured selections across later phases, config edits, pause/resume, service restart and uncertain admission; verify changed configuration affects new executions while old prompt IDs, context and pending authorization evidence stay bound to active work.
- [x] 5.4 Update model-selection and active-work documentation/diagnostics to distinguish configured defaults, role overrides, captured selections and session-local UI choices; verify the reported provenance matches fixtures with both old active and newly started executions.

## 6. Abra as the only conversational agent

- [x] 6.1 Rename the tracked central agent guidance/profile to Abra, map native `abra` to the logical Supervisor policy and update central default/visibility and identity checks; verify Abra retains management/read tools without implementation/shell access and foreign worker-location profiles remain intact.
- [x] 6.2 Add the public native worker prompt hook bound to retained session/message intent, role, generation and captured context, covering current and historical assignments; verify unit cases reject direct/unowned queued messages and spoofed labels while accepting eligible controller prompts without nested coordination-lock acquisition.
- [x] 6.3 Extend the real native fixture to prove direct foreground/unowned queued worker prompts are refused before new worker model work, valid owned turns are unaffected and response-loss replay reuses an admitted prompt; verify paused/historical/wrong-generation cases do not regain authority.
- [x] 6.4 Route worker questions, attention and native plan/merge decision forms through the retained Abra conversation; verify restart retains question/form identity and neither Abra prose nor worker reports bypass human checkpoint receipts.
- [x] 6.5 Update central/worker skills, agent guidance and native API evidence for the sole conversation rule and prompt-hook acceptance; verify the instructions direct users to Abra and workers to their existing reporting tools without granting additional role authority.

## 7. Read-only worker inspection and terminal branding

- [x] 7.1 Replace worker chat links/pickers and automatic worker tab opening in the visibility client and TUI entrypoint with worker inspection actions; verify real terminal fixtures keep Abra focused and discovery never opens another conversational tab.
- [x] 7.2 Add bounded lazy worker transcript/evidence inspection through declared read-only observer contracts, retaining role/model/progress/decision/report details and unavailable/stale labels; verify selecting or paging inspection never submits a prompt or mutates lifecycle state.
- [x] 7.3 Preserve native status/pending synchronization, reconnect refresh, keyboard navigation and scoped disposal in inspection views; verify queued off-screen workers remain distinguishable from idle and errors do not hide unrelated tickets.
- [x] 7.4 Add AbraCode identity to the owned sidebar/work surface and a supported footer/composer-adjacent slot using host themes; verify narrow-terminal layout, dialog/editor input, remapped navigation and plugin disposal through native rendering tests.
- [x] 7.5 Update terminal operation docs and command help to describe Workers as inspection and the only conversation action as Talk to Abra; verify examples and screenshots/output match actual routes and do not promise graphical-client or host-logo replacement.

## 8. Consistent public identity and installation documentation

- [x] 8.1 Rename project-owned package/build metadata, public command/tool/skill labels, RPC/plugin namespaces and active documentation consistently using the naming contract; verify native contracts, role filtering and shipped skill discovery still pass and upstream dependency names/notices and archived history remain accurate.
- [x] 8.2 Rewrite the README around AbraCode, a tested Linux quick start, default-plus-overrides examples, repository declaration/application and Abra's sole conversational role; verify every executable step maps to a shipped command and the five-role/controller table matches enforced policy.
- [x] 8.3 Finish operator guides for GitHub auth/delivery, optional browser libraries/download, optional no-mistakes, project-specific prerequisites, troubleshooting and subsequent AbraCode updates; verify optional capabilities are distinguished from core requirements and no author-local tooling is required.
- [x] 8.4 Add fresh-install/breaking-change instructions and contributor guidance covering tests, privacy of config/state, license review and preserved legacy files; verify isolated legacy-file/service-conflict fixtures leave old data untouched and the documented checks never use a user remote.

## 9. Release acceptance across the integrated change

- [x] 9.1 Add a fresh Linux source-install acceptance path using a frozen install, temporary home/config, deterministic local provider and local bare Git remotes; verify validation, service-only auth setup, launch/reattach, explicit repository apply, work start and Abra-only question/form routing without personal credentials or global runtime tools.
- [x] 9.2 Exercise end-to-end config edits and service restart while work is retained, then remove/restore a repository declaration; verify captured selections, issue/session/worktree/form identities and history survive while new work follows applied settings.
- [x] 9.3 Wire config-schema drift, release-license readiness and isolated fresh-install acceptance into the existing Linux CI alongside project checks; verify checks identify stale/unreviewed content and CI has no credentialed user-remote push path.
- [x] 9.4 Run `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm build` and the new schema/license checks on the final implementation; record results plus actual artifact/license dispositions and any explicitly unverified optional capability before claiming release readiness.

Acceptance results and artifact/license dispositions: [release acceptance](../../../../docs/release-acceptance.md).
