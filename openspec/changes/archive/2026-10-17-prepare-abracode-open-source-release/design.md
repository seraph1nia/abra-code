# Design

## Context

See [proposal.md](proposal.md) for motivation and agreed scope. Inspection found these concrete starting points:

- `package.json` is private, has no license field, and has no corresponding tracked root license. The reporter is a separate private workspace package. Local dependencies already pin OpenCode 2.0.28, OpenSpec 1.13.2, Effect 4.0.1 and agent-browser 0.39.1.
- `src/config/contracts.ts` and `load.ts` already decode YAML with Effect Schema and supply defaults. Missing `projects.yaml` currently becomes an empty object. `src/decode.ts` does not explicitly reject unknown configuration properties. `opencode.jsonc` separately commits a personal Supervisor model.
- YAML repositories are candidates only. `src/config/onboard.ts` writes inspected registrations through native plugin storage; it does not maintain the YAML. The SQLite work graph separately owns issue association and state.
- `scripts/start.ts` starts a service and bootstraps a Supervisor; `scripts/client.ts` attaches separately. Root configuration, lock paths, native service registration, skill paths and environment handling assume `.opencrew/` and the installation checkout. `scripts/doctor.ts` opens the work database, so it is not a read-only config validator.
- `src/workflow/sessions.ts` currently captures an initiating Supervisor model when a worker override is absent, and runtime selection still consults live worker settings. This must become explicit configuration resolution with execution snapshots.
- The TUI discovers workers and calls `tabs.open`, and worker buttons/commands route into native conversations. Existing work-visibility requirements preserve activity synchronization and read-only observer behavior; this change keeps those guarantees while changing navigation.
- Pinned public declarations expose a native session `prompt` hook, model context hooks, native agent transforms, session tabs and UI slots. Backend authorization and controller-owned recovery already exist and must remain authoritative.

The working tree also contains unrelated browser integration and workflow edits. Implementation must preserve them and use their current contracts, rather than resetting files to an earlier baseline.

## Goals / Non-Goals

**Goals:**

- Make a fresh clone sufficient as the application installation, with a short operator path and testable prerequisites.
- Give user configuration, generated host configuration and retained execution evidence distinct owners.
- Make Abra the sole normal conversational entry point, enforced for managed worker prompts as well as reflected in navigation.
- Make release licensing claims traceable to actual contents and preserve the existing controller trust boundary.

**Non-Goals:**

- npm publication, a reusable SDK, standalone executables, containers, hosted service operation, or macOS/Windows support.
- Migrating or deleting OpenCrew state, adopting old services, or moving existing worktrees.
- Forking/rebranding all of OpenCode's terminal or graphical interfaces, replacing native authentication, or providing a security sandbox against the machine's own user.
- Changing workflow selection, implementing a new scheduler, bypassing approvals, or introducing another model-bearing orchestration role.
- Publishing a GitHub repository, changing remote repository names, pushing, or opening a public release as part of implementation acceptance.

## Decisions

### 1. Keep a source application with pinned local dependencies

Retain the workspace and local dependency installation. Document the tested Linux toolchain (currently Node 24.21.0 and pnpm 11.28.5) and keep supported engine declarations consistent with the maintained test evidence. A fresh clone follows: frozen install, copy/edit example, static validation, service-only start for first authentication, native authentication, and normal launch. Provide the existing mise shortcut as an alternative to manually installing Node/pnpm, not a second required runtime.

The normal `pnpm start` becomes a convenience composition of validated service bootstrap and attaching to Abra. Keep a service-only command for auth, scripts, remote attachment and tests; stop/restart/attach/auth remain operator commands. `pnpm start` is interactive and its noninteractive behavior must fail clearly rather than hanging a smoke test. Test service bootstrap and attach separately as well as their composition.

Required local tooling remains installed even where it currently lives in `devDependencies`, so the documented install keeps `--prod=false`. Do not imply that `pnpm install --prod` supports this source distribution. The pinned OpenCode executable supplies its own native runtime; a separate global Bun/OpenCode/OpenSpec installation is unnecessary. Existing Git/flock prerequisites remain. GitHub CLI/auth, project-specific tools, browser/system libraries and no-mistakes are documented by capability; branch delivery must not fail solely because GitHub delivery is unused. Native rendering/report browser tooling remains a contributor or report-authoring prerequisite where applicable.

**Alternative considered:** publish only `dist/crew.mjs`. Rejected for this release because it omits CLI startup, prompts, skills, host configuration and ancillary tools. Preserve build verification without advertising an incomplete distributable package.

### 2. Define one versioned personal configuration

Use these installation-owned paths:

```text
abracode.example.yaml              tracked, documented placeholders
abracode.schema.json               tracked, generated from the input contract
abracode.yaml                      ignored personal configuration
.abracode/                         ignored state, locks, clones, worktrees
  config/opencode/opencode.json    generated native host configuration
  state/opencode/service.json     native service registration
  work.sqlite                     issue work graph
.agents/skills/                    tracked operational skills
.opencode/agents/abra.md           tracked central behavior guidance
```

Use rooted `/abracode.yaml` and `/.abracode/` ignore entries. Keep explicit legacy ignores for old local files so a fresh-release upgrade cannot accidentally expose them. Do not add broad YAML/JSON ignore patterns; tighten irrelevant broad database/legacy patterns where they would hide legitimate fixtures or source. Alternate personal config locations are selected by `ABRACODE_CONFIG`; `ABRACODE_HOME` consistently selects the installation root. Do not silently honor old `OPENCREW_*` configuration names. Other native provider/auth environment variables retain their upstream meaning.

Keep the existing input/resolved-contract seam in `src/config/`. Decode YAML as a document to report syntax/duplicate-key errors and preserve comments for later edits. Configuration decoding explicitly rejects unknown keys at configuration-owned boundaries; do not globally make additive upstream or durable-record decoding strict. Require `version: 1` and a model default. Use existing domain brands and schemas for repository IDs, paths, executable argv, policy and native model identity. Derive editor JSON Schema from that owned input schema and check for drift in CI.

Proposed public model shape:

```yaml
version: 1
models:
  default:
    providerID: your-provider
    id: your-model
    # variant: supported-native-variant
  overrides:
    apply:
      providerID: your-provider
      id: your-implementation-model
      # variant: supported-native-variant
workers:
  apply:
    # Native agent/capability prerequisites remain here, not another model source.
    agent: build
repositories: []
```

Keys in `models.overrides` are `supervisor`, `explore`, `apply`, `review`, `research`; README maps Supervisor to the public name Abra. Each override replaces a complete model reference. Omitting `variant` selects that model's native default, never an inherited variant. Do not add an arbitrary universal `effort` enum: native variants are model-specific. The example must clearly use placeholders and not contain a maintainer's paid provider selection. All ordinary behavioral defaults remain safe and explicit: full-openspec, manual scheduling, existing capacity defaults, approvals required and automatic repair disabled unless configured.

**Alternative considered:** keep `opencode.jsonc` as a second user-editable file. Rejected because it splits model selection and makes tracked defaults personal. Generate native settings using absolute paths to tracked application assets instead. Inventory how native per-directory/global configuration merges at the central and worker locations; preserve legitimate foreign repository configuration while ensuring every managed turn still uses its resolved, validated model and role restrictions.

### 3. Split static validation, operational diagnostics and mutation

Add `pnpm config:validate` and `pnpm config:show`, both with `--json`. They depend only on installed code and the selected file. They never open the SQLite work graph/native store or start a service. `config:show` displays canonicalized settings and model/default provenance; redact command environment values, embedded remote credentials and sensitive URLs. Resolve relative managed application defaults from the installation root and retain the existing absolute-path requirements for explicit repository paths. A missing file/default returns a specific setup diagnostic before any runtime directory/database creation.

Keep `pnpm doctor` as explicit read-only environment diagnostics, refactoring away its database-creation side effect. Report core failures separately from optional capability warnings; use configured forge executable rather than hardcoding a different one. When the service is running, inspect model/variant/skill availability through the pinned native API and label its location and freshness. A valid inventory is not proof of a successful authenticated provider request. When no service is running, report live checks as unverified rather than silently starting one. Browser download/live smoke checks remain explicit commands.

`pnpm config:apply` is intentionally mutating and requires the dedicated native service; it does not send an LLM prompt. It calls an authenticated controller route with the same authorization boundary as operator-requested central management. That route is not worker-accessible and must reject diagnostic attention as mutation authority. A successful command reports applied/pending/failed repository outcomes and whether process-level settings need restart. `service:restart` regenerates host configuration and activates validated non-repository settings. Plain startup can read declarations to block drift/new starts, but never clones/fetches/registers candidates. Document which actions require network, a running service or a restart.

**Alternative considered:** make doctor do setup automatically. Rejected because diagnostics should be safe to run before initialization and should not accidentally change the installation they are checking.

### 4. Treat YAML as desired repository settings and native records as observed state

Introduce a small configuration editing/reconciliation module in `src/config/`; reuse `Onboarding`, remote identity normalization, setup blockers and controller locks. Do not replace native storage or move execution records into YAML.

An explicitly requested add/update through Abra follows:

1. Decode the intended declaration, preserving omission semantics for updates and applying complete existing values for persisted declarations.
2. Under a config-specific lock, read the current YAML document and content digest; validate the proposed whole file and detect stable-ID/duplicate remote conflicts.
3. Persist only the affected declaration with a temporary sibling file, restrictive permissions and atomic rename. Recheck the input digest immediately before replacement and reject a detected conflict. Keep the lock out of long native/network operations.
4. Reconcile the persisted declaration through existing remote inspection and registration, retaining its declaration digest and per-repository apply outcome in runtime state.
5. Report both `configuration_saved` and registration/readiness status. A saved declaration plus failed remote inspection is a useful pending state, not success or rollback of a possibly applied operation.

Use the existing YAML library's document APIs to preserve unrelated settings/comments; do not serialize a reconstructed minimal file. This provides serialization across cooperating AbraCode writers and detection of ordinary external edits, not a filesystem compare-and-swap guarantee against adversarial editors. Runtime reconciliation uses stable repository IDs and identities to reuse partial progress after a crash. No second hidden personal registry is introduced. Native project IDs, canonical managed paths and inspected SHA remain runtime-only.

Explicit config apply uses the same reconciler for manual YAML edits. Results distinguish `declared/pending`, `registered/ready`, `registered/setup-blocked`, `apply-failed`, and `retained/undeclared`. List/readiness views compare current declaration content with last-applied digests; drift cannot be mistaken for settings already applied. Removing a declaration blocks new starts and scheduling for that repository but preserves active work, history and resources. Restoration reuses identity. Any cleanup stays a separate controller action with existing preservation/authorization rules.

**Alternative considered:** automatically register everything during startup, or write configuration only after registration. The first introduces network/repository side effects into ordinary launch; the second can leave a hidden registration as the only surviving source after a file-write failure. Persisting desired settings first gives a recoverable, visible boundary without pretending the two stores have a shared transaction.

### 5. Snapshot effective settings for an execution

Resolve all five role models from configuration once and record applicable worker profiles/capability prerequisites and repository policy at execution creation, before worker admission. Integrate with the current versioned execution contract and captured worker context instead of adding another competing prompt store. Snapshot default/override provenance and a relevant configuration digest for diagnostics. The default model is not inferred from Abra's latest assistant message or machine-global UI selection.

New executions use new effective settings after the documented apply/restart path. Existing executions and uncertain prompt recovery use their retained selection even after restart; missing inventory blocks them rather than substituting a new model. Existing deliberate controller routes for changing an active assignment remain explicit and must recapture compatible context as already required. Config changes do not retroactively change pending forms or approval/delivery receipts.

For Abra, generated config selects the resolved Supervisor model at bootstrap; deliberate UI selection can be session-local but does not redefine worker defaults or persist to YAML. Effective-config inspection reports configured models and labels any live session override separately. Diagnostic attention uses the retained central session and its documented model selection rather than a separate hidden model setting.

### 6. Make Abra the only user conversation

Use native agent ID `abra` for the central session, while retaining the internal logical `supervisor` role to avoid changing workflow semantics. Register the profile through generated native configuration/tracked `abra.md`, set the central default agent to it, and update role-policy mapping and every explicit `event.agent === "supervisor"` check. At the central application location, use the existing public agent transform to hide other selectable primary roles and set Abra as default; do not delete or rewrite foreign repositories' native agents. Worker role configuration still uses supported native agents such as `build` in assigned locations. Naming cannot be used as proof of management authority: central location, retained session identity and provenance checks remain required.

Retain native worker sessions for persistence/recovery but remove automatic worker `tabs.open`, worker chat links and conversation-picker behavior. Replace them with a Workers inspection view/command containing role, model, activity, evidence and bounded lazily loaded transcript messages where available. Reuse native context decoding and observer error contracts; do not export entire environments/provider bodies. The only conversation action is "Talk to Abra". Keep native queued/busy synchronization for off-screen workers. Do not assume that closing/hiding a tab stops a worker.

Add a backend managed-worker prompt guard using the pinned public `session.hook("prompt", ...)`. Its session/message IDs are checked against retained controller prompt intent, current generation/role and captured context. No supplied label or `delivery: queue` flag is enough. Reject unowned foreground/queued messages before a new worker turn; keep existing request-time role/tool validation. Hooks perform bounded reads without recursively acquiring coordination locks held by a submitting controller operation. Already admitted native messages keep replay/recovery semantics. Cover historical worker sessions as well as the active session.

Source evidence: pinned [prompt preparation](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/session/prompt.ts) waits for location plugin activation and invokes the prompt hook with session/message identity; pinned [session admission](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/session/session.ts) reconciles an existing inbox item before preparing a new prompt. Runtime acceptance must verify rejection timing and owned recovery; declarations/source alone do not count as a passed test. This is a managed-conversation rule within a trusted-user host, not a guarantee against arbitrary native administration or replacement plugins.

Route worker questions and all matching native authorization forms to the retained Abra session. Existing owner identities, answer validation, control generations and human receipts remain unchanged. Abra keeps central management tools without native shell or implementation permissions; Review/Research/Explore/Apply do not acquire each other's capabilities.

**Alternative considered:** only rename the Supervisor title or remove links. Rejected because direct native worker prompts would still be an alternate conversation path. Replacing all native sessions with an in-process agent loop is unnecessary and would discard the native persistence/recovery contracts.

### 7. Brand through public surfaces and use a fresh namespace

Rename project-owned public package names, labels, current docs, commands, skills and environment variables consistently. Use plugin ID/metadata namespace `abracode`, generated paths under `.abracode/`, and a central session title such as "Abra". Establish a single naming map and update custom RPC/tool names and role filtering together; a prefix change must not silently strip management tools or break worker reporting. No compatibility alias is required for old OpenCrew entry points. Historical archived planning artifacts and required upstream attributions are evidence and should not be blanket-rewritten.

The owned sidebar/work pages plus a small supported home/prompt footer or composer-adjacent label establish the brand. Use host theme tokens and existing rendering primitives. The [public CLI plugin slots](https://dev.opencode.ai/v2/docs/build/plugins/cli) include `home.footer`, `prompt.footer`, `session.composer.top` and sidebar contributions; there is no inspected dedicated logo/app-name override. Keep accurate OpenCode attribution and leave host chrome alone. Native terminal acceptance is required; no graphical-client white-label claim is made.

Fresh-install support allows namespace changes, but it does not authorize removing old data. Leave `.opencrew/`, `projects.yaml` and old service registration alone. Do not attach to a legacy native service just because its version matches. Check detectable overlapping resource ownership and provide instructions to stop the legacy service separately. Use distinct default paths; old explicitly selected state paths are not a supported import route. Document preservation/backup and installation of a new clone, with no automatic migration.

### 8. Establish release evidence, not a blanket license assertion

Add root MIT `LICENSE`, package license metadata and third-party licensing documentation/notices, including derived OpenSpec skills. Use actual existing copyright/provenance evidence for third-party files. Project-owned licensing can name AbraCode contributors without implying ownership of upstream material.

Build the inventory from the frozen workspace lock and actual files/native artifacts installed for supported Linux targets, not just root dependencies. The exploratory scan found predominantly permissive metadata, MPL-2.0 Lightning CSS, EPL-2.0 ELK through Mermaid, Creative Commons attribution data, and Khroma with an MIT license file despite missing metadata. These are findings to verify, not a completed release audit. Distinguish components installed for build/authoring from components embedded in plugin bundles or self-contained report HTML; `neverBundle` and the reporter's separate Mermaid engine affect that boundary. Review downloaded CLI/browser executables and their included notices separately. Optional no-mistakes is an external integration, not a binary currently shipped by this repository.

Record exact version/revision, provenance, SPDX expression when known, actual license/notice locations, distribution category, obligations and disposition in a tracked inventory. Supply full texts/notices or source-availability information where required. License checks must fail for new unreviewed components or stale dispositions and allow a license expression based on reviewed evidence rather than an unsafe blanket permissive-only whitelist. A report that says "unknown" cannot also say release-ready.

Relevant primary references: [OpenCode's pinned MIT license](https://github.com/anomalyco/opencode/blob/v2.0.28/LICENSE), [OpenSpec's pinned MIT license](https://github.com/Fission-AI/OpenSpec/blob/v1.13.2/LICENSE), [Apache-2.0 redistribution conditions](https://www.apache.org/licenses/LICENSE-2.0), [Mozilla's MPL guidance](https://www.mozilla.org/en-US/MPL/2.0/FAQ/), and [EPL-2.0](https://www.eclipse.org/legal/epl-2.0/). These identify obligations to assess and do not certify the final release. Provider accounts, service terms and trademarks remain separate from the MIT grant.

**Alternative considered:** add only an MIT file or automatically reject every copyleft dependency. Neither answers the user's actual concern: rights and notices must match the artifact and its use.

## Risks / Trade-offs

- **Source installation includes development tools:** larger install and more license evidence. Keep a precise frozen install and capability table; defer slimming to a later packaging change.
- **Configuration and registration are separate commits:** a crash can leave pending declarations. Persist intent first, expose stage outcomes and reconcile by stable identity.
- **Concurrent manual file edits:** cooperative locking cannot stop arbitrary editors. Preserve comments, detect content changes before atomic replacement and report conflicts instead of blind overwrite.
- **Hidden native configuration influence:** globals/foreign project config can shape native inventory. Generate owned central settings, explicitly select managed models and retain request-time role/capability gates.
- **Rename breaks string-based policy checks:** use one naming map and contract/native tests covering Abra's restrictions, RPC/tools, worker skills and fresh namespace paths.
- **Worker guard accidentally rejects controller traffic or deadlocks:** test real queued prompts, response-loss recovery and current/historical direct rejection with bounded read paths and no nested coordination acquisition.
- **License metadata misses nested native assets:** inventory actual installed/artifact contents and primary license files; block release readiness when evidence is insufficient.
- **Removing declarations strands resources:** label retained/undeclared state and keep explicit resume/recovery/cleanup routes. Never equate omission with authorization to delete.
- **Brand resemblance to existing Abracode projects:** user explicitly accepts the name. Maintain accurate origin/attribution; naming acceptance is not a claim of trademark clearance.

## Migration Plan

There is no OpenCrew state migration. Implement and validate in temporary fresh Linux installations. Existing personal files/resources remain untouched. Operators use a new clone, create `abracode.yaml`, authenticate through the local native service, explicitly apply declarations, and launch Abra. Release notes explain the breaking names/layout and separate legacy service shutdown.

For subsequent AbraCode updates, stop the service cleanly, preserve personal configuration and `.abracode/`, update the checkout, run the frozen install and static/environment checks, then restart and attach to the same Abra session. This release does not promise cross-version database downgrades: rollback uses a compatible checkout with matching pre-update state backup, never deletion or silent schema replacement. Integration/native tests verify the unchanged-state restart path.

Acceptance runs the required `pnpm check`, `pnpm test`, `pnpm test:e2e` plus the build, config/schema/license checks and a fresh-install launch/auth/reattach smoke path. Use temporary homes/repositories, the existing deterministic local model fixture and local bare remotes; never use personal credentials or push to user remotes. Required workflow and model snapshot tests cover both normal work and restart/uncertain admission.
